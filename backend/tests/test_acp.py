import asyncio
import json
import os
import sys
import time
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import jwt
import pytest
import pytest_asyncio
from acp.schema import HttpMcpServer
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import REDIS_KEY_USER_STREAMS_LIVE
import app.main as main_module
from app.core import deps
from app.core.config import get_settings
from app.core.security import authenticate_websocket_user, create_mcp_access_token
from app.db.session import SessionLocal
from app.models.db_models.automation import Automation
from app.models.db_models.channel import ChannelDelivery
from app.models.db_models.chat import Chat
from app.models.db_models.paired_device import PairedDevice
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.services import channel as channel_module
from app.services.acp import client as acp_client_module
from app.services.automation import AutomationService
from app.services.chat import ChatService
from app.services import subthread_wake as wake_module
from app.services import session_registry as session_registry_module
from app.services.session_registry import session_registry
from app.services.acp.session import AcpSession, AcpSessionConfig
from app.services.agent import AgentService
from app.services.exceptions import AgentException
from app.services.sandbox_providers import SandboxProviderType
from app.services.session_registry import SessionRegistry
from app.services.streaming import runtime as runtime_module
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.subthread_wake import SubThreadWake
from app.services.user import UserService
from server import _SandboxClient
from tests.conftest import EmailCapture, LoginClient, UserFactory
from tests.fake_acp_agent import (
    ELICITATION_REQUESTED_SCHEMA,
    MARKER_AGENT_EXIT_MID_PROMPT,
    MARKER_ASK_USER_QUESTION,
    MARKER_CANCEL,
    MARKER_CONCURRENT_ELICITATIONS,
    MARKER_CRASH_MID_PROMPT,
    MARKER_ELICITATION,
    MARKER_ENTER_PLAN_MODE,
    MARKER_IMAGE_CONTENT,
    MARKER_PERMISSION,
    MARKER_RAW_INPUT_INVALID,
    MARKER_RAW_INPUT_STRING,
    MARKER_TOOL_CODEX_ERROR,
    MARKER_TOOL_DIFF,
    MARKER_TOOL_EMPTY_RESULT,
    MARKER_TOOL_LEFT_OPEN,
    MARKER_TOOL_START_DIFF,
    MARKER_TOOL_STRING_ERROR,
    MARKER_TOOL_TEXT_ERROR,
    MARKER_TOOL_TEXT_RESULT,
    MARKER_TOOL_UNKNOWN_DICT_ERROR,
    MARKER_UNTRACKED_TOOL_UPDATES,
    TITLE_PROMPT_PREFIX,
)
from tests.helpers import (
    EndpointCache,
    create_authenticated_workspace,
    create_chat_row,
)

pytestmark = pytest.mark.anyio

FAKE_AGENT_SCRIPT = Path(__file__).resolve().parent / "fake_acp_agent.py"
BINARY_NAMES = [
    "agy-acp-server",
    "claude-agent-acp",
    "codex-acp",
    "copilot",
    "cursor-agent",
    "grok",
    "opencode",
]

DEFAULT_TURN_TEXT = "Hello from the fake agent."
DIFF_RESULT = {"diffs": [{"path": "app.py", "oldText": "old", "newText": "new"}]}

# Minimal-but-valid-enough bytes for upload endpoints that only branch on
# content_type, not on parsing the file itself.
PNG_BYTES = bytes.fromhex("89504e470d0a1a0a0000000d49484452")
PDF_BYTES = b"%PDF-1.4\n%fake\n"


@pytest.fixture(scope="session")
def acp_bin_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    # PATH wrappers so AcpSession._spawn_host resolves to the fake agent.
    bin_dir = tmp_path_factory.mktemp("acp-fake-bin")
    launcher = (
        f"#!{sys.executable}\n"
        "import runpy\n"
        f"runpy.run_path({str(FAKE_AGENT_SCRIPT)!r}, run_name='__main__')\n"
    )
    for name in BINARY_NAMES:
        target = bin_dir / name
        target.write_text(launcher)
        target.chmod(0o755)
    return bin_dir


class FakeAgentHandle:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path

    def events(self) -> list[dict[str, Any]]:
        if not self.log_path.exists():
            return []
        return [
            json.loads(line)
            for line in self.log_path.read_text().splitlines()
            if line.strip()
        ]

    def events_of(self, event: str) -> list[dict[str, Any]]:
        return [e for e in self.events() if e.get("event") == event]

    def main_turn_prompts(self) -> list[dict[str, Any]]:
        # Filter background title-gen prompts out of the fake agent log.
        return [
            e
            for e in self.events_of("prompt")
            if not e["text"].startswith(TITLE_PROMPT_PREFIX)
        ]


@pytest.fixture
def fake_agent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, acp_bin_dir: Path
) -> FakeAgentHandle:
    log_path = tmp_path / "fake-acp.jsonl"
    monkeypatch.setenv("FAKE_ACP_LOG", str(log_path))
    monkeypatch.setenv("FAKE_ACP_SCENARIO", "normal")
    monkeypatch.setenv(
        "PATH", str(acp_bin_dir) + os.pathsep + os.environ.get("PATH", "")
    )
    return FakeAgentHandle(log_path=log_path)


@pytest.fixture(autouse=True)
def pin_ambient_settings() -> Iterator[None]:
    # Pin web-mode baseline — shell/.env may export real desktop settings.
    settings = get_settings()
    original = settings.DESKTOP_MODE
    settings.DESKTOP_MODE = False
    try:
        yield
    finally:
        settings.DESKTOP_MODE = original


@pytest.fixture
def acp_cache(monkeypatch: pytest.MonkeyPatch) -> EndpointCache:
    # Redis isn't available in tests — every module that touches cache_connection
    # for the chat-streaming path needs the in-memory fake wired in.
    from app.api.endpoints import chat as chat_endpoint
    from app.services import chat as chat_service_module
    from app.services.streaming import runtime as runtime_module

    cache = EndpointCache()
    monkeypatch.setattr(chat_endpoint, "cache_connection", cache.connect)
    monkeypatch.setattr(chat_service_module, "cache_connection", cache.connect)
    monkeypatch.setattr(runtime_module, "cache_connection", cache.connect)
    return cache


@pytest_asyncio.fixture
async def auth_workspace(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> tuple[dict[str, str], Workspace]:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    # Spawn cwd must exist (agent + best-effort git checkpoint probe).
    Path(workspace.workspace_path).mkdir(parents=True, exist_ok=True)
    return headers, workspace


async def enhance_prompt(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    *,
    prompt: str,
    model_id: str,
) -> httpx.Response:
    return await client.post(
        "/api/v1/chat/enhance-prompt",
        data={"prompt": prompt, "model_id": model_id},
        headers=headers,
    )


async def create_chat(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    workspace: Workspace,
    *,
    model_id: str,
    title: str = "ACP Test Chat",
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/chat/chats",
        json={"title": title, "model_id": model_id, "workspace_id": str(workspace.id)},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def send_message(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    *,
    chat_id: str,
    model_id: str,
    prompt: str,
    permission_mode: str = "default",
    thinking_mode: str | None = None,
    attached_files: list[tuple[str, tuple[str, bytes, str]]] | None = None,
) -> httpx.Response:
    data = {
        "prompt": prompt,
        "chat_id": chat_id,
        "model_id": model_id,
        "permission_mode": permission_mode,
    }
    if thinking_mode is not None:
        data["thinking_mode"] = thinking_mode
    return await client.post(
        "/api/v1/chat/chat",
        data=data,
        files=attached_files or [],
        headers=headers,
    )


async def wait_for_message(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    *,
    chat_id: str,
    message_id: str,
    timeout: float = 10.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = await client.get(
            f"/api/v1/chat/chats/{chat_id}/messages",
            headers=headers,
            params={"limit": 50},
        )
        assert response.status_code == 200, response.text
        # The turn task outlives the status flip; a resend before it unwinds 409s.
        if ChatStreamRuntime.has_active_chat(chat_id):
            await asyncio.sleep(0.05)
            continue
        for item in response.json()["items"]:
            if item["id"] == message_id and item["stream_status"] != "in_progress":
                await _settle_background_chat_work()
                return item
        await asyncio.sleep(0.05)
    raise AssertionError(f"message {message_id} did not leave in_progress in time")


async def _settle_background_chat_work(timeout: float = 5.0) -> None:
    # Drain pending title-gen tasks so they don't race the next test's DB drop.
    pending = [
        t
        for t in asyncio.all_tasks()
        if not t.done() and t.get_coro().__qualname__.endswith("_generate_title")
    ]
    if pending:
        await asyncio.wait(pending, timeout=timeout)


async def wait_for_message_event(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    *,
    message_id: str,
    event_type: str,
    timeout: float = 10.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = await client.get(
            f"/api/v1/chat/messages/{message_id}/events", headers=headers
        )
        assert response.status_code == 200, response.text
        for event in response.json():
            if event["event_type"] == event_type:
                return event
        await asyncio.sleep(0.05)
    raise AssertionError(f"event {event_type} for message {message_id} never arrived")


def tool_events(
    message: dict[str, Any], *, kinds: tuple[str, ...] | None = None
) -> list[dict[str, Any]]:
    kinds = kinds or ("tool_started", "tool_completed", "tool_failed")
    return [e for e in message["content_render"]["events"] if e["type"] in kinds]


def last_tool(message: dict[str, Any], tool_id: str) -> dict[str, Any]:
    matches = [e["tool"] for e in tool_events(message) if e["tool"]["id"] == tool_id]
    assert matches, f"no tool events for id={tool_id} in {message['content_render']}"
    return matches[-1]


@pytest.mark.parametrize(
    "model_id,agent_model_id",
    [
        ("sonnet", "sonnet"),
        ("gpt-5.4", "gpt-5.4"),
        # Antigravity encodes the (default) effort tier in the model id.
        ("antigravity:gemini-4-argon", "gemini-4-argon-high"),
        ("copilot:gpt-6-luna", "gpt-6-luna"),
        ("cursor:auto", "auto"),
        ("grok:grok-4.5", "grok-4.5"),
        ("opencode:opencode/gpt-5-nano", "opencode/gpt-5-nano"),
    ],
)
async def test_enhance_prompt_round_trips_through_real_acp_session(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_agent: FakeAgentHandle,
    model_id: str,
    agent_model_id: str,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email=f"{model_id.replace(':', '-')}@example.com",
    )

    response = await enhance_prompt(client, headers, prompt="say hi", model_id=model_id)

    assert response.status_code == 200, response.text
    assert response.json() == {"enhanced_prompt": DEFAULT_TURN_TEXT}

    new_sessions = fake_agent.events_of("new_session")
    assert new_sessions
    assert new_sessions[-1]["mcp_servers"] == []
    assert [
        e["value"]
        for e in fake_agent.events_of("set_config_option")
        if e["config_id"] == "model"
    ] == [agent_model_id]


@pytest.mark.parametrize(
    "model_id,thinking_mode,expected_status,expected_effort,expected_model",
    [
        ("copilot:gpt-6-luna", "xhigh", "completed", "xhigh", None),
        ("copilot:claude-haiku-4.5", "high", "completed", None, None),
        # An explicit tier the model lacks fails the turn instead of clamping.
        ("copilot:kimi-k3", "medium", "failed", None, None),
        ("gpt-6-luna", "low", "completed", "low", "gpt-6-luna"),
    ],
)
async def test_session_setup_gates_reasoning_effort_by_model(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    model_id: str,
    thinking_mode: str,
    expected_status: str,
    expected_effort: str | None,
    expected_model: str | None,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id=model_id)

    response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id=model_id,
        prompt="reason carefully",
        permission_mode="agent" if ":" in model_id else "auto",
        thinking_mode=thinking_mode,
    )
    assert response.status_code == 200, response.text
    message = await wait_for_message(
        client,
        headers,
        chat_id=chat["id"],
        message_id=response.json()["message_id"],
    )
    assert message["stream_status"] == expected_status

    effort_calls = [
        event
        for event in fake_agent.events_of("set_config_option")
        if event["config_id"] == "reasoning_effort"
    ]
    if expected_effort is None:
        assert effort_calls == []
    else:
        assert effort_calls[-1]["value"] == expected_effort

    if expected_model is not None:
        model_calls = [
            event
            for event in fake_agent.events_of("set_config_option")
            if event["config_id"] == "model"
        ]
        assert model_calls[0]["value"] == expected_model


async def test_enhance_prompt_surfaces_session_creation_failure(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_agent: FakeAgentHandle,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    monkeypatch.setenv("FAKE_ACP_SCENARIO", "crash_new_session")

    response = await enhance_prompt(client, headers, prompt="hi", model_id="sonnet")

    assert response.status_code == 400, response.text
    assert "Failed to create ACP session" in response.json()["detail"]


async def test_enhance_prompt_surfaces_mid_prompt_crash(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_agent: FakeAgentHandle,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="mid-prompt-crash@example.com"
    )

    response = await enhance_prompt(
        client, headers, prompt=f"{MARKER_CRASH_MID_PROMPT} do work", model_id="sonnet"
    )

    assert response.status_code == 400, response.text
    assert "ACP call failed" in response.json()["detail"]


@pytest.mark.parametrize("scenario", ["effort_error", "model_error"])
async def test_enhance_prompt_survives_config_option_failures(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_agent: FakeAgentHandle,
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
) -> None:
    # Claude sets its model and reasoning effort via set_config_option right
    # after the handshake; one-shot tasks must swallow a failure there and
    # still run the turn.
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="config-error@example.com"
    )
    monkeypatch.setenv("FAKE_ACP_SCENARIO", scenario)

    response = await enhance_prompt(
        client, headers, prompt="hi", model_id="claude-opus-5"
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"enhanced_prompt": DEFAULT_TURN_TEXT}


@pytest.mark.parametrize(
    "markers,expected",
    [
        pytest.param(
            (MARKER_TOOL_DIFF, MARKER_RAW_INPUT_STRING, MARKER_TOOL_CODEX_ERROR),
            {
                ("tool-primary", "result"): DIFF_RESULT,
                ("tool-primary", "input"): {"path": "encoded.py"},
                ("tool-secondary", "error"): "boom codex",
            },
            id="diff-result-json-string-input-codex-error",
        ),
        pytest.param(
            (
                MARKER_TOOL_TEXT_RESULT,
                MARKER_RAW_INPUT_INVALID,
                MARKER_TOOL_STRING_ERROR,
            ),
            {
                ("tool-primary", "result"): "plain text result",
                ("tool-primary", "input"): {"raw": "not-json{{"},
                ("tool-secondary", "error"): "boom plain string",
            },
            id="text-result-invalid-input-string-error",
        ),
        pytest.param(
            (MARKER_TOOL_START_DIFF, MARKER_TOOL_TEXT_ERROR),
            {
                ("tool-primary", "result"): DIFF_RESULT,
                ("tool-secondary", "error"): "command failed: no output",
            },
            id="start-diff-survives-content-text-error",
        ),
        pytest.param(
            (MARKER_TOOL_EMPTY_RESULT, MARKER_TOOL_UNKNOWN_DICT_ERROR),
            {
                ("tool-primary", "result"): None,
                ("tool-secondary", "error"): str({"unexpected_key": "value"}),
            },
            id="empty-result-unknown-dict-error",
        ),
    ],
)
async def test_chat_tool_call_extraction_variants(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    markers: tuple[str, ...],
    expected: dict[tuple[str, str], Any],
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=" ".join(markers) + " go",
    )
    assert send_response.status_code == 200, send_response.text
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"
    assert {
        (tool_id, field): last_tool(message, tool_id)[field]
        for tool_id, field in expected
    } == expected
    assert any(e["type"] == "plan" for e in message["content_render"]["events"])


async def test_chat_untracked_tool_updates_render_only_with_identity(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_UNTRACKED_TOOL_UPDATES} go",
    )
    message = await wait_for_message(
        client,
        headers,
        chat_id=chat["id"],
        message_id=send_response.json()["message_id"],
    )
    assert message["stream_status"] == "completed"

    # No title/input/name/result (tool-orphan, tool-bare) or a heartbeat id: no card.
    assert {e["tool"]["id"] for e in tool_events(message)} == {
        "tool-primary",
        "tool-secondary",
        "tool-named",
        "tool-titled",
        "tool-new",
    }
    named = last_tool(message, "tool-named")
    assert (named["name"], named["status"]) == ("Bash", "completed")
    titled = last_tool(message, "tool-titled")
    assert (titled["title"], titled["status"]) == ("Config", "completed")
    assert last_tool(message, "tool-new")["result"] == "synthesized result"


async def test_chat_records_last_turn_settings(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    # The chat must record each turn's model/thinking/persona so out-of-band
    # follow-ups (MCP) and the UI can inherit them instead of their defaults.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    response = await client.post(
        "/api/v1/chat/chat",
        data={
            "prompt": "hello",
            "chat_id": chat["id"],
            "model_id": "sonnet",
            "permission_mode": "default",
            "thinking_mode": "low",
            "selected_persona_name": "Bugbot",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    message_id = response.json()["message_id"]
    await wait_for_message(client, headers, chat_id=chat["id"], message_id=message_id)

    detail = await client.get(f"/api/v1/chat/chats/{chat['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["last_model_id"] == "sonnet"
    assert body["last_thinking_mode"] == "low"
    assert body["last_persona_name"] == "Bugbot"


async def test_chat_tool_left_active_is_auto_completed_on_finish(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    # Tool never terminals — finish(prompt_completed=True) auto-closes it.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_TOOL_LEFT_OPEN} go",
    )
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"
    tool = last_tool(message, "tool-secondary")
    assert tool["status"] == "completed"
    assert "result" not in tool
    assert "error" not in tool


async def test_chat_agent_exit_mid_turn_fails_message_and_next_turn_recovers(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    crashed = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_AGENT_EXIT_MID_PROMPT} do work",
    )
    crashed_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=crashed.json()["message_id"]
    )
    assert crashed_message["stream_status"] == "failed"
    assert last_tool(crashed_message, "tool-crash")["status"] == "failed"

    retry = await send_message(
        client, headers, chat_id=chat["id"], model_id="sonnet", prompt="try again"
    )
    retry_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=retry.json()["message_id"]
    )
    assert retry_message["stream_status"] == "completed"
    crashed_prompt, retry_prompt = fake_agent.main_turn_prompts()
    assert retry_prompt["pid"] != crashed_prompt["pid"]


async def test_chat_non_text_content_chunks_produce_no_events(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    # Non-text content blocks map to None — no extra text/thinking events.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_IMAGE_CONTENT} go",
    )
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"
    events = message["content_render"]["events"]
    assert [e for e in events if e["type"] == "assistant_text"] == [
        {"type": "assistant_text", "text": "Hello from the fake agent."}
    ]
    assert len([e for e in events if e["type"] == "assistant_thinking"]) == 1


async def test_chat_enter_plan_mode_tool_triggers_mid_stream_mode_switch(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    # Completed EnterPlanMode → map_session_mode + set_mode mid-turn.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_ENTER_PLAN_MODE} go",
    )
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"
    # Title generation runs a concurrent session that also sends set_session_mode.
    set_modes = fake_agent.events_of("set_session_mode")
    assert "plan" in [e["mode_id"] for e in set_modes]


@pytest.mark.parametrize(
    "model_id,agent_permission_mode,expect_raises,expect_mapped_modes",
    [
        ("gpt-5.4", "bypassPermissions", True, None),
        (
            "copilot:gpt-6-luna",
            "bypassPermissions",
            False,
            ["https://agentclientprotocol.com/protocol/session-modes#agent"],
        ),
        ("cursor:auto", "bypassPermissions", False, ["agent"]),
        # Grok mode-sets hop through plan first — direct auto <->
        # always-approve switches are silently ignored by the CLI.
        ("grok:grok-4.5", "bypassPermissions", False, ["plan", "always-approve"]),
        ("opencode:opencode/gpt-5-nano", "bypassPermissions", False, ["plan"]),
    ],
)
async def test_chat_permission_mode_unsupported_by_adapter(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    model_id: str,
    agent_permission_mode: str,
    expect_raises: bool,
    expect_mapped_modes: list[str] | None,
) -> None:
    # Cross-agent bypassPermissions: Codex raises; others fall back safely.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id=model_id)

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id=model_id,
        prompt="hello",
        permission_mode=agent_permission_mode,
    )
    assert send_response.status_code == 200, send_response.text
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    if expect_raises:
        assert message["stream_status"] == "failed"
        return
    assert message["stream_status"] == "completed"
    set_modes = fake_agent.events_of("set_session_mode")
    assert set_modes
    assert expect_mapped_modes is not None
    # Leading mode-sets are the chat session; title-gen opens another later.
    leading = [m["mode_id"] for m in set_modes[: len(expect_mapped_modes)]]
    assert leading == expect_mapped_modes


async def test_chat_default_permission_mode_is_sent_to_agent(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt="hello",
        permission_mode="default",
    )
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=response.json()["message_id"]
    )

    assert message["stream_status"] == "completed"
    assert fake_agent.events_of("set_session_mode")[0]["mode_id"] == "default"


@pytest.mark.parametrize(
    "model_id,first_mode,second_mode,respawns",
    [
        # Grok bakes approval into its launch flags, so a mode change respawns.
        ("grok:grok-4.5", "auto", "always-approve", True),
        ("sonnet", "default", "acceptEdits", False),
    ],
)
async def test_permission_mode_change_respawns_only_launch_baked_agents(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    model_id: str,
    first_mode: str,
    second_mode: str,
    respawns: bool,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id=model_id)

    for mode in (first_mode, second_mode):
        response = await send_message(
            client,
            headers,
            chat_id=chat["id"],
            model_id=model_id,
            prompt=f"turn in {mode}",
            permission_mode=mode,
        )
        message = await wait_for_message(
            client,
            headers,
            chat_id=chat["id"],
            message_id=response.json()["message_id"],
        )
        assert message["stream_status"] == "completed"

    first, second = fake_agent.main_turn_prompts()
    assert second["session_id"] == first["session_id"]
    if not respawns:
        assert second["pid"] == first["pid"]
        assert fake_agent.events_of("set_session_mode")[-1]["mode_id"] == second_mode
        return
    assert second["pid"] != first["pid"]
    argv = {e["pid"]: e["argv"] for e in fake_agent.events_of("initialize")}
    assert argv[first["pid"]] == ["agent", "--reasoning-effort", "medium", "stdio"]
    assert argv[second["pid"]] == [
        "agent",
        "--always-approve",
        "--reasoning-effort",
        "medium",
        "stdio",
    ]


@pytest.mark.parametrize(
    "model_id,permission_mode,files,native_blocks,noted,not_noted",
    [
        pytest.param(
            "gpt-5.4",
            "auto",
            [
                ("photo.png", PNG_BYTES, "image/png"),
                ("doc.pdf", PDF_BYTES, "application/pdf"),
            ],
            {"image"},
            ["doc.pdf"],
            ["photo.png"],
            id="codex-embeds-image-notes-pdf",
        ),
        pytest.param(
            "sonnet",
            "default",
            [("doc.pdf", PDF_BYTES, "application/pdf")],
            {"resource"},
            [],
            ["doc.pdf"],
            id="claude-embeds-pdf",
        ),
    ],
)
async def test_chat_attachments_embed_native_types_and_note_the_rest(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    model_id: str,
    permission_mode: str,
    files: list[tuple[str, bytes, str]],
    native_blocks: set[str],
    noted: list[str],
    not_noted: list[str],
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id=model_id)

    response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id=model_id,
        prompt="look at these files",
        permission_mode=permission_mode,
        attached_files=[("attached_files", file) for file in files],
    )
    assert response.status_code == 200, response.text
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=response.json()["message_id"]
    )
    assert message["stream_status"] == "completed"

    prompt = fake_agent.main_turn_prompts()[-1]
    assert set(prompt["block_types"]) - {"text"} == native_blocks
    for name in noted:
        assert f"{name} is available at" in prompt["text"]
    for name in not_noted:
        assert f"{name} is available at" not in prompt["text"]


@pytest.mark.parametrize(
    "option_id,expect_permission_mode,expect_status",
    [
        ("acceptEdits", "acceptEdits", "tool_completed"),
        ("reject-once", None, "tool_completed"),
        ("plan", "plan", "tool_failed"),
        ("", None, "tool_failed"),
    ],
)
async def test_chat_permission_response_flow(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    option_id: str,
    expect_permission_mode: str | None,
    expect_status: str,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_PERMISSION} edit it",
    )
    message_id = send_response.json()["message_id"]

    permission_event = await wait_for_message_event(
        client, headers, message_id=message_id, event_type="permission_request"
    )
    payload = permission_event["render_payload"]
    request_id = payload["request_id"]
    option_ids = {opt["option_id"] for opt in payload["data"]["options"]}
    assert option_ids == {"acceptEdits", "reject-once", "plan"}

    status_path = f"/api/v1/chat/chats/{chat['id']}/status"
    pending_status = await client.get(status_path, headers=headers)
    assert pending_status.status_code == 200, pending_status.text
    assert pending_status.json()["pending_permissions"] == [
        {
            "request_id": request_id,
            "tool_name": payload["tool_name"],
            "tool_input": payload["tool_input"],
            "options": payload["data"]["options"],
            "seq": permission_event["seq"],
        }
    ]

    respond = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/permissions/{request_id}/respond",
        data={"option_id": option_id},
        headers=headers,
    )
    assert respond.status_code == 200, respond.text
    assert respond.json() == {"success": True}

    # Responding twice must fail cleanly (no pending future left to resolve).
    respond_again = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/permissions/{request_id}/respond",
        data={"option_id": option_id},
        headers=headers,
    )
    assert respond_again.status_code == 404

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"
    resolved_status = await client.get(status_path, headers=headers)
    assert resolved_status.json()["pending_permissions"] == []

    tool = last_tool(message, "tool-permission")
    assert tool["status"] == expect_status.removeprefix("tool_")
    assert tool.get("permission_mode") == expect_permission_mode


@pytest.mark.parametrize(
    "action,content,expected_response",
    [
        (
            "accept",
            {"question_0": "Red"},
            {"action": "accept", "content": {"question_0": "Red"}},
        ),
        ("decline", None, {"action": "decline"}),
        ("cancel", None, {"action": "cancel"}),
    ],
)
async def test_chat_elicitation_response_flow(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    action: str,
    content: dict[str, str] | None,
    expected_response: dict[str, Any],
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")
    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_ELICITATION} choose",
    )
    message_id = send_response.json()["message_id"]

    event = await wait_for_message_event(
        client, headers, message_id=message_id, event_type="elicitation_request"
    )
    request_id = event["render_payload"]["request_id"]
    response = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/elicitation/{request_id}/respond",
        json={"request_id": request_id, "action": action, "content": content},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"success": True}

    response_again = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/elicitation/{request_id}/respond",
        json={"request_id": request_id, "action": action, "content": content},
        headers=headers,
    )
    assert response_again.status_code == 404

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"
    assert expected_response in [
        event["response"] for event in fake_agent.events_of("elicitation_response")
    ]


async def test_chat_elicitation_request_is_published_and_hydrated_until_answered(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    channel = REDIS_KEY_USER_STREAMS_LIVE.format(user_id=workspace.user_id)
    pubsub = acp_cache.store.pubsub()
    await pubsub.subscribe(channel)
    chat = await create_chat(client, headers, workspace, model_id="sonnet")
    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_ELICITATION} choose",
    )
    message_id = send_response.json()["message_id"]

    event = await wait_for_message_event(
        client, headers, message_id=message_id, event_type="elicitation_request"
    )
    initialize = fake_agent.events_of("initialize")[-1]
    assert initialize["client_capabilities"]["elicitation"] == {"form": {}}
    payload = event["render_payload"]
    request_id = payload["request_id"]
    assert payload["data"] == {
        "message": "Choose a color",
        "tool_call_id": "tool-elicitation",
        "requested_schema": ELICITATION_REQUESTED_SCHEMA,
    }

    live_payload = None
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        published = await pubsub.get_message(timeout=0.25)
        if published is None:
            continue
        envelope = json.loads(published["data"])
        if envelope["kind"] == "elicitation_request":
            live_payload = envelope["payload"]
            break
    await pubsub.unsubscribe(channel)
    assert live_payload == payload

    # A turn blocked on the user outlives the idle reaper.
    await session_registry.close_idle_sessions(ttl_seconds=0)
    status_path = f"/api/v1/chat/chats/{chat['id']}/status"
    pending_status = await client.get(status_path, headers=headers)
    assert pending_status.status_code == 200, pending_status.text
    assert pending_status.json()["pending_elicitations"] == [
        {"request_id": request_id, **payload["data"]}
    ]

    response = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/elicitation/{request_id}/respond",
        json={"request_id": request_id, "action": "decline", "content": None},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    resolved_status = await client.get(status_path, headers=headers)
    assert resolved_status.json()["pending_elicitations"] == []
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"


async def test_chat_cancel_pending_elicitation_returns_cancel_and_dismisses(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")
    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_ELICITATION} choose",
    )
    message_id = send_response.json()["message_id"]
    event = await wait_for_message_event(
        client, headers, message_id=message_id, event_type="elicitation_request"
    )
    request_id = event["render_payload"]["request_id"]

    channel = REDIS_KEY_USER_STREAMS_LIVE.format(user_id=workspace.user_id)
    pubsub = acp_cache.store.pubsub()
    await pubsub.subscribe(channel)

    cancel_response = await client.delete(
        f"/api/v1/chat/chats/{chat['id']}/stream", headers=headers
    )
    assert cancel_response.status_code == 204

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        responses = fake_agent.events_of("elicitation_response")
        if responses:
            break
        await asyncio.sleep(0.05)
    else:
        raise AssertionError("fake agent never received elicitation cancel response")
    assert responses[-1]["response"] == {"action": "cancel"}

    dismissed_payload = None
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        message = await pubsub.get_message(timeout=0.25)
        if message is None:
            continue
        envelope = json.loads(message["data"])
        if envelope["kind"] == "elicitation_dismissed":
            dismissed_payload = envelope["payload"]
            break
    assert dismissed_payload == {"request_id": request_id}
    await pubsub.unsubscribe(channel)
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "interrupted"


async def test_concurrent_elicitations_share_tool_id_but_resolve_independently(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")
    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_CONCURRENT_ELICITATIONS} choose",
    )
    message_id = send_response.json()["message_id"]

    deadline = time.monotonic() + 10.0
    elicitation_events: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        events_response = await client.get(
            f"/api/v1/chat/messages/{message_id}/events", headers=headers
        )
        assert events_response.status_code == 200, events_response.text
        elicitation_events = [
            event
            for event in events_response.json()
            if event["event_type"] == "elicitation_request"
        ]
        if len(elicitation_events) == 2:
            break
        await asyncio.sleep(0.05)
    else:
        raise AssertionError("two concurrent elicitation requests never arrived")

    payloads = [event["render_payload"] for event in elicitation_events]
    first_id = payloads[0]["request_id"]
    second_id = payloads[1]["request_id"]
    assert first_id != second_id
    assert [payload["data"]["message"] for payload in payloads] == [
        "First question",
        "Second question",
    ]
    assert {payload["data"]["tool_call_id"] for payload in payloads} == {
        "tool-concurrent-elicitations"
    }

    status_response = await client.get(
        f"/api/v1/chat/chats/{chat['id']}/status", headers=headers
    )
    assert status_response.status_code == 200, status_response.text
    assert status_response.json()["pending_elicitations"] == [
        {"request_id": payload["request_id"], **payload["data"]} for payload in payloads
    ]

    second_response = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/elicitation/{second_id}/respond",
        json={
            "request_id": second_id,
            "action": "accept",
            "content": {"question_0": "Blue"},
        },
        headers=headers,
    )
    assert second_response.status_code == 200, second_response.text

    middle_status = await client.get(
        f"/api/v1/chat/chats/{chat['id']}/status", headers=headers
    )
    assert middle_status.status_code == 200, middle_status.text
    assert middle_status.json()["pending_elicitations"] == [
        {"request_id": first_id, **payloads[0]["data"]}
    ]

    first_response = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/elicitation/{first_id}/respond",
        json={
            "request_id": first_id,
            "action": "accept",
            "content": {"question_0": "Red"},
        },
        headers=headers,
    )
    assert first_response.status_code == 200, first_response.text
    await wait_for_message(client, headers, chat_id=chat["id"], message_id=message_id)

    assert [
        {"action": "accept", "content": {"question_0": "Red"}},
        {"action": "accept", "content": {"question_0": "Blue"}},
    ] in [
        event["responses"]
        for event in fake_agent.events_of("concurrent_elicitation_responses")
    ]


async def wait_for_channel_activity(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    channel_id: str,
    predicate: Any,
) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    while True:
        response = await client.get(
            f"/api/v1/channels/{channel_id}/member-activity", headers=headers
        )
        assert response.status_code == 200, response.text
        if predicate(response.json()):
            return dict(response.json())
        assert time.monotonic() < deadline, response.json()
        await asyncio.sleep(0.05)


@pytest.mark.parametrize(
    "resolution,expected_response",
    [
        ("answer", {"action": "accept", "content": {"question_0": "Red"}}),
        ("stop", {"action": "cancel"}),
    ],
)
async def test_channel_member_question_waits_for_the_owner(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    resolution: str,
    expected_response: dict[str, Any],
) -> None:
    monkeypatch.setattr(channel_module, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "DEBOUNCE_SECONDS", 0.1)
    headers, workspace = auth_workspace
    channel = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [{"model_id": "sonnet", "display_name": "alice"}],
        },
        headers=headers,
    )
    assert channel.status_code == 201, channel.text
    channel_id = channel.json()["id"]
    [member] = channel.json()["members"]
    posted = await client.post(
        f"/api/v1/channels/{channel_id}/messages",
        data={"content": f"{MARKER_ELICITATION} choose"},
        headers=headers,
    )
    assert posted.status_code == 201, posted.text

    activity = await wait_for_channel_activity(
        client, headers, channel_id, lambda activity: activity["elicitations"]
    )
    [pending] = activity["elicitations"]
    request_id = pending["request"]["request_id"]
    assert pending == {
        "member_id": member["id"],
        "chat_id": member["chat_id"],
        "request": {
            "request_id": request_id,
            "message": "Choose a color",
            "tool_call_id": "tool-elicitation",
            "requested_schema": ELICITATION_REQUESTED_SCHEMA,
        },
    }
    assert activity["waiting_member_ids"] == [member["id"]]
    snapshot = await client.get(f"/api/v1/channels/{channel_id}", headers=headers)
    assert snapshot.json()["activity"]["elicitations"] == [pending]
    assert fake_agent.events_of("elicitation_response") == []

    respond_path = f"/api/v1/chat/chats/{member['chat_id']}/elicitation"
    unknown = await client.post(
        f"{respond_path}/elicit-99/respond",
        json={"request_id": "elicit-99", "action": "decline", "content": None},
        headers=headers,
    )
    assert unknown.status_code == 404
    if resolution == "answer":
        response = await client.post(
            f"{respond_path}/{request_id}/respond",
            json={
                "request_id": request_id,
                "action": "accept",
                "content": {"question_0": "Red"},
            },
            headers=headers,
        )
        assert response.status_code == 200, response.text
    else:
        stopped = await client.post(
            f"/api/v1/channels/{channel_id}/stop", headers=headers
        )
        assert stopped.status_code == 204, stopped.text

    activity = await wait_for_channel_activity(
        client, headers, channel_id, lambda activity: not activity["member_ids"]
    )
    assert activity["elicitations"] == []
    assert activity["waiting_member_ids"] == []
    assert [
        event["response"] for event in fake_agent.events_of("elicitation_response")
    ] == [expected_response]
    await client.delete(f"/api/v1/channels/{channel_id}", headers=headers)


async def test_unanswered_channel_member_question_is_declined_on_timeout(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(channel_module, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "DEBOUNCE_SECONDS", 0.1)
    monkeypatch.setattr(acp_client_module, "CHANNEL_ELICITATION_TIMEOUT_SECONDS", 0)
    headers, workspace = auth_workspace
    channel = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [{"model_id": "sonnet", "display_name": "alice"}],
        },
        headers=headers,
    )
    assert channel.status_code == 201, channel.text
    channel_id = channel.json()["id"]
    posted = await client.post(
        f"/api/v1/channels/{channel_id}/messages",
        data={"content": f"{MARKER_ELICITATION} choose"},
        headers=headers,
    )
    assert posted.status_code == 201, posted.text

    deadline = time.monotonic() + 10
    while not fake_agent.events_of("elicitation_response"):
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)
    assert fake_agent.events_of("elicitation_response")[0]["response"] == {
        "action": "decline"
    }
    activity = await wait_for_channel_activity(
        client, headers, channel_id, lambda activity: not activity["member_ids"]
    )
    assert activity["elicitations"] == []
    assert activity["waiting_member_ids"] == []
    await client.delete(f"/api/v1/channels/{channel_id}", headers=headers)


@pytest.mark.parametrize(
    "option_id,expect_response",
    [
        ("Red", {"outcome": "accepted", "answers": {"Pick a color": "Red"}}),
        ("", {"outcome": "skip_interview"}),
    ],
)
async def test_chat_ask_user_question_flow(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    option_id: str,
    expect_response: dict[str, Any],
) -> None:
    # Grok ask_user_question ext → permission_request; answer is the response.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="grok:grok-4.5")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="grok:grok-4.5",
        prompt=f"{MARKER_ASK_USER_QUESTION} choose",
    )
    message_id = send_response.json()["message_id"]

    question_event = await wait_for_message_event(
        client, headers, message_id=message_id, event_type="permission_request"
    )
    payload = question_event["render_payload"]
    assert payload["tool_name"] == "AskUserQuestion"
    assert payload["tool_input"] == {"question": "Pick a color"}
    # Request ids are suffixed per question so they can't collide with the
    # tool_call_id-keyed permission requests.
    assert payload["request_id"] == "tool-ask-user:q0"
    assert [opt["option_id"] for opt in payload["data"]["options"]] == ["Red", "Blue"]

    respond = await client.post(
        f"/api/v1/chat/chats/{chat['id']}/permissions/{payload['request_id']}/respond",
        data={"option_id": option_id},
        headers=headers,
    )
    assert respond.status_code == 200, respond.text

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"

    # Tool raw_output is the client's ext response; skip fake-agent log (title-gen noise).
    tool = last_tool(message, "tool-ask-user")
    assert tool["status"] == "completed"
    assert tool["result"] == expect_response


async def test_chat_cancel_marks_message_interrupted(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_CANCEL} run long task",
    )
    message_id = send_response.json()["message_id"]

    # Cancel only once the agent is blocked mid-turn, not before the turn starts.
    await wait_for_message_event(
        client, headers, message_id=message_id, event_type="tool_started"
    )

    cancel_response = await client.delete(
        f"/api/v1/chat/chats/{chat['id']}/stream", headers=headers
    )
    assert cancel_response.status_code == 204

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "interrupted"


async def test_chat_resume_after_session_eviction_mutes_replayed_history(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    first = await send_message(
        client, headers, chat_id=chat["id"], model_id="sonnet", prompt="first turn"
    )
    first_message_id = first.json()["message_id"]
    first_result = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=first_message_id
    )
    assert first_result["stream_status"] == "completed"

    chat_detail = await client.get(f"/api/v1/chat/chats/{chat['id']}", headers=headers)
    assert chat_detail.status_code == 200
    assert chat_detail.json()["session_agent_kind"] == "claude"
    # session_id isn't exposed on the Chat API schema; read it off the prompt.
    session_id = fake_agent.main_turn_prompts()[-1]["session_id"]

    await session_registry.close_idle_sessions(ttl_seconds=0)
    monkeypatch.setenv("FAKE_ACP_SCENARIO", "load_session_replay")

    second = await send_message(
        client, headers, chat_id=chat["id"], model_id="sonnet", prompt="second turn"
    )
    second_message_id = second.json()["message_id"]
    second_result = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=second_message_id
    )
    assert second_result["stream_status"] == "completed"

    load_sessions = fake_agent.events_of("load_session")
    assert load_sessions
    assert load_sessions[-1]["session_id"] == session_id

    all_text = "".join(
        e.get("text", "")
        for e in second_result["content_render"]["events"]
        if e["type"] == "assistant_text"
    )
    assert "REPLAYED_HISTORY_SHOULD_BE_MUTED" not in all_text
    assert DEFAULT_TURN_TEXT in all_text


async def test_chat_provider_switch_hands_off_context(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    async def run_turn(
        model_id: str, permission_mode: str, prompt: str
    ) -> dict[str, Any]:
        response = await send_message(
            client,
            headers,
            chat_id=chat["id"],
            model_id=model_id,
            prompt=prompt,
            permission_mode=permission_mode,
        )
        message = await wait_for_message(
            client,
            headers,
            chat_id=chat["id"],
            message_id=response.json()["message_id"],
        )
        assert message["stream_status"] == "completed"
        return fake_agent.main_turn_prompts()[-1]

    claude = await run_turn("sonnet", "default", "claude one")
    codex = await run_turn("gpt-5.4", "auto", "codex two")
    assert codex["session_id"] != claude["session_id"]
    assert "<previous_conversation>" in codex["text"]
    assert "claude one" in codex["text"]

    # Back on Claude: resume its own session and replay only Codex's turn.
    claude_again = await run_turn("sonnet", "default", "claude three")
    assert claude_again["session_id"] == claude["session_id"]
    assert (
        fake_agent.events_of("load_session")[-1]["session_id"] == claude["session_id"]
    )
    assert "codex two" in claude_again["text"]
    assert "claude one" not in claude_again["text"]

    same_kind = await run_turn("sonnet", "default", "claude four")
    assert "<previous_conversation>" not in same_kind["text"]

    # A tool-only cancel isn't proof of delivery, so Codex's next turn still
    # carries the Claude turns since its last settled reply.
    cancelled = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="gpt-5.4",
        prompt=f"{MARKER_CANCEL} codex cancelled",
        permission_mode="auto",
    )
    assert cancelled.status_code == 200, cancelled.text
    cancelled_id = cancelled.json()["message_id"]
    await wait_for_message_event(
        client, headers, message_id=cancelled_id, event_type="tool_started"
    )
    await client.delete(f"/api/v1/chat/chats/{chat['id']}/stream", headers=headers)
    interrupted = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=cancelled_id
    )
    assert interrupted["stream_status"] == "interrupted"
    after_cancel = await run_turn("gpt-5.4", "auto", "codex after cancel")
    assert after_cancel["session_id"] == codex["session_id"]
    assert "claude four" in after_cancel["text"]

    # Codex lost its session: fall back to a fresh one with the whole history.
    await run_turn("sonnet", "default", "claude five")
    monkeypatch.setenv("FAKE_ACP_SCENARIO", "load_session_missing")
    fallback = await run_turn("gpt-5.4", "auto", "codex five")
    assert fallback["session_id"] not in (codex["session_id"], claude["session_id"])
    assert "claude one" in fallback["text"]
    assert "claude four" in fallback["text"]

    # The slash guard must also see a transcript the stale-session fallback adds.
    await session_registry.terminate(chat["id"])
    stale_slash = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="gpt-5.4",
        prompt="/review",
        permission_mode="auto",
    )
    stale_slash_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=stale_slash.json()["message_id"]
    )
    assert stale_slash_message["stream_status"] == "failed"
    assert "Send a regular message first" in stale_slash_message["content_text"]

    # A slash command can't carry the transcript, so it must not become the anchor.
    slash = await send_message(
        client, headers, chat_id=chat["id"], model_id="sonnet", prompt="/review"
    )
    slash_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=slash.json()["message_id"]
    )
    assert slash_message["stream_status"] == "failed"
    assert "Send a regular message first" in slash_message["content_text"]


@pytest.mark.parametrize("scenario", ["model_error", "config_error"])
async def test_chat_model_and_permission_mode_errors_fail(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
) -> None:
    monkeypatch.setenv("FAKE_ACP_SCENARIO", scenario)
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="gpt-5.4")

    first = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="gpt-5.4",
        prompt="first turn",
        permission_mode="auto",
    )
    assert first.status_code == 200, first.text
    first_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=first.json()["message_id"]
    )
    assert first_message["stream_status"] == "failed"
    if scenario == "model_error":
        assert "rejected model `gpt-5.4`" in first_message["content_text"]
    else:
        assert fake_agent.events_of("set_session_mode")[-1]["mode_id"] == "agent"
    assert fake_agent.main_turn_prompts() == []


async def test_chat_recovers_on_next_turn_after_rejected_model(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_ACP_SCENARIO", "model_error")
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="gpt-5.4")

    failed = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="gpt-5.4",
        prompt="first turn",
        permission_mode="auto",
    )
    failed_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=failed.json()["message_id"]
    )
    assert failed_message["stream_status"] == "failed"

    monkeypatch.delenv("FAKE_ACP_SCENARIO")
    recovered = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="gpt-5.6-luna",
        prompt="second turn",
        permission_mode="auto",
    )
    recovered_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=recovered.json()["message_id"]
    )
    assert recovered_message["stream_status"] == "completed"
    set_models = [
        event["value"]
        for event in fake_agent.events_of("set_config_option")
        if event["config_id"] == "model"
    ]
    assert "gpt-5.6-luna" in set_models


async def test_copilot_mid_session_model_switch_reapplies_supported_effort(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="copilot:grok-4.5")

    first = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="copilot:grok-4.5",
        prompt="first turn",
        permission_mode="agent",
        thinking_mode="high",
    )
    first_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=first.json()["message_id"]
    )
    assert first_message["stream_status"] == "completed"

    event_count = len(fake_agent.events())
    second = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="copilot:claude-opus-5",
        prompt="second turn",
        permission_mode="agent",
        thinking_mode="high",
    )
    second_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=second.json()["message_id"]
    )
    assert second_message["stream_status"] == "completed"

    switch_events = fake_agent.events()[event_count:]
    assert not any(
        event["event"] in {"new_session", "load_session"} for event in switch_events
    )
    switch_calls = [
        event for event in switch_events if event["event"] == "set_config_option"
    ]
    assert [(event["config_id"], event["value"]) for event in switch_calls] == [
        ("model", "claude-opus-5"),
        ("reasoning_effort", "high"),
    ]

    no_dial_chat = await create_chat(
        client, headers, workspace, model_id="copilot:auto"
    )
    no_dial_first = await send_message(
        client,
        headers,
        chat_id=no_dial_chat["id"],
        model_id="copilot:auto",
        prompt="first no-dial turn",
        permission_mode="agent",
        thinking_mode="high",
    )
    no_dial_first_message = await wait_for_message(
        client,
        headers,
        chat_id=no_dial_chat["id"],
        message_id=no_dial_first.json()["message_id"],
    )
    assert no_dial_first_message["stream_status"] == "completed"

    event_count = len(fake_agent.events())
    no_dial_second = await send_message(
        client,
        headers,
        chat_id=no_dial_chat["id"],
        model_id="copilot:claude-haiku-4.5",
        prompt="second no-dial turn",
        permission_mode="agent",
        thinking_mode="high",
    )
    no_dial_second_message = await wait_for_message(
        client,
        headers,
        chat_id=no_dial_chat["id"],
        message_id=no_dial_second.json()["message_id"],
    )
    assert no_dial_second_message["stream_status"] == "completed"

    no_dial_switch_events = fake_agent.events()[event_count:]
    assert not any(
        event["event"] in {"new_session", "load_session"}
        for event in no_dial_switch_events
    )
    no_dial_switch_calls = [
        event
        for event in no_dial_switch_events
        if event["event"] == "set_config_option"
    ]
    assert [(event["config_id"], event["value"]) for event in no_dial_switch_calls] == [
        ("model", "claude-haiku-4.5")
    ]


async def test_mcp_server_reaches_the_agent_and_session_is_reused_across_turns(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A fresh token per turn (real mints differ once a second has passed) must
    # not change the session fingerprint, or every turn respawns the agent.
    mints = iter(("token-one", "token-two", "token-three", "token-four"))
    monkeypatch.setattr(
        "app.services.agent.create_mcp_access_token",
        lambda user_id, hashed_password, device_ids: next(mints),
    )
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    for prompt in ("first turn", "second turn"):
        response = await send_message(
            client,
            headers,
            chat_id=chat["id"],
            model_id="sonnet",
            prompt=prompt,
        )
        assert response.status_code == 200, response.text
        message = await wait_for_message(
            client,
            headers,
            chat_id=chat["id"],
            message_id=response.json()["message_id"],
        )
        assert message["stream_status"] == "completed"

    first, second = fake_agent.main_turn_prompts()
    assert second["pid"] == first["pid"]

    [chat_session] = [
        e for e in fake_agent.events_of("new_session") if e["pid"] == first["pid"]
    ]
    [mcp_server] = chat_session["mcp_servers"]
    assert mcp_server["name"] == "agentrove"
    assert mcp_server["command"] == sys.executable
    mcp_env = {v["name"]: v["value"] for v in mcp_server["env"]}
    assert mcp_env["AGENTROVE_ACCESS_TOKEN"].startswith("token-")
    assert mcp_env["AGENTROVE_CURRENT_CHAT_ID"] == chat["id"]
    assert "AGENTROVE_EMAIL" not in mcp_env
    assert "AGENTROVE_PASSWORD" not in mcp_env


def docker_mcp_server(
    user_id: str,
    hashed_password: str,
    *,
    workspace_id: str,
    chat_id: str | None,
    session_id: str,
) -> dict[str, Any]:
    [server] = AgentService._build_mcp_server_configs(
        user_id,
        hashed_password,
        frozenset(),
        SandboxProviderType.DOCKER,
        agentrove_mcp=True,
        workspace_id=workspace_id,
        current_chat_id=chat_id,
        session_id=session_id,
    )
    return server


def docker_session_config(
    user_id: str, hashed_password: str, session_id: str
) -> AcpSessionConfig:
    return AcpSessionConfig(
        sandbox_id="sandbox",
        sandbox_provider=SandboxProviderType.DOCKER,
        cwd="",
        user_id=user_id,
        device_ids=frozenset(),
        mcp_servers=[
            docker_mcp_server(
                user_id,
                hashed_password,
                workspace_id="workspace-1",
                chat_id="chat-1",
                session_id=session_id,
            )
        ],
        mcp_session_id=session_id,
    )


async def test_docker_sandbox_gets_http_mcp_without_respawning_per_turn() -> None:
    # Sandbox agents reach the backend's HTTP MCP endpoint with a token no REST
    # route accepts; the per-spawn bearer must not change the fingerprint, while
    # a password change still must.
    user_id = str(uuid4())

    first = docker_session_config(user_id, "hash-one", "session-1")
    second = docker_session_config(user_id, "hash-one", "session-2")
    [server] = first.mcp_servers
    assert server["type"] == "http"
    assert server["url"] == f"{get_settings().SANDBOX_API_URL}/api/v1/mcp"
    assert set(server["headers"]) == {"Authorization", "X-Agentrove-Credential-Epoch"}
    claims = jwt.decode(
        server["headers"]["Authorization"].removeprefix("Bearer "),
        options={"verify_signature": False},
    )
    assert claims["aud"] == ["agentrove:sandbox-mcp"]
    assert "mcp" not in claims
    assert (claims["sub"], claims["wid"], claims["cid"], claims["sid"]) == (
        user_id,
        "workspace-1",
        "chat-1",
        "session-1",
    )
    assert claims["did"] == [] and claims["pwd"] and claims["exp"]
    [http_server] = AcpSession._build_mcp_servers(first.mcp_servers)
    assert isinstance(http_server, HttpMcpServer)
    assert http_server.model_dump(by_alias=True)["type"] == "http"
    assert {h.name: h.value for h in http_server.headers} == server["headers"]

    assert second.mcp_servers != first.mcp_servers
    fingerprint = SessionRegistry._compute_fingerprint(first)
    assert SessionRegistry._compute_fingerprint(second) == fingerprint
    assert (
        SessionRegistry._compute_fingerprint(
            docker_session_config(user_id, "hash-two", "session-1")
        )
        != fingerprint
    )


async def mcp_list_tools(
    client: httpx.AsyncClient, authorization: dict[str, str]
) -> httpx.Response:
    return await mcp_post(client, authorization, "tools/list", {})


async def mcp_call_tool(
    client: httpx.AsyncClient,
    authorization: dict[str, str],
    name: str,
    **arguments: Any,
) -> dict[str, Any]:
    response = await mcp_post(
        client, authorization, "tools/call", {"name": name, "arguments": arguments}
    )
    assert response.status_code == 200, response.text
    return dict(response.json()["result"])


async def mcp_post(
    client: httpx.AsyncClient,
    authorization: dict[str, str],
    method: str,
    params: dict[str, Any],
) -> httpx.Response:
    return await client.post(
        "/api/v1/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        headers={
            "Host": "api:8080",
            "Accept": "application/json, text/event-stream",
            **authorization,
        },
    )


class SpawnLiveness:
    def __init__(self) -> None:
        self.create = AcpSession.create
        self.live_while_spawning: dict[str, bool] = {}

    async def __call__(self, config: AcpSessionConfig) -> AcpSession:
        if config.mcp_servers:
            self.live_while_spawning[config.mcp_session_id] = (
                session_registry.is_mcp_session_live(config.mcp_session_id)
            )
        return await self.create(config)


async def test_sandbox_token_only_opens_the_mcp_endpoint_while_its_session_lives(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    fake_agent: FakeAgentHandle,
    auth_workspace: tuple[dict[str, str], Workspace],
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, workspace = auth_workspace
    user = await db_session.get_one(User, workspace.user_id)
    chat = await create_chat(client, headers, workspace, model_id="sonnet")
    spawn = SpawnLiveness()
    monkeypatch.setattr(AcpSession, "create", spawn)
    response = await send_message(
        client, headers, chat_id=chat["id"], model_id="sonnet", prompt="spawn"
    )
    assert response.status_code == 200, response.text
    await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=response.json()["message_id"]
    )
    live_session_id = session_registry._sessions[chat["id"]].mcp_session_id
    # Agents connect to their MCP servers while the session is being created.
    assert spawn.live_while_spawning == {live_session_id: True}
    other_workspace = Workspace(
        name="Other",
        user_id=user.id,
        sandbox_id="sandbox-other",
        sandbox_provider="docker",
        workspace_path=workspace.workspace_path,
        source_type="empty",
    )
    db_session.add(other_workspace)
    await db_session.commit()
    other_chat = await create_chat_row(db_session, user, other_workspace)

    def sandbox_authorization(
        chat_id: str | None = chat["id"], session_id: str = live_session_id
    ) -> dict[str, str]:
        server = docker_mcp_server(
            str(user.id),
            user.hashed_password,
            workspace_id=str(workspace.id),
            chat_id=chat_id,
            session_id=session_id,
        )
        return {"Authorization": server["headers"]["Authorization"]}

    authorization = sandbox_authorization()
    token = authorization["Authorization"].removeprefix("Bearer ")
    for path in ("/api/v1/workspaces", "/api/v1/settings/", "/api/v1/auth/me"):
        assert (await client.get(path, headers=authorization)).status_code == 401
    assert await authenticate_websocket_user(token) is None

    async with main_module.mcp_endpoint.run():
        # The bound workspace is still a host workspace: no sandbox boundary.
        assert (await mcp_list_tools(client, authorization)).status_code == 401
        workspace.sandbox_provider = "docker"
        await db_session.commit()

        accepted = await mcp_list_tools(client, authorization)
        assert accepted.status_code == 200, accepted.text
        tools = {tool["name"] for tool in accepted.json()["result"]["tools"]}
        assert {"get_current_chat", "list_workspaces", "attach_file"} <= tools
        assert (
            await mcp_list_tools(client, sandbox_authorization(chat_id=None))
        ).status_code == 200

        host_token = create_mcp_access_token(
            str(user.id), user.hashed_password, frozenset()
        )
        for rejected in (
            {},
            headers,
            {"Authorization": f"Bearer {host_token}"},
            sandbox_authorization(chat_id=str(other_chat.id)),
            sandbox_authorization(session_id="never-spawned"),
        ):
            assert (await mcp_list_tools(client, rejected)).status_code == 401

        # Soft deletes reject on their own: the session id stays registered.
        chatless = sandbox_authorization(chat_id=None)
        chat_row = await db_session.get_one(Chat, UUID(chat["id"]))
        chat_row.deleted_at = datetime.now(timezone.utc)
        await db_session.commit()
        assert (await mcp_list_tools(client, authorization)).status_code == 401
        assert (await mcp_list_tools(client, chatless)).status_code == 200
        workspace.deleted_at = datetime.now(timezone.utc)
        await db_session.commit()
        assert (await mcp_list_tools(client, chatless)).status_code == 401
        chat_row.deleted_at = workspace.deleted_at = None
        await db_session.commit()
        assert session_registry.is_mcp_session_live(live_session_id)
        assert (await mcp_list_tools(client, authorization)).status_code == 200

        await session_registry.close_idle_sessions(ttl_seconds=0)
        assert (await mcp_list_tools(client, authorization)).status_code == 401


def minted_mcp_tokens(fake_agent: FakeAgentHandle) -> list[str]:
    return [
        variable["value"]
        for event in fake_agent.events_of("new_session")
        for server in event["mcp_servers"]
        for variable in server.get("env") or []
        if variable["name"] == "AGENTROVE_ACCESS_TOKEN"
    ]


async def run_automation_turn(
    client: httpx.AsyncClient, headers: dict[str, str], automation_id: str
) -> dict[str, Any]:
    run = await client.post(f"/api/v1/automations/{automation_id}/run", headers=headers)
    assert run.status_code == 200, run.text
    chat_id = run.json()["chat_id"]
    messages = await client.get(
        f"/api/v1/chat/chats/{chat_id}/messages", headers=headers
    )
    [assistant] = [m for m in messages.json()["items"] if m["role"] == "assistant"]
    return await wait_for_message(
        client, headers, chat_id=chat_id, message_id=assistant["id"]
    )


async def run_scheduled_automation_turn(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    db_session: AsyncSession,
    automation_id: str,
) -> dict[str, Any]:
    await db_session.execute(
        update(Automation)
        .where(Automation.id == UUID(automation_id))
        .values(next_run_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    )
    await db_session.commit()
    await AutomationService(
        ChatService(UserService(), session_factory=SessionLocal),
        session_factory=SessionLocal,
    ).run_due_automations()
    chat_id = await db_session.scalar(
        select(Chat.id).order_by(Chat.created_at.desc()).limit(1)
    )
    return await wait_for_latest_assistant(client, headers, str(chat_id))


async def test_device_automation_stops_minting_tokens_once_device_is_revoked(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    pairing = await client.post("/api/v1/auth/pairing", headers=headers)
    paired = (
        await client.post(
            "/api/v1/auth/pair",
            json={"secret": pairing.json()["secret"], "device_name": "Laptop"},
        )
    ).json()
    automation = await client.post(
        "/api/v1/automations",
        json={
            "name": "Nightly",
            "prompt": "Summarize",
            "model_id": "sonnet",
            "cron_expression": "0 9 * * *",
            "workspace_id": str(workspace.id),
        },
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    assert automation.status_code == 201, automation.text
    first_run = await run_scheduled_automation_turn(
        client, headers, db_session, automation.json()["id"]
    )
    assert first_run["stream_status"] == "completed"
    [token, *_] = minted_mcp_tokens(fake_agent)
    agent_headers = {"Authorization": f"Bearer {token}"}
    assert (
        await client.get("/api/v1/workspaces", headers=agent_headers)
    ).status_code == 200
    minted_before_revoke = len(minted_mcp_tokens(fake_agent))

    chats_before_revoke = await db_session.scalar(select(func.count(Chat.id)))

    await client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    await db_session.execute(
        update(Automation)
        .where(Automation.id == UUID(automation.json()["id"]))
        .values(next_run_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    )
    await db_session.commit()
    await AutomationService(
        ChatService(UserService(), session_factory=SessionLocal),
        session_factory=SessionLocal,
    ).run_due_automations()
    manual_run = await client.post(
        f"/api/v1/automations/{automation.json()['id']}/run", headers=headers
    )

    assert (
        await client.get("/api/v1/workspaces", headers=agent_headers)
    ).status_code == 401
    assert manual_run.status_code == 403
    assert "paired device behind this run has been revoked" in manual_run.text
    assert await db_session.scalar(select(func.count(Chat.id))) == chats_before_revoke
    assert len(minted_mcp_tokens(fake_agent)) == minted_before_revoke


async def pair_device(
    client: httpx.AsyncClient, headers: dict[str, str], name: str
) -> dict[str, Any]:
    pairing = await client.post("/api/v1/auth/pairing", headers=headers)
    paired = await client.post(
        "/api/v1/auth/pair",
        json={"secret": pairing.json()["secret"], "device_name": name},
    )
    return dict(paired.json())


@pytest.mark.parametrize(
    ("posts", "revoked", "expected"),
    [
        (
            [("A", "@alice review this"), ("B", "@bob test that")],
            "A",
            {"alice": (["A", "B"], 401), "bob": (["A", "B"], 401)},
        ),
        (
            [("A", "@alice review this"), ("B", "@bob test that")],
            "B",
            {"alice": (["A", "B"], 401), "bob": (["A", "B"], 401)},
        ),
        (
            [("A", "@bob review this"), ("B", "@alice test that")],
            "A",
            {"alice": (["A", "B"], 401), "bob": (["A", "B"], 401)},
        ),
        (
            [("A", "@alice first"), ("B", "@alice second")],
            "A",
            {"alice": (["A", "B"], 401)},
        ),
        (
            [("A", "@alice first"), ("B", "@alice second")],
            "B",
            {"alice": (["A", "B"], 401)},
        ),
    ],
)
async def test_channel_turn_acts_for_the_devices_behind_its_prompt(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    posts: list[tuple[str, str]],
    revoked: str,
    expected: dict[str, tuple[list[str], int]],
) -> None:
    monkeypatch.setattr(channel_module, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "DEBOUNCE_SECONDS", 0.5)
    headers, workspace = auth_workspace
    devices = {name: await pair_device(client, headers, name) for name in ("A", "B")}
    channel = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [
                {
                    "model_id": "sonnet",
                    "permission_mode": "bypassPermissions",
                    "display_name": name,
                }
                for name in ("alice", "bob")
            ],
        },
        headers=headers,
    )
    assert channel.status_code == 201, channel.text
    channel_id = channel.json()["id"]

    for device, content in posts:
        posted = await client.post(
            f"/api/v1/channels/{channel_id}/messages",
            data={"content": content},
            headers={"Authorization": f"Bearer {devices[device]['access_token']}"},
        )
        assert posted.status_code == 201, posted.text
    deadline = time.monotonic() + 10
    while len(fake_agent.main_turn_prompts()) < len(expected):
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)
    await client.post(f"/api/v1/channels/{channel_id}/stop", headers=headers)
    await client.delete(f"/api/v1/channels/{channel_id}", headers=headers)
    await client.delete(
        f"/api/v1/auth/devices/{devices[revoked]['device_id']}", headers=headers
    )

    tokens = {
        event["pid"]: variable["value"]
        for event in fake_agent.events_of("new_session")
        for server in event["mcp_servers"]
        for variable in server.get("env") or []
        if variable["name"] == "AGENTROVE_ACCESS_TOKEN"
    }
    actual = {}
    for prompt in fake_agent.main_turn_prompts():
        member = "alice" if "You are alice" in prompt["text"] else "bob"
        token = tokens[prompt["pid"]]
        claims = jwt.decode(token, options={"verify_signature": False})
        me = await client.get(
            "/api/v1/workspaces", headers={"Authorization": f"Bearer {token}"}
        )
        actual[member] = (sorted(claims["did"]), me.status_code)
    assert actual == {
        member: (sorted(devices[name]["device_id"] for name in names), status)
        for member, (names, status) in expected.items()
    }


async def test_channel_member_gets_its_chat_and_memory_only_with_agentrove_tools(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(channel_module, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "DEBOUNCE_SECONDS", 0.1)
    spawned: list[AcpSessionConfig] = []
    create = AcpSession.create

    async def record_spawn(config: AcpSessionConfig) -> AcpSession:
        spawned.append(config)
        return await create(config)

    monkeypatch.setattr(AcpSession, "create", record_spawn)

    async def send_via_app(
        agent: _SandboxClient, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        headers = {"Authorization": f"Bearer {agent._access_token}"}
        return await client.request(method, f"/api/v1{path}", headers=headers, **kwargs)

    monkeypatch.setattr(_SandboxClient, "_send", send_via_app)
    headers, workspace = auth_workspace
    pinned = await client.post(
        "/api/v1/memories",
        json={
            "title": "Pinned fact",
            "content": "pinned-memory-needle",
            "pinned": True,
            "workspace_id": str(workspace.id),
        },
        headers=headers,
    )
    assert pinned.status_code == 201, pinned.text
    channel = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [
                {
                    "model_id": "sonnet",
                    "permission_mode": mode,
                    "display_name": name,
                }
                for name, mode in (("alice", "bypassPermissions"), ("bob", "default"))
            ],
        },
        headers=headers,
    )
    assert channel.status_code == 201, channel.text
    channel_id = channel.json()["id"]
    member_chats = {m["display_name"]: m["chat_id"] for m in channel.json()["members"]}
    posted = await client.post(
        f"/api/v1/channels/{channel_id}/messages",
        data={"content": "hello"},
        headers=headers,
    )
    assert posted.status_code == 201, posted.text
    deadline = time.monotonic() + 10
    while len(fake_agent.main_turn_prompts()) < 2:
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)

    prompts = {
        "alice" if "You are alice" in p["text"] else "bob": p
        for p in fake_agent.main_turn_prompts()
    }
    sessions = {e["pid"]: e for e in fake_agent.events_of("new_session")}
    [alice_server] = sessions[prompts["alice"]["pid"]]["mcp_servers"]
    alice_env = {v["name"]: v["value"] for v in alice_server["env"]}
    assert alice_env["AGENTROVE_CURRENT_CHAT_ID"] == member_chats["alice"]
    assert sessions[prompts["bob"]["pid"]]["mcp_servers"] == []
    assert "pinned-memory-needle" in prompts["alice"]["text"]
    assert "<memory" not in prompts["bob"]["text"]
    [alice_config] = [c for c in spawned if c.mcp_servers]
    [bob_config] = [c for c in spawned if not c.mcp_servers]
    assert "<memory_instructions>" in (alice_config.system_prompt or "")
    assert "attached to your reply in the channel" in (alice_config.system_prompt or "")
    assert "memory" not in (bob_config.system_prompt or "")
    assert "attach_file" not in (bob_config.system_prompt or "")

    user = await db_session.get_one(User, workspace.user_id)
    workspace.sandbox_provider = "docker"
    await db_session.commit()
    server = docker_mcp_server(
        str(user.id),
        user.hashed_password,
        workspace_id=str(workspace.id),
        chat_id=member_chats["alice"],
        session_id=session_registry._sessions[member_chats["alice"]].mcp_session_id,
    )
    authorization = {"Authorization": server["headers"]["Authorization"]}
    async with main_module.mcp_endpoint.run():
        current = await mcp_call_tool(client, authorization, "get_current_chat")
        assert current["structuredContent"] == {"chat_id": member_chats["alice"]}
        remembered = await mcp_call_tool(
            client, authorization, "remember", title="Fact", content="member-needle"
        )
        assert not remembered.get("isError"), remembered
        found = await mcp_call_tool(
            client, authorization, "search_memory", query="member-needle"
        )
        assert [m["title"] for m in found["structuredContent"]["result"]] == ["Fact"]
        for name, arguments, reason in (
            ("notify_user", {"title": "Hi", "body": "Body"}, "-> 404"),
            ("stop_channel", {"channel_id": channel_id}, "Cannot stop a channel"),
            ("stop_chat", {"chat_id": member_chats["alice"]}, "Cannot stop the"),
            ("attach_file", {"path": "shot.png"}, "/attachments/sandbox -> 400"),
        ):
            refused = await mcp_call_tool(client, authorization, name, **arguments)
            assert refused["isError"], (name, refused)
            assert reason in refused["content"][0]["text"], (name, refused)
    workspace.sandbox_provider = "host"
    await db_session.commit()

    memories = await client.get(
        "/api/v1/memories",
        params={"workspace_id": str(workspace.id), "query": "member-needle"},
        headers=headers,
    )
    [memory] = memories.json()
    assert memory["workspace_id"] == str(workspace.id)
    assert memory["source_chat_id"] is None
    assert memory["source_model_id"] == "sonnet"
    assert (await client.get("/api/v1/inbox", headers=headers)).json()["items"] == []
    await client.post(f"/api/v1/channels/{channel_id}/stop", headers=headers)
    await client.delete(f"/api/v1/channels/{channel_id}", headers=headers)


@pytest.mark.parametrize("revoke", ["device", "password_reset"])
async def test_revocation_cancels_the_devices_running_turn(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    email_capture: EmailCapture,
    login: LoginClient,
    revoke: str,
) -> None:
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    device_headers = {"Authorization": f"Bearer {paired['access_token']}"}
    chat = await create_chat(client, device_headers, workspace, model_id="sonnet")
    sent = await send_message(
        client,
        device_headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_CANCEL} run long task",
    )
    message_id = sent.json()["message_id"]
    await wait_for_message_event(
        client, headers, message_id=message_id, event_type="tool_started"
    )

    if revoke == "device":
        await client.delete(
            f"/api/v1/auth/devices/{paired['device_id']}", headers=headers
        )
    else:
        await client.post(
            "/api/v1/auth/forgot-password", json={"email": "user@example.com"}
        )
        [reset] = email_capture.password_reset
        await client.post(
            "/api/v1/auth/reset-password",
            json={"token": reset["token"], "password": "newpassword123"},
        )
        tokens = await login(password="newpassword123")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    assert not ChatStreamRuntime.has_active_chat(chat["id"])
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "interrupted"


async def test_revocation_during_agent_startup_never_submits_the_prompt(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    gate = tmp_path / "new-session-gate"
    monkeypatch.setenv("FAKE_ACP_NEW_SESSION_GATE", str(gate))
    monkeypatch.setattr(session_registry_module, "PENDING_CANCEL_TTL_SECONDS", 0)
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    device_headers = {"Authorization": f"Bearer {paired['access_token']}"}
    chat = await create_chat(client, device_headers, workspace, model_id="sonnet")
    sent = await send_message(
        client, device_headers, chat_id=chat["id"], model_id="sonnet", prompt="work"
    )
    assert sent.status_code == 200, sent.text
    deadline = time.monotonic() + 10
    while not fake_agent.events_of("new_session"):
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)

    revoke = asyncio.create_task(
        client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    )
    while (
        await db_session.scalar(
            select(PairedDevice.revoked_at).where(
                PairedDevice.id == UUID(paired["device_id"])
            )
        )
        is None
    ):
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)
        db_session.expire_all()
    await asyncio.sleep(0.1)
    gate.touch()
    assert (await revoke).status_code == 204
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=sent.json()["message_id"]
    )

    assert message["stream_status"] in ("interrupted", "failed")
    assert fake_agent.main_turn_prompts() == []


async def wait_for_latest_assistant(
    client: httpx.AsyncClient, headers: dict[str, str], chat_id: str
) -> dict[str, Any]:
    messages = await client.get(
        f"/api/v1/chat/chats/{chat_id}/messages",
        headers=headers,
        params={"limit": 50},
    )
    assistant = max(
        (m for m in messages.json()["items"] if m["role"] == "assistant"),
        key=lambda m: m["created_at"],
    )
    return await wait_for_message(
        client, headers, chat_id=chat_id, message_id=assistant["id"]
    )


@pytest.mark.parametrize("revoke_parent_device", [False, True])
async def test_wake_ignores_the_devices_of_the_parents_last_turn(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    revoke_parent_device: bool,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 0)
    headers, workspace = auth_workspace
    pairing = await client.post("/api/v1/auth/pairing", headers=headers)
    paired = (
        await client.post(
            "/api/v1/auth/pair",
            json={"secret": pairing.json()["secret"], "device_name": "Laptop"},
        )
    ).json()
    parent = await create_chat(client, headers, workspace, model_id="sonnet")
    child = await create_chat(client, headers, workspace, model_id="sonnet")
    await db_session.execute(
        update(Chat)
        .where(Chat.id == UUID(child["id"]))
        .values(parent_chat_id=UUID(parent["id"]))
    )
    await db_session.commit()
    started = await send_message(
        client, headers, chat_id=parent["id"], model_id="sonnet", prompt="first"
    )
    await wait_for_message(
        client, headers, chat_id=parent["id"], message_id=started.json()["message_id"]
    )

    queued = await client.post(
        f"/api/v1/chat/chats/{parent['id']}/queue",
        data={"content": "from laptop", "model_id": "sonnet", "send_now": "true"},
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    assert queued.status_code == 201, queued.text
    assert not queued.json()["send_now_failed"]
    await wait_for_latest_assistant(client, headers, parent["id"])
    if revoke_parent_device:
        await client.delete(
            f"/api/v1/auth/devices/{paired['device_id']}", headers=headers
        )
    wake = SubThreadWake()
    wake.on_chain_end(child["id"], parent["id"], frozenset())
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=5)
    wake_message = await wait_for_latest_assistant(client, headers, parent["id"])

    assert wake_message["stream_status"] == "completed"
    assert wake._pending == {}
    _, queued_turn, wake_turn = fake_agent.main_turn_prompts()
    assert "from laptop" in queued_turn["text"]
    assert "sub-threads you delegated have finished" in wake_turn["text"]
    assert child["id"] in wake_turn["text"]
    [wake_session] = [
        e
        for e in fake_agent.events()
        if e["event"] in ("new_session", "load_session")
        and e["pid"] == wake_turn["pid"]
    ]
    [token] = [
        v["value"]
        for server in wake_session["mcp_servers"]
        for v in server["env"]
        if v["name"] == "AGENTROVE_ACCESS_TOKEN"
    ]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["did"] == []


@pytest.mark.parametrize("revoke_before_wake", [False, True])
async def test_wake_acts_for_the_reporting_childs_devices(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    revoke_before_wake: bool,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 0)
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    device_headers = {"Authorization": f"Bearer {paired['access_token']}"}
    parent = await create_chat(client, headers, workspace, model_id="sonnet")
    child = await create_chat(client, device_headers, workspace, model_id="sonnet")
    await db_session.execute(
        update(Chat)
        .where(Chat.id == UUID(child["id"]))
        .values(parent_chat_id=UUID(parent["id"]))
    )
    await db_session.commit()
    sent = await send_message(
        client, device_headers, chat_id=child["id"], model_id="sonnet", prompt="work"
    )
    await wait_for_message(
        client, headers, chat_id=child["id"], message_id=sent.json()["message_id"]
    )
    if revoke_before_wake:
        await client.delete(
            f"/api/v1/auth/devices/{paired['device_id']}", headers=headers
        )

    wake = SubThreadWake()
    wake.on_chain_end(child["id"], parent["id"], frozenset({UUID(paired["device_id"])}))
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=5)

    if revoke_before_wake:
        [child_turn] = fake_agent.main_turn_prompts()
        assert "work" in child_turn["text"]
        assert wake._pending == {}
        return
    await wait_for_latest_assistant(client, headers, parent["id"])
    _, wake_turn = fake_agent.main_turn_prompts()
    assert "sub-threads you delegated have finished" in wake_turn["text"]
    [wake_session] = [
        e for e in fake_agent.events_of("new_session") if e["pid"] == wake_turn["pid"]
    ]
    [token] = [
        v["value"]
        for server in wake_session["mcp_servers"]
        for v in server["env"]
        if v["name"] == "AGENTROVE_ACCESS_TOKEN"
    ]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["did"] == [paired["device_id"]]
    await client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    me = await client.get(
        "/api/v1/workspaces", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 401


async def fail_to_resolve_cwd(*_args: Any) -> str:
    raise AgentException("Working directory unavailable")


@pytest.mark.parametrize(
    ("follow_up", "revoked", "wakes"),
    [("failed_start", "A", False), ("password", "A", False), ("B", "B", True)],
)
async def test_report_acts_for_the_devices_of_the_turn_that_filed_it(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    follow_up: str,
    revoked: str,
    wakes: bool,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 3600)
    wake = SubThreadWake()
    monkeypatch.setattr(runtime_module, "subthread_wake", wake)
    headers, workspace = auth_workspace
    devices = {name: await pair_device(client, headers, name) for name in ("A", "B")}
    device_headers = {
        name: {"Authorization": f"Bearer {device['access_token']}"}
        for name, device in devices.items()
    }
    parent = await create_chat(client, headers, workspace, model_id="sonnet")
    child = await create_chat(client, headers, workspace, model_id="sonnet")
    await db_session.execute(
        update(Chat)
        .where(Chat.id == UUID(child["id"]))
        .values(parent_chat_id=UUID(parent["id"]))
    )
    await db_session.commit()
    reported = await client.post(
        "/api/v1/chat/chat",
        data={
            "prompt": "work",
            "chat_id": child["id"],
            "model_id": "sonnet",
            "report_to_parent": "true",
        },
        headers=device_headers["A"],
    )
    assert reported.status_code == 200, reported.text
    await wait_for_message(
        client, headers, chat_id=child["id"], message_id=reported.json()["message_id"]
    )

    if follow_up == "failed_start":
        with monkeypatch.context() as patch:
            patch.setattr(AgentService, "resolve_cwd", fail_to_resolve_cwd)
            failed = await send_message(
                client,
                device_headers["B"],
                chat_id=child["id"],
                model_id="sonnet",
                prompt="follow up",
            )
        assert failed.status_code == 400, failed.text
    else:
        sent = await send_message(
            client,
            headers if follow_up == "password" else device_headers[follow_up],
            chat_id=child["id"],
            model_id="sonnet",
            prompt="follow up",
        )
        await wait_for_message(
            client, headers, chat_id=child["id"], message_id=sent.json()["message_id"]
        )
    await client.delete(
        f"/api/v1/auth/devices/{devices[revoked]['device_id']}", headers=headers
    )
    await wake._flush(parent["id"])
    for task in wake._tasks:
        task.cancel()

    assert wake._pending == {}
    parent_messages = await client.get(
        f"/api/v1/chat/chats/{parent['id']}/messages", headers=headers
    )
    assert bool(parent_messages.json()["items"]) is wakes
    if not wakes:
        return
    wake_message = await wait_for_latest_assistant(client, headers, parent["id"])
    assert wake_message["stream_status"] == "completed"
    wake_turn = fake_agent.main_turn_prompts()[-1]
    assert child["id"] in wake_turn["text"]
    assert did_of(minted_mcp_tokens(fake_agent)[-1]) == [devices["A"]["device_id"]]


@pytest.mark.parametrize(
    ("edit", "saver_kept"),
    [
        (None, True),
        ({"name": "Renamed"}, True),
        ({"prompt": "Summarize"}, True),
        ({"prompt": "Summarize again"}, False),
    ],
)
async def test_automation_turn_acts_for_the_devices_behind_its_saved_prompt(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    edit: dict[str, str] | None,
    saver_kept: bool,
) -> None:
    headers, workspace = auth_workspace
    saver = await pair_device(client, headers, "Laptop")
    other = await pair_device(client, headers, "Phone")
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    automation = await client.post(
        "/api/v1/automations",
        json={
            "name": "Nightly",
            "prompt": "Summarize",
            "model_id": "sonnet",
            "cron_expression": "0 9 * * *",
            "workspace_id": str(workspace.id),
        },
        headers={"Authorization": f"Bearer {saver['access_token']}"},
    )
    assert automation.status_code == 201, automation.text
    automation_id = automation.json()["id"]

    if edit is None:
        run = await run_automation_turn(client, other_headers, automation_id)
    else:
        edited = await client.patch(
            f"/api/v1/automations/{automation_id}", json=edit, headers=other_headers
        )
        assert edited.status_code == 200, edited.text
        run = await run_scheduled_automation_turn(
            client, headers, db_session, automation_id
        )

    assert run["stream_status"] == "completed"
    [token] = minted_mcp_tokens(fake_agent)
    claims = jwt.decode(token, options={"verify_signature": False})
    expected = [saver["device_id"]] if saver_kept else []
    assert sorted(claims["did"]) == sorted([*expected, other["device_id"]])
    await client.delete(f"/api/v1/auth/devices/{saver['device_id']}", headers=headers)
    me = await client.get(
        "/api/v1/workspaces", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == (401 if saver_kept else 200)


def did_of(token: str) -> list[str]:
    return list(jwt.decode(token, options={"verify_signature": False})["did"])


@pytest.mark.parametrize(
    ("attach", "content", "queuer_kept"),
    [
        (True, "rewritten", True),
        (False, "from laptop", True),
        (False, "rewritten", False),
    ],
)
async def test_edited_chat_queue_item_acts_for_the_devices_behind_what_survives(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
    attach: bool,
    content: str,
    queuer_kept: bool,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    chat = await create_chat(client, headers, workspace, model_id="sonnet")
    base = f"/api/v1/chat/chats/{chat['id']}/queue"
    queued = await client.post(
        base,
        data={"content": "from laptop", "model_id": "sonnet"},
        files=[("attached_files", ("shot.png", PNG_BYTES, "image/png"))]
        if attach
        else None,
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    assert queued.status_code == 201, queued.text
    item = f"{base}/{queued.json()['id']}"

    edited = await client.patch(item, json={"content": content}, headers=headers)
    assert edited.status_code == 200, edited.text
    assert bool(edited.json()["attachments"]) is attach
    assert (await client.post(f"{item}/send-now", headers=headers)).status_code == 204
    await wait_for_latest_assistant(client, headers, chat["id"])

    [token] = minted_mcp_tokens(fake_agent)
    assert did_of(token) == ([paired["device_id"]] if queuer_kept else [])
    await client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    me = await client.get(
        "/api/v1/workspaces", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == (401 if queuer_kept else 200)


async def test_edited_channel_queue_item_keeps_acting_for_the_device_that_queued_it(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "DEBOUNCE_SECONDS", 0.1)
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    channel = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [
                {
                    "model_id": "sonnet",
                    "permission_mode": "bypassPermissions",
                    "display_name": "alice",
                }
            ],
        },
        headers=headers,
    )
    assert channel.status_code == 201, channel.text
    channel_id = channel.json()["id"]
    channel_module.channel_service.states[UUID(channel_id)].paused = True
    base = f"/api/v1/channels/{channel_id}/queue"
    queued = await client.post(
        base,
        data={"content": "from laptop"},
        files=[("attached_files", ("shot.png", PNG_BYTES, "image/png"))],
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    assert queued.status_code == 201, queued.text
    item = f"{base}/{queued.json()['id']}"

    edited = await client.patch(item, json={"content": "rewritten"}, headers=headers)
    assert edited.status_code == 200, edited.text
    assert (await client.post(f"{item}/send-now", headers=headers)).status_code == 204
    deadline = time.monotonic() + 10
    while not minted_mcp_tokens(fake_agent):
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)
    await client.post(f"/api/v1/channels/{channel_id}/stop", headers=headers)
    await client.delete(f"/api/v1/channels/{channel_id}", headers=headers)

    [token] = minted_mcp_tokens(fake_agent)
    assert did_of(token) == [paired["device_id"]]
    await client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    me = await client.get(
        "/api/v1/workspaces", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 401


async def test_chat_send_now_acts_for_the_clicking_device(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    chat = await create_chat(client, headers, workspace, model_id="sonnet")
    base = f"/api/v1/chat/chats/{chat['id']}/queue"
    queued = await client.post(
        base,
        data={"content": f"{MARKER_CANCEL} run long task", "model_id": "sonnet"},
        headers=headers,
    )
    assert queued.status_code == 201, queued.text

    sent = await client.post(
        f"{base}/{queued.json()['id']}/send-now",
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    assert sent.status_code == 204, sent.text
    messages = await client.get(
        f"/api/v1/chat/chats/{chat['id']}/messages", headers=headers
    )
    [assistant] = [m for m in messages.json()["items"] if m["role"] == "assistant"]
    await wait_for_message_event(
        client, headers, message_id=assistant["id"], event_type="tool_started"
    )

    [token] = minted_mcp_tokens(fake_agent)
    assert did_of(token) == [paired["device_id"]]
    await client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    assert not ChatStreamRuntime.has_active_chat(chat["id"])
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=assistant["id"]
    )
    assert message["stream_status"] == "interrupted"
    me = await client.get(
        "/api/v1/workspaces", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 401


async def test_channel_send_now_acts_for_the_clicking_device(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "DEBOUNCE_SECONDS", 0.1)
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    channel = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [
                {
                    "model_id": "sonnet",
                    "permission_mode": "bypassPermissions",
                    "display_name": "alice",
                }
            ],
        },
        headers=headers,
    )
    assert channel.status_code == 201, channel.text
    channel_id = channel.json()["id"]
    channel_module.channel_service.states[UUID(channel_id)].paused = True
    base = f"/api/v1/channels/{channel_id}/queue"
    queued = await client.post(base, data={"content": "from password"}, headers=headers)
    assert queued.status_code == 201, queued.text

    sent = await client.post(
        f"{base}/{queued.json()['id']}/send-now",
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    assert sent.status_code == 204, sent.text
    deadline = time.monotonic() + 10
    while not minted_mcp_tokens(fake_agent):
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)
    await client.post(f"/api/v1/channels/{channel_id}/stop", headers=headers)
    await client.delete(f"/api/v1/channels/{channel_id}", headers=headers)

    [token] = minted_mcp_tokens(fake_agent)
    assert did_of(token) == [paired["device_id"]]
    await client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    me = await client.get(
        "/api/v1/workspaces", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 401


async def test_channel_send_now_keeps_the_clicking_device_when_posting_fails(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(deps, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "cache_connection", acp_cache.connect)
    monkeypatch.setattr(channel_module, "DEBOUNCE_SECONDS", 0.1)
    headers, workspace = auth_workspace
    paired = await pair_device(client, headers, "Laptop")
    channel = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [
                {
                    "model_id": "sonnet",
                    "permission_mode": "bypassPermissions",
                    "display_name": "alice",
                }
            ],
        },
        headers=headers,
    )
    assert channel.status_code == 201, channel.text
    channel_id = channel.json()["id"]
    [member] = channel.json()["members"]
    channel_module.channel_service.states[UUID(channel_id)].paused = True
    base = f"/api/v1/channels/{channel_id}/queue"
    queued = await client.post(base, data={"content": "from password"}, headers=headers)
    assert queued.status_code == 201, queued.text
    item = f"{base}/{queued.json()['id']}"

    with monkeypatch.context() as patch:
        patch.setattr(
            channel_module.channel_service,
            "post",
            AsyncMock(side_effect=RuntimeError("post failed")),
        )
        with pytest.raises(RuntimeError):
            await client.post(
                f"{item}/send-now",
                headers={"Authorization": f"Bearer {paired['access_token']}"},
            )
    await client.delete(f"/api/v1/auth/devices/{paired['device_id']}", headers=headers)
    assert (await client.post(f"{item}/send-now", headers=headers)).status_code == 204
    deadline = time.monotonic() + 10
    while not await db_session.scalar(
        select(ChannelDelivery.message_id).where(
            ChannelDelivery.member_id == UUID(member["id"])
        )
    ):
        assert time.monotonic() < deadline
        await asyncio.sleep(0.05)
        db_session.expire_all()
    await client.post(f"/api/v1/channels/{channel_id}/stop", headers=headers)
    await client.delete(f"/api/v1/channels/{channel_id}", headers=headers)

    assert fake_agent.main_turn_prompts() == []
    assert minted_mcp_tokens(fake_agent) == []


async def test_manual_automation_run_is_bound_to_the_clicking_device(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    headers, workspace = auth_workspace
    pairing = await client.post("/api/v1/auth/pairing", headers=headers)
    paired = (
        await client.post(
            "/api/v1/auth/pair",
            json={"secret": pairing.json()["secret"], "device_name": "Laptop"},
        )
    ).json()
    automation = await client.post(
        "/api/v1/automations",
        json={
            "name": "Nightly",
            "prompt": "Summarize",
            "model_id": "sonnet",
            "cron_expression": "0 9 * * *",
            "workspace_id": str(workspace.id),
        },
        headers=headers,
    )
    assert automation.status_code == 201, automation.text

    run = await run_automation_turn(
        client,
        {"Authorization": f"Bearer {paired['access_token']}"},
        automation.json()["id"],
    )

    assert run["stream_status"] == "completed"
    [token] = minted_mcp_tokens(fake_agent)
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["did"] == [paired["device_id"]]
