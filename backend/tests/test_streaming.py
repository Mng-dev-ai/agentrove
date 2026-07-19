import asyncio
import json
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
import uvicorn
from acp.schema import PermissionOption, ToolCallUpdate
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import event as sa_event
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import chat as chat_endpoint
from app.core import deps
from app.constants import MODELS, REDIS_KEY_USER_STREAMS_LIVE
from app.db.session import engine
from app.models.db_models.chat import Chat
from app.models.db_models.enums import MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.services.acp.client import AcpClientHandler
from app.services.acp.session import AcpSession, AcpSessionConfig
from app.services.session_registry import session_registry
from app.services import chat as chat_service_module
from app.services.sandbox_providers.base import SandboxProvider
from app.services.streaming import runtime as runtime_module
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import StreamEnvelope, StreamEvent

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    EndpointCache,
    FakeProviderFactory,
    create_authenticated_workspace,
)


TEST_MODEL_ID = "opencode:google-vertex-anthropic/claude-sonnet-4-5@20250929"
TEST_CONTEXT_WINDOW = MODELS[TEST_MODEL_ID].context_window

pytestmark = pytest.mark.anyio

# Sentinel script step: makes the fake ACP session block forever on this
# prompt (until the runtime cancels it), simulating a long-running turn.
BLOCK_FOREVER = object()


class ConnectionCounter:
    # NullPool has no checkedout() — count live DBAPI connections via pool
    # checkout/checkin events instead, which fire for every pool implementation.
    def __init__(self) -> None:
        self.active = 0

    def on_checkout(self, *_: Any) -> None:
        self.active += 1

    def on_checkin(self, *_: Any) -> None:
        self.active -= 1


@dataclass
class PermissionStep:
    # Mirrors AcpClientHandler.request_permission's inputs — pushed onto the
    # queue for real via the handler so respond_to_permission can resolve it.
    options: list[tuple[str, str, str]]
    tool_call_id: str
    on_response: dict[str, list[StreamEvent]]


class FakeAcpSession:
    # Duck-types AcpSession so AgentService/SessionRegistry run without spawn.
    def __init__(
        self,
        scripts: list[list[Any]],
        *,
        usage: dict[str, int] | None = None,
        total_cost_usd: float = 0.0,
        session_id: str = "acp-session-1",
    ) -> None:
        self.handler: AcpClientHandler | None = None
        self.configs: list[AcpSessionConfig] = []
        self.acp_session_id = session_id
        self._scripts = scripts
        self._call_index = 0
        self.usage = usage
        self.total_cost_usd = total_cost_usd
        self.alive = True
        self.cancel_calls = 0
        self.set_mode_calls: list[str] = []
        self.set_model_calls: list[tuple[str, str | None]] = []
        self.close_calls = 0
        self.prompt_calls: list[str] = []

    def is_alive(self) -> bool:
        return self.alive

    async def send_prompt(
        self,
        content: str,
        attachments: list[dict[str, Any]] | None = None,
        agent_kind: Any = None,
    ) -> None:
        assert self.handler is not None
        self.prompt_calls.append(content)
        self.handler.prepare_for_prompt()
        prompt_completed = False
        try:
            script = self._scripts[self._call_index]
            self._call_index += 1
            for step in script:
                if isinstance(step, PermissionStep):
                    await self._run_permission_step(step)
                elif step is BLOCK_FOREVER:
                    await asyncio.Event().wait()
                elif isinstance(step, BaseException):
                    raise step
                else:
                    self.handler.event_queue.put_nowait(step)
            prompt_completed = True
        finally:
            if self.usage is not None:
                self.handler.usage = self.usage
            self.handler.total_cost_usd = self.total_cost_usd
            self.handler.finish(prompt_completed=prompt_completed)

    async def _run_permission_step(self, step: PermissionStep) -> None:
        assert self.handler is not None
        options = [
            PermissionOption(kind="allow_once", name=name, option_id=option_id)
            for _kind, name, option_id in step.options
        ]
        tool_call = ToolCallUpdate(tool_call_id=step.tool_call_id)
        response = await self.handler.request_permission(
            options=options, session_id=self.acp_session_id, tool_call=tool_call
        )
        outcome = response.outcome
        option_id = getattr(outcome, "option_id", "")
        for event in step.on_response.get(option_id, []):
            self.handler.event_queue.put_nowait(event)

    async def cancel(self) -> None:
        self.cancel_calls += 1

    async def set_model(
        self, model_id: str, reasoning_effort: str | None = None
    ) -> None:
        self.set_model_calls.append((model_id, reasoning_effort))

    async def set_mode(self, mode_id: str) -> None:
        self.set_mode_calls.append(mode_id)

    async def close(self) -> None:
        self.close_calls += 1
        self.alive = False


class FakeAcpSessionFactory:
    def __init__(self) -> None:
        self.pending: list[FakeAcpSession] = []
        self.created: list[FakeAcpSession] = []

    def queue(self, session: FakeAcpSession) -> None:
        self.pending.append(session)

    async def create(self, config: AcpSessionConfig) -> FakeAcpSession:
        session = self.pending.pop(0)
        session.handler = AcpClientHandler(agent_kind=config.agent_kind)
        session.configs.append(config)
        if config.resume_session_id:
            session.acp_session_id = config.resume_session_id
        self.created.append(session)
        return session


@pytest.fixture(autouse=True)
def streaming_runtime_state_reset() -> Iterator[None]:
    # Both registries are process-wide singletons/class state — reset around
    # every test so a task or session left by one test can't leak into the next.
    ChatStreamRuntime._background_task_chat_ids.clear()
    session_registry._sessions.clear()
    session_registry._pending_cancels.clear()
    yield
    ChatStreamRuntime._background_task_chat_ids.clear()
    session_registry._sessions.clear()
    session_registry._pending_cancels.clear()


@pytest.fixture(autouse=True)
def fake_sandbox_provider(monkeypatch: pytest.MonkeyPatch) -> FakeProviderFactory:
    factory = FakeProviderFactory()
    monkeypatch.setattr(SandboxProvider, "create_provider", factory)
    return factory


@pytest.fixture
def acp_factory(monkeypatch: pytest.MonkeyPatch) -> FakeAcpSessionFactory:
    factory = FakeAcpSessionFactory()
    monkeypatch.setattr(AcpSession, "create", factory.create)
    return factory


@pytest.fixture
def streaming_cache(monkeypatch: pytest.MonkeyPatch) -> EndpointCache:
    cache = EndpointCache()
    # cache_connection is import-by-value — patch each call site, not utils.cache.
    monkeypatch.setattr(chat_endpoint, "cache_connection", cache.connect)
    monkeypatch.setattr(deps, "cache_connection", cache.connect)
    monkeypatch.setattr(chat_service_module, "cache_connection", cache.connect)
    monkeypatch.setattr(runtime_module, "cache_connection", cache.connect)
    return cache


async def create_chat_row(
    db_session: AsyncSession,
    user: User,
    workspace: Workspace,
    *,
    title: str = "Streaming Chat",
    session_id: str | None = None,
) -> Chat:
    chat = Chat(
        title=title,
        user_id=user.id,
        workspace_id=workspace.id,
        session_id=session_id,
    )
    db_session.add(chat)
    await db_session.commit()
    await db_session.refresh(chat)
    return chat


def find_background_task(chat_id: UUID) -> "asyncio.Task[str]":
    for task, chat_id_str in ChatStreamRuntime._background_task_chat_ids.items():
        if chat_id_str == str(chat_id) and not task.done():
            return task
    raise AssertionError(f"no running background task for chat {chat_id}")


async def run_background_task(chat_id: UUID, *, timeout: float = 5.0) -> str:
    task = find_background_task(chat_id)
    result = await asyncio.wait_for(task, timeout=timeout)
    # Done-callbacks (registry pruning) run via call_soon — give them a turn.
    await asyncio.sleep(0)
    return result


async def wait_for_message_event_type(
    client: AsyncClient,
    headers: dict[str, str],
    message_id: str,
    event_type: str,
    *,
    timeout: float = 2.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = await client.get(
            f"/api/v1/chat/messages/{message_id}/events", headers=headers
        )
        assert response.status_code == 200
        for event in response.json():
            if event["event_type"] == event_type:
                return event
        await asyncio.sleep(0.01)
    raise AssertionError(f"event type {event_type!r} not observed for {message_id}")


async def send_message(
    client: AsyncClient,
    headers: dict[str, str],
    chat: Chat,
    *,
    prompt: str = "Hello agent",
    permission_mode: str = "bypassPermissions",
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/chat/chat",
        data={
            "prompt": prompt,
            "chat_id": str(chat.id),
            "model_id": TEST_MODEL_ID,
            "permission_mode": permission_mode,
        },
        headers=headers,
    )
    assert response.status_code == 200
    return dict(response.json())


async def test_send_message_streams_full_turn_and_persists_final_snapshot(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    # Pre-set session_id so this isn't a "new chat" (avoids title-gen session).
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-1")

    tool_payload = {
        "id": "tool-1",
        "name": "Read",
        "title": "Read file",
        "status": "completed",
        "parent_id": None,
        "input": {"path": "README.md"},
        "result": "file contents",
    }
    script = [
        StreamEvent(type="assistant_text", text="Hello "),
        StreamEvent(type="assistant_text", text="world"),
        StreamEvent(type="tool_started", tool={**tool_payload, "status": "started"}),
        StreamEvent(type="tool_completed", tool=tool_payload),
        StreamEvent(
            type="usage",
            data={"input_tokens": 1500, "context_window": TEST_CONTEXT_WINDOW},
        ),
    ]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-1"))

    result = await send_message(client, headers, chat)
    message_id = result["message_id"]

    await run_background_task(chat.id)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    assert messages_response.status_code == 200
    items = messages_response.json()["items"]
    assistant_item = next(item for item in items if item["id"] == message_id)
    assert assistant_item["stream_status"] == MessageStreamStatus.COMPLETED.value
    assert assistant_item["content_text"] == "Hello world"
    events = assistant_item["content_render"]["events"]
    assert [e["type"] for e in events] == [
        "assistant_text",
        "assistant_text",
        "tool_started",
        "tool_completed",
    ]
    assert events[3]["tool"]["status"] == "completed"

    status_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=headers
    )
    assert status_response.status_code == 200
    assert status_response.json()["has_active_task"] is False

    # Snapshot wipes buffered events; "complete" after cleanup leaves one row.
    terminal_events_response = await client.get(
        f"/api/v1/chat/messages/{message_id}/events", headers=headers
    )
    assert terminal_events_response.status_code == 200
    terminal_events = terminal_events_response.json()
    assert [e["event_type"] for e in terminal_events] == ["complete"]

    context_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/context-usage", headers=headers
    )
    assert context_response.status_code == 200
    assert context_response.json() == {
        "tokens_used": 1500,
        "context_window": TEST_CONTEXT_WINDOW,
        "percentage": (1500 / TEST_CONTEXT_WINDOW) * 100,
    }


async def test_send_message_new_chat_generates_title_in_background(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id=None)

    main_script = [StreamEvent(type="assistant_text", text="Hi there")]
    title_script = [StreamEvent(type="assistant_text", text="Greeting Chat")]
    acp_factory.queue(FakeAcpSession([main_script], session_id="new-session-1"))
    acp_factory.queue(FakeAcpSession([title_script], session_id="title-session"))

    await send_message(client, headers, chat)
    await run_background_task(chat.id)

    # Title generation runs as an untracked fire-and-forget task (no handle to
    # await), so poll the chat detail endpoint until it lands.
    deadline = time.monotonic() + 2.0
    title = None
    while time.monotonic() < deadline:
        detail_response = await client.get(
            f"/api/v1/chat/chats/{chat.id}", headers=headers
        )
        assert detail_response.status_code == 200
        title = detail_response.json()["title"]
        if title == "Generated Title" or title == "Greeting Chat":
            break
        await asyncio.sleep(0.01)

    assert title == "Greeting Chat"
    await db_session.refresh(chat)
    assert chat.session_id == "new-session-1"


async def test_send_message_extracts_and_strips_prompt_suggestions(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-2")

    script = [
        StreamEvent(
            type="assistant_text",
            text=(
                'Done.\n<prompt_suggestions>["Add tests", "Update docs"]'
                "</prompt_suggestions>"
            ),
        ),
    ]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-2"))

    result = await send_message(client, headers, chat)
    await run_background_task(chat.id)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    assistant_item = next(item for item in items if item["id"] == result["message_id"])
    assert assistant_item["content_text"] == "Done."
    events = assistant_item["content_render"]["events"]
    assert events[-1] == {
        "type": "prompt_suggestions",
        "suggestions": ["Add tests", "Update docs"],
    }


async def test_permission_request_respond_allows_and_denies_then_stream_completes(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-3")

    allow_step = PermissionStep(
        options=[("allow_once", "Allow", "allow"), ("reject_once", "Reject", "reject")],
        tool_call_id="tool-allow",
        on_response={
            "allow": [StreamEvent(type="assistant_text", text="Wrote file. ")]
        },
    )
    deny_step = PermissionStep(
        options=[("allow_once", "Allow", "allow")],
        tool_call_id="tool-deny",
        on_response={"": [StreamEvent(type="assistant_text", text="Skipped action.")]},
    )
    script = [allow_step, deny_step]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-3"))

    result = await send_message(client, headers, chat)
    message_id = result["message_id"]

    allow_event = await wait_for_message_event_type(
        client, headers, message_id, "permission_request"
    )
    assert allow_event["render_payload"]["request_id"] == "tool-allow"

    allow_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/permissions/tool-allow/respond",
        data={"option_id": "allow"},
        headers=headers,
    )
    assert allow_response.status_code == 200
    assert allow_response.json() == {"success": True}

    deny_event = await wait_for_message_event_type(
        client, headers, message_id, "permission_request"
    )
    # After the first respond, a second (different) permission_request must
    # have been persisted for the deny step — same event_type, new request_id.
    deadline = time.monotonic() + 2.0
    while deny_event["render_payload"]["request_id"] != "tool-deny":
        if time.monotonic() > deadline:
            raise AssertionError("second permission_request never observed")
        events_response = await client.get(
            f"/api/v1/chat/messages/{message_id}/events", headers=headers
        )
        matches = [
            e
            for e in events_response.json()
            if e["event_type"] == "permission_request"
            and e["render_payload"]["request_id"] == "tool-deny"
        ]
        if matches:
            deny_event = matches[0]
            break
        await asyncio.sleep(0.01)

    deny_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/permissions/tool-deny/respond",
        headers=headers,
    )
    assert deny_response.status_code == 200

    await run_background_task(chat.id)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    assistant_item = next(item for item in items if item["id"] == message_id)
    assert assistant_item["stream_status"] == MessageStreamStatus.COMPLETED.value
    assert assistant_item["content_text"] == "Wrote file. Skipped action."


async def test_respond_to_permission_returns_404_for_unknown_request(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-x")

    response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/permissions/unknown-request/respond",
        data={"option_id": "allow"},
        headers=headers,
    )
    assert response.status_code == 404


async def test_cancel_stream_marks_message_interrupted(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-4")

    script = [StreamEvent(type="assistant_text", text="Working..."), BLOCK_FOREVER]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-4"))

    result = await send_message(client, headers, chat)
    message_id = result["message_id"]

    await wait_for_message_event_type(client, headers, message_id, "stream_started")

    cancel_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/stream", headers=headers
    )
    assert cancel_response.status_code == 204

    await run_background_task(chat.id)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    assistant_item = next(item for item in items if item["id"] == message_id)
    assert assistant_item["stream_status"] == MessageStreamStatus.INTERRUPTED.value

    terminal_events_response = await client.get(
        f"/api/v1/chat/messages/{message_id}/events", headers=headers
    )
    assert [e["event_type"] for e in terminal_events_response.json()] == ["cancelled"]


async def test_cancel_stream_is_a_noop_when_nothing_is_running(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-idle")

    response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/stream", headers=headers
    )
    assert response.status_code == 204


async def test_stream_failure_marks_message_failed_and_emits_bootstrap_error(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-5")

    script = [RuntimeError("boom")]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-5"))

    result = await send_message(client, headers, chat)
    message_id = result["message_id"]

    task = find_background_task(chat.id)
    with pytest.raises(RuntimeError, match="boom"):
        await asyncio.wait_for(task, timeout=5.0)
    await asyncio.sleep(0)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    assistant_item = next(item for item in items if item["id"] == message_id)
    assert assistant_item["stream_status"] == MessageStreamStatus.FAILED.value
    events = assistant_item["content_render"]["events"]
    assert events[-1]["type"] == "assistant_text"
    assert "Error: boom" in events[-1]["text"]

    # Terminal snapshot deletes the error MessageEvent; only content_render remains.
    error_events_response = await client.get(
        f"/api/v1/chat/messages/{message_id}/events", headers=headers
    )
    assert error_events_response.json() == []


async def test_queued_message_is_processed_automatically_after_stream_completes(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-6")

    # Same fingerprint across turns → one ACP session reused, not two.
    first_script = [StreamEvent(type="assistant_text", text="First turn done")]
    second_script = [StreamEvent(type="assistant_text", text="Second turn done")]
    acp_factory.queue(
        FakeAcpSession([first_script, second_script], session_id="resumed-6")
    )

    queue_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Follow-up prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    assert queue_response.status_code == 201

    first_result = await send_message(client, headers, chat, prompt="First prompt")
    first_message_id = first_result["message_id"]

    await run_background_task(chat.id)
    # Draining the queue starts a second background task in the same chain —
    # give the loop a moment to register it before searching again.
    await asyncio.sleep(0)
    await run_background_task(chat.id)

    queue_list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )
    assert queue_list_response.json() == []

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    assert len(items) == 4

    first_assistant = next(item for item in items if item["id"] == first_message_id)
    assert first_assistant["stream_status"] == MessageStreamStatus.COMPLETED.value

    second_assistant = next(
        item
        for item in items
        if item["role"] == "assistant" and item["id"] != first_message_id
    )
    assert second_assistant["stream_status"] == MessageStreamStatus.COMPLETED.value
    assert second_assistant["content_text"] == "Second turn done"

    second_user = next(
        item
        for item in items
        if item["role"] == "user" and item["content_text"] == "Follow-up prompt"
    )
    assert second_user is not None

    # Handoff survives snapshot; turn-one "complete" deferred to follow-up.
    first_events_response = await client.get(
        f"/api/v1/chat/messages/{first_message_id}/events", headers=headers
    )
    first_events = first_events_response.json()
    assert [e["event_type"] for e in first_events] == ["queue_processing"]
    assert first_events[0]["render_payload"]["content"] == "Follow-up prompt"


async def test_send_now_cancels_active_generation_and_starts_queued_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-7")

    first_script = [StreamEvent(type="assistant_text", text="Working"), BLOCK_FOREVER]
    second_script = [StreamEvent(type="assistant_text", text="Send-now turn done")]
    acp_factory.queue(
        FakeAcpSession([first_script, second_script], session_id="resumed-7")
    )

    queue_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Urgent follow-up", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    assert queue_response.status_code == 201
    queued_id = queue_response.json()["id"]

    first_result = await send_message(client, headers, chat, prompt="First prompt")
    first_message_id = first_result["message_id"]
    await wait_for_message_event_type(
        client, headers, first_message_id, "stream_started"
    )

    send_now_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now", headers=headers
    )
    assert send_now_response.status_code == 204

    await run_background_task(chat.id)
    await asyncio.sleep(0)
    await run_background_task(chat.id)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    first_assistant = next(item for item in items if item["id"] == first_message_id)
    assert first_assistant["stream_status"] == MessageStreamStatus.INTERRUPTED.value

    second_assistant = next(
        item
        for item in items
        if item["role"] == "assistant" and item["id"] != first_message_id
    )
    assert second_assistant["content_text"] == "Send-now turn done"
    assert second_assistant["stream_status"] == MessageStreamStatus.COMPLETED.value

    queue_list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )
    assert queue_list_response.json() == []


async def test_send_now_starts_immediately_when_chat_is_idle(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-8")

    script = [StreamEvent(type="assistant_text", text="Idle send-now turn")]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-8"))

    queue_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Idle follow-up", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    queued_id = queue_response.json()["id"]

    assert ChatStreamRuntime.has_active_chat(str(chat.id)) is False

    send_now_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now", headers=headers
    )
    assert send_now_response.status_code == 204

    await run_background_task(chat.id)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    assert len(items) == 2
    assistant_item = next(item for item in items if item["role"] == "assistant")
    assert assistant_item["content_text"] == "Idle send-now turn"
    assert assistant_item["stream_status"] == MessageStreamStatus.COMPLETED.value

    queue_list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )
    assert queue_list_response.json() == []


async def test_send_now_returns_404_for_unknown_queued_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    # Not used directly — routes get_queue_service to the in-memory cache so
    # the test doesn't require a live Redis (503 instead of 404 without it).
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-9")
    missing_id = UUID("00000000-0000-0000-0000-000000000042")

    response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{missing_id}/send-now", headers=headers
    )
    assert response.status_code == 404


async def test_active_streams_and_status_reflect_running_background_task(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-10")

    script = [BLOCK_FOREVER]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-10"))

    result = await send_message(client, headers, chat)
    message_id = result["message_id"]

    active_streams_response = await client.get(
        "/api/v1/chat/chats/active-streams", headers=headers
    )
    assert active_streams_response.status_code == 200
    active_streams = active_streams_response.json()
    assert len(active_streams) == 1
    assert active_streams[0]["chat_id"] == str(chat.id)
    assert active_streams[0]["message_id"] == message_id

    status_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=headers
    )
    assert status_response.status_code == 200
    status_body = status_response.json()
    assert status_body["has_active_task"] is True
    assert status_body["message_id"] == message_id

    # Clean up the still-running background task so it doesn't leak past
    # this test (the reset fixture only clears the registry, not live tasks).
    await wait_for_message_event_type(client, headers, message_id, "stream_started")
    cancel_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/stream", headers=headers
    )
    assert cancel_response.status_code == 204
    await run_background_task(chat.id)


async def test_active_streams_is_empty_when_user_has_no_running_chats(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get("/api/v1/chat/chats/active-streams", headers=headers)
    assert response.status_code == 200
    assert response.json() == []


async def test_message_events_endpoint_rejects_non_owner_and_unknown_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-12")
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="streaming-other@example.com",
        username="streamingother",
    )

    script = [StreamEvent(type="assistant_text", text="Owner only")]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-12"))
    result = await send_message(client, headers, chat)
    message_id = result["message_id"]
    await run_background_task(chat.id)

    owner_response = await client.get(
        f"/api/v1/chat/messages/{message_id}/events", headers=headers
    )
    assert owner_response.status_code == 200

    other_response = await client.get(
        f"/api/v1/chat/messages/{message_id}/events", headers=other_headers
    )
    assert other_response.status_code == 404

    missing_response = await client.get(
        f"/api/v1/chat/messages/{UUID('00000000-0000-0000-0000-000000000099')}/events",
        headers=headers,
    )
    assert missing_response.status_code == 404


async def test_stream_with_no_events_raises_and_marks_message_failed(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-13")

    # Empty ACP script (no stream events) must hard-fail, not silent complete.
    acp_factory.queue(FakeAcpSession([[]], session_id="resumed-13"))

    result = await send_message(client, headers, chat)
    message_id = result["message_id"]

    task = find_background_task(chat.id)
    with pytest.raises(Exception, match="Stream completed without any events"):
        await asyncio.wait_for(task, timeout=5.0)
    await asyncio.sleep(0)

    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    items = messages_response.json()["items"]
    assistant_item = next(item for item in items if item["id"] == message_id)
    assert assistant_item["stream_status"] == MessageStreamStatus.FAILED.value


async def test_mid_stream_system_event_updates_chat_session_id(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-14")

    script = [
        StreamEvent(type="system", data={"session_id": "pivoted-session"}),
        StreamEvent(type="assistant_text", text="Pivoted"),
    ]
    # Pivot via mid-stream "system" event; acp_session_id stays resumed id.
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-14"))

    await send_message(client, headers, chat)
    await run_background_task(chat.id)

    deadline = time.monotonic() + 2.0
    session_id = None
    while time.monotonic() < deadline:
        await db_session.refresh(chat)
        session_id = chat.session_id
        if session_id == "pivoted-session":
            break
        await asyncio.sleep(0.01)

    assert session_id == "pivoted-session"


async def test_send_message_with_worktree_persists_cwd_and_emits_system_event(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-15")

    script = [StreamEvent(type="assistant_text", text="Working in worktree")]
    acp_factory.queue(FakeAcpSession([script], session_id="resumed-15"))

    response = await client.post(
        "/api/v1/chat/chat",
        data={
            "prompt": "Do it in a worktree",
            "chat_id": str(chat.id),
            "model_id": TEST_MODEL_ID,
            "permission_mode": "bypassPermissions",
            "worktree": "true",
        },
        headers=headers,
    )
    assert response.status_code == 200
    # worktree_cwd is resolved/persisted before the stream task starts.
    assert response.json()["worktree_cwd"] is not None

    await run_background_task(chat.id)

    await db_session.refresh(chat)
    assert chat.worktree_cwd == response.json()["worktree_cwd"]

    detail_response = await client.get(f"/api/v1/chat/chats/{chat.id}", headers=headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["worktree_cwd"] == response.json()["worktree_cwd"]


@pytest_asyncio.fixture
async def live_server_url(app: FastAPI) -> AsyncIterator[str]:
    # ASGITransport buffers whole body — live SSE needs a real socket server.
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error")
    server = uvicorn.Server(config)
    serve_task = asyncio.create_task(server.serve())
    deadline = time.monotonic() + 10.0
    while not server.started:
        assert time.monotonic() < deadline, "uvicorn did not start in time"
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    await serve_task


async def test_stream_sse_replays_backlog_then_delivers_live_events(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
    live_server_url: str,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="resumed-sse")
    acp_factory.queue(
        FakeAcpSession(
            [[StreamEvent(type="assistant_text", text="hi")]],
            session_id="resumed-sse",
        )
    )
    result = await send_message(client, headers, chat)
    await run_background_task(chat.id)

    # asyncio.timeout turns an SSE regression into a test failure instead of a
    # hung test run.
    async with asyncio.timeout(15):
        sse_client = httpx.AsyncClient(base_url=live_server_url, timeout=10.0)
        async with (
            sse_client,
            sse_client.stream(
                "GET",
                "/api/v1/chat/chats/streams",
                params={"cursors": json.dumps({str(chat.id): 0})},
                headers=headers,
            ) as response,
        ):
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")

            envelopes: list[dict[str, Any]] = []
            lines = response.aiter_lines()
            async for line in lines:
                if line.startswith("data:"):
                    envelopes.append(json.loads(line.removeprefix("data:").strip()))
                    break

            backlog = envelopes[0]
            assert backlog["kind"] == "complete"
            assert backlog["chatId"] == str(chat.id)
            assert backlog["messageId"] == result["message_id"]

            # The generator only subscribes before the backlog replay, so
            # publishing after the first read can't race the subscription.
            live_envelope = StreamEnvelope.serialize(
                chat_id=chat.id,
                message_id=UUID(result["message_id"]),
                stream_id=uuid4(),
                seq=backlog["seq"] + 1,
                kind="complete",
                payload={},
            )
            await streaming_cache.store.publish(
                REDIS_KEY_USER_STREAMS_LIVE.format(user_id=user.id), live_envelope
            )

            # Feed stays open; read one live event, don't drain to close.
            async for line in lines:
                if line.startswith("data:"):
                    envelopes.append(json.loads(line.removeprefix("data:").strip()))
                    break

    assert [e["seq"] for e in envelopes] == [backlog["seq"], backlog["seq"] + 1]


async def test_sse_endpoints_release_db_connection_while_streaming(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    streaming_cache: EndpointCache,
    live_server_url: str,
) -> None:
    # Regression: SSE must release get_db before stream or tabs pin the pool.
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    counter = ConnectionCounter()
    sa_event.listen(engine.sync_engine, "checkout", counter.on_checkout)
    sa_event.listen(engine.sync_engine, "checkin", counter.on_checkin)
    try:
        async with asyncio.timeout(15):
            sse_client = httpx.AsyncClient(base_url=live_server_url, timeout=10.0)
            async with (
                sse_client,
                sse_client.stream(
                    "GET", "/api/v1/chat/chats/events", headers=headers
                ) as events_response,
                sse_client.stream(
                    "GET",
                    "/api/v1/chat/chats/streams",
                    params={"cursors": json.dumps({str(chat.id): 0})},
                    headers=headers,
                ) as chat_stream_response,
            ):
                assert events_response.status_code == 200
                assert chat_stream_response.status_code == 200
                # Backlog replay opens a brief session — poll for pool drain.
                while counter.active > 0:
                    await asyncio.sleep(0.01)
    finally:
        # The engine is module-global — unhook so the counter doesn't leak
        # into other tests.
        sa_event.remove(engine.sync_engine, "checkout", counter.on_checkout)
        sa_event.remove(engine.sync_engine, "checkin", counter.on_checkin)
