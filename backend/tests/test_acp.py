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

from app.core.config import get_settings
from app.models.db_models.workspace import Workspace
from app.services.session_registry import session_registry
from tests.conftest import LoginClient, UserFactory
from tests.fake_acp_agent import (
    MARKER_ASK_USER_QUESTION,
    MARKER_CANCEL,
    MARKER_CRASH_MID_PROMPT,
    MARKER_ENTER_PLAN_MODE,
    MARKER_FS_TERMINAL_STUBS,
    MARKER_IMAGE_CONTENT,
    MARKER_PERMISSION,
    MARKER_RAW_INPUT_INVALID,
    MARKER_RAW_INPUT_STRING,
    MARKER_TOOL_CODEX_ERROR,
    MARKER_TOOL_DIFF,
    MARKER_TOOL_EMPTY_RESULT,
    MARKER_TOOL_LEFT_OPEN,
    MARKER_TOOL_PROGRESS_NEW,
    MARKER_TOOL_PROGRESS_ORPHAN,
    MARKER_TOOL_START_DIFF,
    MARKER_TOOL_STRING_ERROR,
    MARKER_TOOL_TEXT_ERROR,
    MARKER_TOOL_TEXT_RESULT,
    MARKER_TOOL_UNKNOWN_DICT_ERROR,
    NEW_SESSION_ID,
)
from tests.helpers import EndpointCache, create_authenticated_workspace

pytestmark = pytest.mark.anyio

FAKE_AGENT_SCRIPT = Path(__file__).resolve().parent / "fake_acp_agent.py"
BINARY_NAMES = [
    "claude-agent-acp",
    "codex-acp",
    "copilot",
    "cursor-agent",
    "grok",
    "opencode",
]

DEFAULT_TURN_TEXT = "Hello from the fake agent."

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
            if not e["text"].startswith("Generate a title for this message:")
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
    # Pin web-mode baseline — shell/.env may export real MCP/desktop settings.
    settings = get_settings()
    original = (
        settings.AGENTROVE_MCP_ENABLED,
        settings.AGENTROVE_MCP_EMAIL,
        settings.AGENTROVE_MCP_PASSWORD,
        settings.DESKTOP_MODE,
    )
    settings.AGENTROVE_MCP_ENABLED = False
    settings.AGENTROVE_MCP_EMAIL = None
    settings.AGENTROVE_MCP_PASSWORD = None
    settings.DESKTOP_MODE = False
    try:
        yield
    finally:
        (
            settings.AGENTROVE_MCP_ENABLED,
            settings.AGENTROVE_MCP_EMAIL,
            settings.AGENTROVE_MCP_PASSWORD,
            settings.DESKTOP_MODE,
        ) = original


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
    attached_files: list[tuple[str, tuple[str, bytes, str]]] | None = None,
) -> httpx.Response:
    data = {
        "prompt": prompt,
        "chat_id": chat_id,
        "model_id": model_id,
        "permission_mode": permission_mode,
    }
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
    "model_id",
    [
        "sonnet",
        "opus",
        "gpt-5.6-sol",
        "gpt-5.6-luna",
        "gpt-5.4",
        "copilot:gpt-5.4",
        "cursor:auto",
        "opencode:opencode/gpt-5-nano",
    ],
)
async def test_enhance_prompt_round_trips_through_real_acp_session(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_agent: FakeAgentHandle,
    model_id: str,
) -> None:
    # Real stdio ACP path through client/session/adapters, per agent kind.
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


@pytest.mark.parametrize(
    "scenario",
    ["crash_initialize", "crash_new_session"],
)
async def test_enhance_prompt_surfaces_session_creation_failure(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_agent: FakeAgentHandle,
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login, email=f"{scenario}@example.com"
    )
    monkeypatch.setenv("FAKE_ACP_SCENARIO", scenario)

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

    response = await enhance_prompt(client, headers, prompt="hi", model_id="opus")

    assert response.status_code == 200, response.text
    assert response.json() == {"enhanced_prompt": DEFAULT_TURN_TEXT}


@pytest.mark.parametrize(
    "marker,tool_id,field,expected",
    [
        (
            MARKER_TOOL_DIFF,
            "tool-primary",
            "result",
            {"diffs": [{"path": "app.py", "oldText": "old", "newText": "new"}]},
        ),
        (MARKER_TOOL_TEXT_RESULT, "tool-primary", "result", "plain text result"),
        (
            MARKER_TOOL_START_DIFF,
            "tool-primary",
            "result",
            {"diffs": [{"path": "app.py", "oldText": "old", "newText": "new"}]},
        ),
        (MARKER_TOOL_CODEX_ERROR, "tool-secondary", "error", "boom codex"),
        (MARKER_TOOL_STRING_ERROR, "tool-secondary", "error", "boom plain string"),
        (
            MARKER_TOOL_TEXT_ERROR,
            "tool-secondary",
            "error",
            "command failed: no output",
        ),
        (MARKER_TOOL_PROGRESS_NEW, "tool-new", "result", "synthesized result"),
        (MARKER_RAW_INPUT_STRING, "tool-primary", "input", {"path": "encoded.py"}),
        (MARKER_RAW_INPUT_INVALID, "tool-primary", "input", {"raw": "not-json{{"}),
        (MARKER_TOOL_EMPTY_RESULT, "tool-primary", "result", None),
        (
            MARKER_TOOL_UNKNOWN_DICT_ERROR,
            "tool-secondary",
            "error",
            str({"unexpected_key": "value"}),
        ),
    ],
)
async def test_chat_tool_call_extraction_variants(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
    marker: str,
    tool_id: str,
    field: str,
    expected: Any,
) -> None:
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client, headers, chat_id=chat["id"], model_id="sonnet", prompt=f"{marker} go"
    )
    assert send_response.status_code == 200, send_response.text
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"

    tool = last_tool(message, tool_id)
    assert tool[field] == expected

    # tool-orphan no-op and Claude plan forwarding are exercised on every turn.
    assert not any(e["tool"]["id"] == "tool-orphan" for e in tool_events(message))
    assert any(e["type"] == "plan" for e in message["content_render"]["events"])
    assert any(e["type"] == "system" for e in message["content_render"]["events"])


async def test_chat_tool_progress_orphan_update_is_a_no_op(
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
        prompt=f"{MARKER_TOOL_PROGRESS_ORPHAN} go",
    )
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"
    assert not any(e["tool"]["id"] == "tool-orphan" for e in tool_events(message))


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


async def test_chat_agent_calls_fs_and_terminal_stubs_without_error(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    # Agent-side calls to fs/terminal no-ops must still complete the turn.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    send_response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt=f"{MARKER_FS_TERMINAL_STUBS} go",
    )
    message_id = send_response.json()["message_id"]

    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"


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
    assert len([e for e in events if e["type"] == "assistant_text"]) == 2
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


async def test_chat_attachments_with_only_native_files_skip_the_note(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    # Codex image-only: all native → empty attachment note.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="gpt-5.4")

    response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="gpt-5.4",
        prompt="look at this photo",
        permission_mode="auto",
        attached_files=[("attached_files", ("photo.png", PNG_BYTES, "image/png"))],
    )
    assert response.status_code == 200, response.text
    message_id = response.json()["message_id"]
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"

    prompts = fake_agent.main_turn_prompts()
    assert prompts
    last_prompt = prompts[-1]
    assert "image" in last_prompt["block_types"]
    assert "is available at" not in last_prompt["text"]


async def test_chat_native_pdf_attachment_is_embedded_not_noted(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    # Claude PDF is native embed → EmbeddedResource/Blob path, not sandbox note.
    headers, workspace = auth_workspace
    chat = await create_chat(client, headers, workspace, model_id="sonnet")

    response = await send_message(
        client,
        headers,
        chat_id=chat["id"],
        model_id="sonnet",
        prompt="look at this doc",
        attached_files=[("attached_files", ("doc.pdf", PDF_BYTES, "application/pdf"))],
    )
    assert response.status_code == 200, response.text
    message_id = response.json()["message_id"]
    message = await wait_for_message(
        client, headers, chat_id=chat["id"], message_id=message_id
    )
    assert message["stream_status"] == "completed"

    prompts = fake_agent.main_turn_prompts()
    assert prompts
    last_prompt = prompts[-1]
    assert "resource" in last_prompt["block_types"]
    assert "is available at" not in last_prompt["text"]


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

    # Wait until the fake agent is actually blocked mid-turn (tool_started
    # observed) so the cancel request can't race ahead of turn start.
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        response = await client.get(
            f"/api/v1/chat/messages/{message_id}/events", headers=headers
        )
        if any(e["event_type"] == "tool_started" for e in response.json()):
            break
        await asyncio.sleep(0.05)
    else:
        raise AssertionError("fake agent never reached the blocking tool call")

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
    # session_id isn't exposed on the Chat API schema — the fake agent always
    # hands back the same fixed id, which load_session() below must be handed.
    session_id = NEW_SESSION_ID

    # Evict in-process session so next turn uses create(resume_session_id).
    await session_registry.terminate(chat["id"])
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

    set_models = fake_agent.events_of("set_session_model")
    assert len(set_models) >= 2
    assert set_models[-1]["model_id"] == "gpt-5.6-luna[medium]"

    set_modes = fake_agent.events_of("set_session_mode")
    assert set_modes
    assert set_modes[-1]["mode_id"] == "read-only"


async def test_chat_attachments_and_mcp_servers_reach_the_agent(
    client: httpx.AsyncClient,
    auth_workspace: tuple[dict[str, str], Workspace],
    fake_agent: FakeAgentHandle,
    acp_cache: EndpointCache,
) -> None:
    settings = get_settings()
    original = (
        settings.AGENTROVE_MCP_ENABLED,
        settings.AGENTROVE_MCP_EMAIL,
        settings.AGENTROVE_MCP_PASSWORD,
    )
    settings.AGENTROVE_MCP_ENABLED = True
    settings.AGENTROVE_MCP_EMAIL = "mcp@example.com"
    settings.AGENTROVE_MCP_PASSWORD = "mcp-password"
    try:
        headers, workspace = auth_workspace
        # Codex only treats "image" as natively embeddable — the pdf forces
        # the sandbox-note branch of session.py's attachment handling.
        chat = await create_chat(client, headers, workspace, model_id="gpt-5.4")

        response = await send_message(
            client,
            headers,
            chat_id=chat["id"],
            model_id="gpt-5.4",
            prompt="look at these files",
            permission_mode="auto",
            attached_files=[
                ("attached_files", ("photo.png", PNG_BYTES, "image/png")),
                ("attached_files", ("doc.pdf", PDF_BYTES, "application/pdf")),
            ],
        )
        assert response.status_code == 200, response.text
        message_id = response.json()["message_id"]
        message = await wait_for_message(
            client, headers, chat_id=chat["id"], message_id=message_id
        )
        assert message["stream_status"] == "completed"
    finally:
        (
            settings.AGENTROVE_MCP_ENABLED,
            settings.AGENTROVE_MCP_EMAIL,
            settings.AGENTROVE_MCP_PASSWORD,
        ) = original

    new_sessions = fake_agent.events_of("new_session")
    assert new_sessions
    mcp_servers = new_sessions[-1]["mcp_servers"]
    assert len(mcp_servers) == 1
    assert mcp_servers[0]["name"] == "agentrove"
    assert mcp_servers[0]["command"] == sys.executable

    prompts = fake_agent.main_turn_prompts()
    assert prompts
    last_prompt = prompts[-1]
    assert "image" in last_prompt["block_types"]
    assert "doc.pdf is available at" in last_prompt["text"]
