import asyncio
import errno
import json
import shlex
from collections.abc import AsyncIterator
from typing import Any, Callable, cast

import pytest
import pytest_asyncio
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from app.api.endpoints import websocket as websocket_endpoint
from app.constants import (
    DEFAULT_TERMINAL_ID,
    PTY_OUTPUT_QUEUE_SIZE,
    WS_CLOSE_AUTH_FAILED,
    WS_CLOSE_INVALID_CWD,
    WS_CLOSE_SANDBOX_NOT_FOUND,
    WS_MSG_AUTH,
    WS_MSG_CLOSE,
    WS_MSG_DETACH,
    WS_MSG_INIT,
    WS_MSG_RESIZE,
)
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.base import SandboxProvider
from app.services.sandbox_providers.types import (
    CommandResult,
    PtyDataCallbackType,
    PtySize,
)

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace


pytestmark = pytest.mark.anyio


async def wait_until(predicate: Callable[[], bool], timeout: float = 2.0) -> None:
    # Generic polling helper for asserting on background-task side effects
    # (PTY provider calls, forwarded websocket frames) without a fixed sleep.
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() >= deadline:
            raise TimeoutError("condition not met before timeout")
        await asyncio.sleep(0.01)


class LiveFakeWebSocket:
    # Unlike FakeWebSocket (a static frame list), this queues frames so a
    # test can push auth/control/input frames while the endpoint coroutine
    # is already running as a background task — needed to interleave PTY
    # output arriving mid-connection with client frames.
    def __init__(
        self,
        query_params: dict[str, str] | None = None,
        close_error: OSError | None = None,
    ) -> None:
        self.query_params = query_params or {}
        self.accepted = False
        self.sent_text: list[str] = []
        self.close_code: int | None = None
        self.close_reason: str | None = None
        self._frames: "asyncio.Queue[dict[str, Any]]" = asyncio.Queue()
        self._close_error = close_error

    async def accept(self) -> None:
        self.accepted = True

    async def receive(self) -> dict[str, Any]:
        frame = await self._frames.get()
        if "__disconnect__" in frame:
            raise WebSocketDisconnect()
        return frame

    async def send_text(self, payload: str) -> None:
        self.sent_text.append(payload)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.close_code = code
        self.close_reason = reason
        if self._close_error is not None:
            raise self._close_error

    def push_text(self, payload: str) -> None:
        self._frames.put_nowait({"text": payload})

    def push_bytes(self, data: bytes) -> None:
        self._frames.put_nowait({"bytes": data})

    def push_raw(self, frame: dict[str, Any]) -> None:
        self._frames.put_nowait(frame)

    def push_disconnect(self) -> None:
        self._frames.put_nowait({"__disconnect__": True})


class FakePtySandboxProvider(SandboxProvider):
    # Real TerminalSessionRegistry/TerminalSessionRecord run against this —
    # unlike FakeSandboxProvider (static pty-1 id, no on_data callback
    # tracking), this records every pty lifecycle call and lets tests drive
    # PTY output by invoking the registered on_data callback directly.
    def __init__(self) -> None:
        self._workspace_root = "/tmp/agentrove-pty-test"
        self._pty_sessions: dict[str, dict[str, Any]] = {}
        self.on_data_callbacks: dict[str, PtyDataCallbackType] = {}
        self.created_ptys: list[tuple[str, str, int, int, str, str]] = []
        self.sent_inputs: list[tuple[str, str, bytes]] = []
        self.resizes: list[tuple[str, str, PtySize]] = []
        self.killed: list[tuple[str, str]] = []
        self.executed_commands: list[tuple[str, str]] = []
        self._counter = 0

    @property
    def workspace_root(self) -> str:
        return self._workspace_root

    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        return "sandbox-1"

    async def delete_sandbox(self, sandbox_id: str) -> None:
        return None

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        cwd: str,
        on_data: PtyDataCallbackType,
    ) -> str:
        self._counter += 1
        pty_id = f"pty-{self._counter}"
        self.on_data_callbacks[pty_id] = on_data
        self.created_ptys.append((pty_id, sandbox_id, rows, cols, tmux_session, cwd))
        self.register_pty_session(sandbox_id, pty_id, {})
        return pty_id

    async def send_pty_input(self, sandbox_id: str, pty_id: str, data: bytes) -> None:
        self.sent_inputs.append((sandbox_id, pty_id, data))

    async def resize_pty(self, sandbox_id: str, pty_id: str, size: PtySize) -> None:
        self.resizes.append((sandbox_id, pty_id, size))

    async def kill_pty(self, sandbox_id: str, pty_id: str) -> None:
        self.killed.append((sandbox_id, pty_id))
        self.cleanup_pty_session_tracking(sandbox_id, pty_id)

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        envs: dict[str, str] | None = None,
        timeout: int = 120,
    ) -> CommandResult:
        self.executed_commands.append((sandbox_id, command))
        return CommandResult(stdout="", stderr="", exit_code=0)


class FailingPtySandboxProvider(FakePtySandboxProvider):
    # Exercises SandboxService's own error handling (send_pty_input /
    # resize_pty_session / cleanup_pty_session) — every pty operation is
    # attempted (recorded) and then raises, so the terminal session must
    # keep running instead of crashing the websocket connection.
    async def send_pty_input(self, sandbox_id: str, pty_id: str, data: bytes) -> None:
        self.sent_inputs.append((sandbox_id, pty_id, data))
        raise RuntimeError("send failed")

    async def resize_pty(self, sandbox_id: str, pty_id: str, size: PtySize) -> None:
        self.resizes.append((sandbox_id, pty_id, size))
        raise RuntimeError("resize failed")

    async def kill_pty(self, sandbox_id: str, pty_id: str) -> None:
        self.killed.append((sandbox_id, pty_id))
        raise OSError("kill failed")


class FakePtyProviderFactory:
    def __init__(self, provider: SandboxProvider) -> None:
        self.provider = provider

    def __call__(
        self,
        provider_type: SandboxProviderType | str,
        workspace_path: str | None = None,
    ) -> SandboxProvider:
        return self.provider


@pytest_asyncio.fixture
async def pty_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[FakePtySandboxProvider]:
    provider = FakePtySandboxProvider()
    monkeypatch.setattr(
        SandboxProvider, "create_provider", FakePtyProviderFactory(provider)
    )
    yield provider
    # Real TerminalSessionRecord tasks are bound to this test's event loop —
    # tear them all down so a lingering task doesn't leak into the next test.
    await websocket_endpoint.terminal_session_registry.terminate_all()


@pytest_asyncio.fixture
async def failing_pty_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[FailingPtySandboxProvider]:
    provider = FailingPtySandboxProvider()
    monkeypatch.setattr(
        SandboxProvider, "create_provider", FakePtyProviderFactory(provider)
    )
    yield provider
    await websocket_endpoint.terminal_session_registry.terminate_all()


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


async def test_terminal_websocket_real_session_lifecycle(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    pty_provider: FakePtySandboxProvider,
) -> None:
    # Runs the real TerminalSessionRegistry/TerminalSessionRecord against
    # FakePtySandboxProvider — attach, input queueing, resize, PTY output
    # forwarding, and terminate (pty kill + tmux kill-session).
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-lifecycle@example.com",
        username="ptylifecycle",
    )
    token = headers["Authorization"].removeprefix("Bearer ")
    websocket = LiveFakeWebSocket(query_params={"terminalId": "term-live"})
    task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, websocket), workspace.sandbox_id
        )
    )

    websocket.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    websocket.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 30, "cols": 100}))
    await wait_until(lambda: len(websocket.sent_text) >= 1)

    init_payload = json.loads(websocket.sent_text[0])
    assert init_payload["type"] == WS_MSG_INIT
    pty_id = init_payload["id"]
    assert len(pty_provider.created_ptys) == 1
    _pty_id, _sandbox_id, rows, cols, tmux_session, cwd = pty_provider.created_ptys[0]
    assert (rows, cols, cwd) == (30, 100, "")
    expected_tmux = f"agentrove_{workspace.sandbox_id.replace('-', '_')}_term_live"
    assert tmux_session == expected_tmux

    websocket.push_bytes(b"echo hi\n")
    await wait_until(lambda: len(pty_provider.sent_inputs) >= 1)
    assert pty_provider.sent_inputs == [(workspace.sandbox_id, pty_id, b"echo hi\n")]

    websocket.push_text(json.dumps({"type": WS_MSG_RESIZE, "rows": 40, "cols": 120}))
    await wait_until(lambda: len(pty_provider.resizes) >= 1)
    assert pty_provider.resizes == [
        (workspace.sandbox_id, pty_id, PtySize(rows=40, cols=120))
    ]

    await pty_provider.on_data_callbacks[pty_id](b"hello from pty")
    await wait_until(lambda: len(websocket.sent_text) >= 2)
    assert json.loads(websocket.sent_text[1]) == {
        "type": "stdout",
        "data": "hello from pty",
    }

    websocket.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(task, timeout=2.0)

    assert pty_provider.killed == [(workspace.sandbox_id, pty_id)]
    assert any(
        f"tmux kill-session -t {shlex.quote(expected_tmux)}" in cmd
        for _sid, cmd in pty_provider.executed_commands
    )
    assert websocket.close_code == 1000


async def test_terminal_websocket_buffered_output_replays_on_reconnect(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    pty_provider: FakePtySandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-reconnect@example.com",
        username="ptyreconnect",
    )
    token = headers["Authorization"].removeprefix("Bearer ")

    first_ws = LiveFakeWebSocket(query_params={"terminalId": "term-r"})
    first_task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, first_ws), workspace.sandbox_id
        )
    )
    first_ws.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    first_ws.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(first_ws.sent_text) >= 1)
    pty_id = json.loads(first_ws.sent_text[0])["id"]

    first_ws.push_text(json.dumps({"type": WS_MSG_DETACH}))
    await asyncio.wait_for(first_task, timeout=2.0)

    # Output arrives while nobody is attached — it must be buffered, not
    # dropped, and replayed as one batched frame on the next attach.
    await pty_provider.on_data_callbacks[pty_id](b"buffered-1 ")
    await pty_provider.on_data_callbacks[pty_id](b"buffered-2")

    second_ws = LiveFakeWebSocket(query_params={"terminalId": "term-r"})
    second_task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, second_ws), workspace.sandbox_id
        )
    )
    second_ws.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    second_ws.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(second_ws.sent_text) >= 2)

    assert json.loads(second_ws.sent_text[0])["id"] == pty_id
    assert json.loads(second_ws.sent_text[1]) == {
        "type": "stdout",
        "data": "buffered-1 buffered-2",
    }
    assert len(pty_provider.created_ptys) == 1
    # Reattaching an already-started session (is_reattach) repaints via tmux.
    assert any(
        "tmux refresh-client" in cmd for _sid, cmd in pty_provider.executed_commands
    )

    second_ws.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(second_task, timeout=2.0)


async def test_terminal_websocket_input_and_resize_before_init_are_noops(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    pty_provider: FakePtySandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-noop@example.com",
        username="ptynoop",
    )
    token = headers["Authorization"].removeprefix("Bearer ")
    websocket = LiveFakeWebSocket(query_params={"terminalId": "term-noop"})
    task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, websocket), workspace.sandbox_id
        )
    )

    websocket.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    # Bytes and resize arrive before INIT — the session record exists (via
    # get_or_create) but has no pty yet, so both must be silently dropped.
    websocket.push_bytes(b"too-early")
    websocket.push_text(json.dumps({"type": WS_MSG_RESIZE, "rows": 10, "cols": 10}))
    websocket.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(websocket.sent_text) >= 1)

    assert pty_provider.sent_inputs == []
    assert pty_provider.resizes == []
    assert len(pty_provider.created_ptys) == 1

    websocket.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(task, timeout=2.0)


async def test_terminal_registry_scopes_sessions_by_cwd(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    pty_provider: FakePtySandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-cwd@example.com",
        username="ptycwd",
    )
    token = headers["Authorization"].removeprefix("Bearer ")

    root_ws = LiveFakeWebSocket(query_params={"terminalId": "term-shared"})
    root_task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, root_ws), workspace.sandbox_id
        )
    )
    root_ws.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    root_ws.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(root_ws.sent_text) >= 1)
    root_pty_id = json.loads(root_ws.sent_text[0])["id"]
    root_ws.push_text(json.dumps({"type": WS_MSG_DETACH}))
    await asyncio.wait_for(root_task, timeout=2.0)

    worktree_ws = LiveFakeWebSocket(
        query_params={"terminalId": "term-shared", "cwd": ".worktrees/abc12345"}
    )
    worktree_task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, worktree_ws), workspace.sandbox_id
        )
    )
    worktree_ws.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    worktree_ws.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(worktree_ws.sent_text) >= 1)
    worktree_ws.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(worktree_task, timeout=2.0)

    # Same terminal_id, different cwd — must be a distinct pty/tmux session.
    assert len(pty_provider.created_ptys) == 2
    root_tmux = pty_provider.created_ptys[0][4]
    worktree_tmux = pty_provider.created_ptys[1][4]
    assert root_tmux != worktree_tmux
    assert worktree_tmux == (
        f"agentrove_{workspace.sandbox_id.replace('-', '_')}_term_shared"
        "__worktrees_abc12345"
    )

    root_ws2 = LiveFakeWebSocket(query_params={"terminalId": "term-shared"})
    root_task2 = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, root_ws2), workspace.sandbox_id
        )
    )
    root_ws2.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    root_ws2.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(root_ws2.sent_text) >= 1)

    # Reattaching to the root-cwd terminal reuses the original pty — no
    # third pty gets created.
    assert json.loads(root_ws2.sent_text[0])["id"] == root_pty_id
    assert len(pty_provider.created_ptys) == 2

    root_ws2.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(root_task2, timeout=2.0)


async def test_terminal_websocket_new_attach_closes_stale_websocket(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    pty_provider: FakePtySandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-steal@example.com",
        username="ptysteal",
    )
    token = headers["Authorization"].removeprefix("Bearer ")

    first_ws = LiveFakeWebSocket(query_params={"terminalId": "term-steal"})
    first_task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, first_ws), workspace.sandbox_id
        )
    )
    first_ws.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    first_ws.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(first_ws.sent_text) >= 1)

    second_ws = LiveFakeWebSocket(query_params={"terminalId": "term-steal"})
    second_task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, second_ws), workspace.sandbox_id
        )
    )
    second_ws.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    second_ws.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: first_ws.close_code is not None)

    # attach() force-closes the previous connection's websocket when a new
    # one attaches to the same session without a clean detach first.
    assert first_ws.close_code == 1000
    assert len(pty_provider.created_ptys) == 1

    # The first task's own receive loop is still parked on `receive()` since
    # our fake doesn't simulate a real disconnect — detach it manually so
    # the test ends deterministically instead of waiting for the ping timeout.
    first_ws.push_text(json.dumps({"type": WS_MSG_DETACH}))
    await asyncio.wait_for(first_task, timeout=2.0)

    second_ws.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(second_task, timeout=2.0)


async def test_terminal_websocket_output_queue_drops_oldest_when_full(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    pty_provider: FakePtySandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-overflow@example.com",
        username="ptyoverflow",
    )
    token = headers["Authorization"].removeprefix("Bearer ")

    websocket = LiveFakeWebSocket(query_params={"terminalId": "term-overflow"})
    task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, websocket), workspace.sandbox_id
        )
    )
    websocket.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    websocket.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(websocket.sent_text) >= 1)
    pty_id = json.loads(websocket.sent_text[0])["id"]

    websocket.push_text(json.dumps({"type": WS_MSG_DETACH}))
    await asyncio.wait_for(task, timeout=2.0)

    # Fill the output queue (PTY_OUTPUT_QUEUE_SIZE) well past capacity while
    # nobody is attached to drain it — must drop the oldest entries rather
    # than block or grow unbounded.
    on_data = pty_provider.on_data_callbacks[pty_id]
    for i in range(PTY_OUTPUT_QUEUE_SIZE + 20):
        await on_data(f"{i}\n".encode())

    reconnect_ws = LiveFakeWebSocket(query_params={"terminalId": "term-overflow"})
    reconnect_task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, reconnect_ws), workspace.sandbox_id
        )
    )
    reconnect_ws.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    reconnect_ws.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(reconnect_ws.sent_text) >= 2)

    replayed = json.loads(reconnect_ws.sent_text[1])["data"]
    replayed_numbers = replayed.strip().split("\n")
    assert "0" not in replayed_numbers
    assert str(PTY_OUTPUT_QUEUE_SIZE + 19) in replayed_numbers

    reconnect_ws.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(reconnect_task, timeout=2.0)


async def test_terminal_websocket_survives_provider_pty_errors(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    failing_pty_provider: FailingPtySandboxProvider,
) -> None:
    # SandboxService.send_pty_input/resize_pty_session/cleanup_pty_session
    # each catch provider errors and log rather than propagate — the
    # terminal connection must keep working through input, resize, and a
    # clean close even when every underlying pty call fails.
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-errors@example.com",
        username="ptyerrors",
    )
    token = headers["Authorization"].removeprefix("Bearer ")
    websocket = LiveFakeWebSocket(query_params={"terminalId": "term-errors"})
    task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, websocket), workspace.sandbox_id
        )
    )

    websocket.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    websocket.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(websocket.sent_text) >= 1)

    websocket.push_bytes(b"echo hi\n")
    await wait_until(lambda: len(failing_pty_provider.sent_inputs) >= 1)
    # send_pty_input's failure path calls cleanup_pty_session -> kill_pty.
    await wait_until(lambda: len(failing_pty_provider.killed) >= 1)

    websocket.push_text(json.dumps({"type": WS_MSG_RESIZE, "rows": 40, "cols": 100}))
    await wait_until(lambda: len(failing_pty_provider.resizes) >= 1)

    websocket.push_text(json.dumps({"type": WS_MSG_CLOSE}))
    await asyncio.wait_for(task, timeout=2.0)

    assert websocket.close_code == 1000
    # terminate()'s own cleanup_pty_session call means kill_pty was attempted
    # at least twice (once from the input failure, once from close()).
    assert len(failing_pty_provider.killed) >= 2


async def test_terminal_websocket_ignores_malformed_frames_and_handles_disconnect(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    pty_provider: FakePtySandboxProvider,
) -> None:
    # Malformed control frames (no text/bytes key, non-dict JSON, dict with
    # no "type") must be silently skipped, and an abrupt client disconnect
    # (WebSocketDisconnect from receive()) must be handled gracefully rather
    # than propagating out of the endpoint — including a close() that itself
    # raises a non-EPIPE OSError during the best-effort final close.
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="pty-malformed@example.com",
        username="ptymalformed",
    )
    token = headers["Authorization"].removeprefix("Bearer ")
    websocket = LiveFakeWebSocket(
        query_params={"terminalId": "term-malformed"},
        close_error=OSError(errno.ECONNRESET, "connection reset"),
    )
    task = asyncio.create_task(
        websocket_endpoint.terminal_websocket(
            cast(WebSocket, websocket), workspace.sandbox_id
        )
    )

    websocket.push_text(json.dumps({"type": WS_MSG_AUTH, "token": token}))
    websocket.push_text(json.dumps({"type": WS_MSG_INIT, "rows": 24, "cols": 80}))
    await wait_until(lambda: len(websocket.sent_text) >= 1)

    websocket.push_raw({})
    websocket.push_raw({"text": "[1, 2, 3]"})
    websocket.push_raw({"text": json.dumps({"no_type": "here"})})
    websocket.push_disconnect()

    await asyncio.wait_for(task, timeout=2.0)

    # Session stayed alive through the junk frames — only one pty, never
    # torn down by a bad frame — and the final close was attempted despite
    # raising.
    assert len(pty_provider.created_ptys) == 1
    assert websocket.close_code == 1000
