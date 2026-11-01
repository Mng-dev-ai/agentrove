import asyncio
import json
import os
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import REDIS_KEY_USER_STREAMS_LIVE
from app.core.config import get_settings
from app.models.db_models.workspace import Workspace
from app.services.session_registry import session_registry
from app.services.streaming.runtime import ChatStreamRuntime
from tests.conftest import LoginClient, UserFactory
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
from tests.helpers import EndpointCache, create_authenticated_workspace

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
        # Codex and Antigravity encode the (default) effort tier in the model id.
        ("gpt-5.4", "gpt-5.4[medium]"),
        ("antigravity:gemini-3.1-pro", "gemini-pro-agent"),
        ("copilot:gpt-5.4", "gpt-5.4"),
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
    assert [s["name"] for s in new_sessions[-1]["mcp_servers"]] == ["agentrove"]
    assert [
        e["value"]
        for e in fake_agent.events_of("set_config_option")
        if e["config_id"] == "model"
    ] == [agent_model_id]


@pytest.mark.parametrize(
    "model_id,thinking_mode,expected_status,expected_effort",
    [
        ("copilot:gpt-5.4", "xhigh", "completed", "xhigh"),
        ("copilot:claude-haiku-4.5", "high", "completed", None),
        # An explicit tier the model lacks fails the turn instead of clamping.
        ("copilot:kimi-k3", "medium", "failed", None),
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
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id=model_id)

    response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id=model_id,
        prompt="reason carefully",
        permission_mode="agent",
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


async def test_enhance_prompt_survives_config_option_failures(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_agent: FakeAgentHandle,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Claude sets its reasoning effort via set_config_option right after the
    # handshake; session.py must swallow a failure there and still run the turn.
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="config-error@example.com"
    )
    monkeypatch.setenv("FAKE_ACP_SCENARIO", "config_error")

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
    set_modes = fake_agent.events_of("set_session_mode")
    assert set_modes
    assert set_modes[-1]["mode_id"] == "plan"


@pytest.mark.parametrize(
    "model_id,agent_permission_mode,expect_raises,expect_mapped_modes",
    [
        ("gpt-5.4", "bypassPermissions", True, None),
        (
            "copilot:gpt-5.4",
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


async def test_chat_mid_session_model_and_mode_switch_survives_config_errors(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Codex reuses session across model/mode change → hits set_model/set_mode.
    monkeypatch.setenv("FAKE_ACP_SCENARIO", "config_error")
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
    assert first_message["stream_status"] == "completed"
    assert any(e["type"] == "plan" for e in first_message["content_render"]["events"])

    second = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="gpt-5.6-luna",
        prompt="second turn",
        permission_mode="read-only",
    )
    assert second.status_code == 200, second.text
    second_message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=second.json()["message_id"]
    )
    assert second_message["stream_status"] == "completed"

    set_models = [
        event
        for event in fake_agent.events_of("set_config_option")
        if event["config_id"] == "model"
    ]
    assert len(set_models) >= 2
    assert set_models[-1]["value"] == "gpt-5.6-luna[medium]"

    set_modes = fake_agent.events_of("set_session_mode")
    assert set_modes
    assert set_modes[-1]["mode_id"] == "read-only"


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
        model_id="copilot:claude-opus-4.6",
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
        ("model", "claude-opus-4.6"),
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
        model_id="copilot:kimi-k2.7-code",
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
        ("model", "kimi-k2.7-code")
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
        "app.services.agent.create_mcp_access_token", lambda user_id: next(mints)
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
