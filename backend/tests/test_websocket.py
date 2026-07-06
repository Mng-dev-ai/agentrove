import json
from typing import Any, cast

import pytest
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import websocket as websocket_endpoint
from app.constants import (
    DEFAULT_TERMINAL_ID,
    WS_CLOSE_AUTH_FAILED,
    WS_CLOSE_INVALID_CWD,
    WS_CLOSE_SANDBOX_NOT_FOUND,
    WS_MSG_AUTH,
    WS_MSG_DETACH,
    WS_MSG_INIT,
    WS_MSG_RESIZE,
)
from app.services.sandbox_providers import SandboxProviderType

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace


pytestmark = pytest.mark.anyio


class FakeWebSocket:
    def __init__(
        self, frames: list[dict[str, Any]], query_params: dict[str, str] | None = None
    ) -> None:
        self.frames = frames
        self.query_params = query_params or {}
        self.accepted = False
        self.sent_text: list[str] = []
        self.close_code: int | None = None
        self.close_reason: str | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def receive(self) -> dict[str, Any]:
        return self.frames.pop(0)

    async def send_text(self, payload: str) -> None:
        self.sent_text.append(payload)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.close_code = code
        self.close_reason = reason


class FakeTerminalSession:
    def __init__(self) -> None:
        self.pty_id = "pty-1"
        self.sandbox_id = "sandbox-websocket"
        self.active_websocket: WebSocket | None = None
        self.ensure_started_calls: list[tuple[int, int]] = []
        self.resize_calls: list[tuple[int, int]] = []
        self.inputs: list[bytes] = []
        self.attach_count = 0
        self.detach_count = 0
        self.terminate_count = 0

    async def ensure_started(self, rows: int, cols: int) -> bool:
        self.ensure_started_calls.append((rows, cols))
        return False

    async def attach(self, websocket: WebSocket) -> None:
        self.active_websocket = websocket
        self.attach_count += 1

    def enqueue_input(self, data: bytes) -> None:
        self.inputs.append(data)

    async def resize(self, rows: int, cols: int) -> None:
        self.resize_calls.append((rows, cols))

    async def terminate(self) -> None:
        self.terminate_count += 1

    async def detach(self) -> None:
        self.active_websocket = None
        self.detach_count += 1


class FakeTerminalRegistry:
    def __init__(self, session: FakeTerminalSession) -> None:
        self.session = session
        self.calls: list[dict[str, Any]] = []

    async def get_or_create(
        self,
        *,
        user_id: str,
        sandbox_id: str,
        terminal_id: str,
        cwd: str,
        provider_type: SandboxProviderType,
        workspace_path: str | None,
    ) -> FakeTerminalSession:
        self.calls.append(
            {
                "user_id": user_id,
                "sandbox_id": sandbox_id,
                "terminal_id": terminal_id,
                "cwd": cwd,
                "provider_type": provider_type,
                "workspace_path": workspace_path,
            }
        )
        self.session.sandbox_id = sandbox_id
        return self.session


async def run_terminal_websocket(websocket: FakeWebSocket, sandbox_id: str) -> None:
    await websocket_endpoint.terminal_websocket(cast(WebSocket, websocket), sandbox_id)


async def test_terminal_websocket_rejects_invalid_auth() -> None:
    websocket = FakeWebSocket(
        [{"text": json.dumps({"type": WS_MSG_AUTH, "token": "invalid"})}]
    )

    await run_terminal_websocket(websocket, "sandbox-1")

    assert websocket.accepted is True
    assert websocket.close_code == WS_CLOSE_AUTH_FAILED
    assert websocket.close_reason == "Authentication failed"


async def test_terminal_websocket_rejects_unowned_sandbox(
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="ws-denied@example.com", username="wsdenied")
    tokens = await login(email="ws-denied@example.com")
    websocket = FakeWebSocket(
        [{"text": json.dumps({"type": WS_MSG_AUTH, "token": tokens["access_token"]})}]
    )

    await run_terminal_websocket(websocket, "missing-sandbox")

    assert websocket.close_code == WS_CLOSE_SANDBOX_NOT_FOUND
    assert websocket.close_reason == "Sandbox not found"


async def test_terminal_websocket_rejects_escaping_cwd(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="ws-badcwd@example.com",
        username="wsbadcwd",
    )
    token = headers["Authorization"].removeprefix("Bearer ")
    websocket = FakeWebSocket(
        [{"text": json.dumps({"type": WS_MSG_AUTH, "token": token})}],
        query_params={"cwd": "../outside"},
    )

    await run_terminal_websocket(websocket, workspace.sandbox_id)

    assert websocket.close_code == WS_CLOSE_INVALID_CWD
    assert websocket.close_reason == "Invalid terminal cwd"


async def test_terminal_websocket_handles_control_frames(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="ws-owner@example.com",
        username="wsowner",
    )
    token = headers["Authorization"].removeprefix("Bearer ")
    session = FakeTerminalSession()
    registry = FakeTerminalRegistry(session)
    monkeypatch.setattr(websocket_endpoint, "terminal_session_registry", registry)
    websocket = FakeWebSocket(
        [
            {"text": json.dumps({"type": WS_MSG_AUTH, "token": token})},
            {"text": "{not-json"},
            {"text": json.dumps({"type": WS_MSG_INIT, "rows": 40, "cols": 120})},
            {"bytes": b"ls\n"},
            {"text": json.dumps({"type": WS_MSG_RESIZE, "rows": 50, "cols": 140})},
            {"text": json.dumps({"type": WS_MSG_DETACH})},
        ],
        query_params={"terminalId": "term-a", "cwd": ".worktrees/abc12345"},
    )

    await run_terminal_websocket(websocket, workspace.sandbox_id)

    assert registry.calls == [
        {
            "user_id": str(user.id),
            "sandbox_id": workspace.sandbox_id,
            "terminal_id": "term-a",
            "cwd": ".worktrees/abc12345",
            "provider_type": SandboxProviderType.HOST,
            "workspace_path": workspace.workspace_path,
        }
    ]
    init_response = json.loads(websocket.sent_text[0])
    assert init_response == {
        "type": WS_MSG_INIT,
        "id": "pty-1",
        "rows": 40,
        "cols": 120,
    }
    assert session.ensure_started_calls == [(40, 120)]
    assert session.resize_calls == [(50, 140)]
    assert session.inputs == [b"ls\n"]
    assert session.attach_count == 1
    assert session.detach_count == 1
    assert session.terminate_count == 0
    assert websocket.close_code == 1000


async def test_terminal_websocket_uses_default_terminal_id(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="ws-default@example.com",
        username="wsdefault",
    )
    token = headers["Authorization"].removeprefix("Bearer ")
    session = FakeTerminalSession()
    registry = FakeTerminalRegistry(session)
    monkeypatch.setattr(websocket_endpoint, "terminal_session_registry", registry)
    websocket = FakeWebSocket(
        [
            {"text": json.dumps({"type": WS_MSG_AUTH, "token": token})},
            {"text": json.dumps({"type": WS_MSG_DETACH})},
        ]
    )

    await run_terminal_websocket(websocket, workspace.sandbox_id)

    assert registry.calls[0]["terminal_id"] == DEFAULT_TERMINAL_ID
