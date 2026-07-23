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
from acp.schema import (
    PermissionOption,
    ToolCallProgress,
    ToolCallStart,
    ToolCallUpdate,
)
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import event as sa_event
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import chat as chat_endpoint
from app.core import deps
from app.constants import (
    MODELS,
    REDIS_KEY_USER_STREAMS_LIVE,
)
from app.db.session import engine
from app.models.db_models.chat import Chat
from app.models.db_models.enums import MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.services.acp.client import AcpClientHandler
from app.services.acp.session import AcpSession, AcpSessionConfig
from app.services.queue import QueueService
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
END_TURN = object()


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


@dataclass
class DelayedAcpUpdate:
    delay: float
    update: ToolCallProgress


class FakeAcpSession:
    # Duck-types AcpSession so AgentService/SessionRegistry run without spawn.
    def __init__(
        self,
        scripts: list[list[Any]],
        *,
        usage: dict[str, int] | None = None,
        total_cost_usd: float = 0.0,
        session_id: str = "acp-session-1",
        steering_supported: bool = False,
        steering_outcomes: list[str] | None = None,
        steering_scripts: list[list[Any]] | None = None,
        steer_gate: asyncio.Event | None = None,
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
        self.steering_supported = steering_supported
        self.steering_outcomes = steering_outcomes or []
        self.steering_scripts = steering_scripts or []
        self.steer_calls: list[str] = []
        self.steer_gate = steer_gate
        self._turn_done = asyncio.Event()

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
                elif isinstance(step, (ToolCallStart, ToolCallProgress)):
                    await self.handler.session_update(self.acp_session_id, step)
                elif step is BLOCK_FOREVER:
                    await self._turn_done.wait()
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

    async def steer(
        self,
        content: str,
        attachments: list[dict[str, Any]] | None = None,
        agent_kind: Any = None,
    ) -> str:
        assert self.handler is not None
        self.steer_calls.append(content)
        if self.steer_gate is not None:
            await self.steer_gate.wait()
        outcome = self.steering_outcomes.pop(0)
        if outcome == "injected":
            script = self.steering_scripts.pop(0)
            asyncio.get_running_loop().call_soon(
                asyncio.create_task, self._emit_steer_script(script)
            )
        return outcome

    async def _emit_steer_script(self, script: list[Any]) -> None:
        assert self.handler is not None
        for step in script:
            if step is END_TURN:
                self._turn_done.set()
            elif isinstance(step, DelayedAcpUpdate):
                await asyncio.sleep(step.delay)
                await self.handler.session_update(self.acp_session_id, step.update)
            else:
                self.handler.event_queue.put_nowait(step)

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
    ChatStreamRuntime._active_runtimes.clear()
    ChatStreamRuntime._steering_chats.clear()
    session_registry._sessions.clear()
    session_registry._pending_cancels.clear()
    yield
    ChatStreamRuntime._background_task_chat_ids.clear()
    ChatStreamRuntime._active_runtimes.clear()
    ChatStreamRuntime._steering_chats.clear()
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
    acp_session = FakeAcpSession([first_script, second_script], session_id="resumed-7")
    acp_factory.queue(acp_session)

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
    assert acp_session.cancel_calls == 1


async def test_send_now_steers_and_rotates_the_live_stream(
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
    chat = await create_chat_row(db_session, user, workspace, session_id="steer-1")
    acp_session = FakeAcpSession(
        [[StreamEvent(type="assistant_text", text="Working"), BLOCK_FOREVER]],
        session_id="steer-1",
        steering_supported=True,
        steering_outcomes=["injected"],
        steering_scripts=[
            [StreamEvent(type="assistant_text", text="Steered answer"), END_TURN]
        ],
    )
    acp_factory.queue(acp_session)

    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Urgent follow-up", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    queued_id = queued.json()["id"]
    first = await send_message(client, headers, chat, prompt="First prompt")
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await asyncio.sleep(0.05)

    response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now", headers=headers
    )
    assert response.status_code == 204
    await run_background_task(chat.id)

    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    first_assistant = next(
        item for item in messages if item["id"] == first["message_id"]
    )
    second_assistant = next(
        item
        for item in messages
        if item["role"] == "assistant" and item["id"] != first["message_id"]
    )
    users = [item for item in messages if item["role"] == "user"]
    assert first_assistant["stream_status"] == MessageStreamStatus.INTERRUPTED.value
    assert first_assistant["duration_ms"] is not None
    assert second_assistant["stream_status"] == MessageStreamStatus.COMPLETED.value
    assert second_assistant["content_text"] == "Steered answer"
    assert [item["content_text"] for item in users].count("Urgent follow-up") == 1

    handoff = await wait_for_message_event_type(
        client, headers, first["message_id"], "queue_processing"
    )
    payload = handoff["render_payload"]
    assert payload["queued_message_id"] == queued_id
    assert payload["assistant_message_id"] == second_assistant["id"]
    assert payload["user_message_id"] == next(
        item["id"] for item in users if item["content_text"] == "Urgent follow-up"
    )
    assert payload["prior_duration_ms"] == first_assistant["duration_ms"]
    assert acp_session.cancel_calls == 0
    assert len(acp_session.prompt_calls) == 1
    assert len(acp_session.steer_calls) == 1
    assert (
        await client.get(f"/api/v1/chat/chats/{chat.id}/queue", headers=headers)
    ).json() == []


async def test_send_now_model_mismatch_uses_legacy_cancel(
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
    chat = await create_chat_row(db_session, user, workspace, session_id="steer-2")
    acp_session = FakeAcpSession(
        [
            [StreamEvent(type="assistant_text", text="Working"), BLOCK_FOREVER],
            [StreamEvent(type="assistant_text", text="Legacy answer")],
        ],
        session_id="steer-2",
        steering_supported=True,
    )
    acp_factory.queue(acp_session)
    other_model = "opencode:google-vertex-anthropic/claude-opus-4@20250514"
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Different model", "model_id": other_model},
        headers=headers,
    )
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued.json()['id']}/send-now",
        headers=headers,
    )
    await run_background_task(chat.id)
    await asyncio.sleep(0)
    await run_background_task(chat.id)
    assert acp_session.steer_calls == []
    assert acp_session.cancel_calls == 1
    assert len(acp_session.prompt_calls) == 2


@pytest.mark.parametrize("outcome", ["failed", "startedNewTurn"])
async def test_send_now_steering_outcome_falls_back_once(
    outcome: str,
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
    chat = await create_chat_row(
        db_session, user, workspace, session_id="steer-fallback"
    )
    acp_session = FakeAcpSession(
        [
            [StreamEvent(type="assistant_text", text="Working"), BLOCK_FOREVER],
            [StreamEvent(type="assistant_text", text="Fallback answer")],
        ],
        session_id="steer-fallback",
        steering_supported=True,
        steering_outcomes=[outcome],
    )
    acp_factory.queue(acp_session)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Fallback prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued.json()['id']}/send-now",
        headers=headers,
    )
    await run_background_task(chat.id)
    await asyncio.sleep(0)
    await run_background_task(chat.id)

    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    assert [item["content_text"] for item in messages if item["role"] == "user"].count(
        "Fallback prompt"
    ) == 1
    assert len(acp_session.prompt_calls) == 2
    assert len(acp_session.steer_calls) == 1
    assert acp_session.cancel_calls == (2 if outcome == "startedNewTurn" else 1)
    assert (
        await client.get(f"/api/v1/chat/chats/{chat.id}/queue", headers=headers)
    ).json() == []


async def test_send_now_steer_timeout_falls_back_to_legacy_cancel(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A hung _session/steering RPC must not hold the send-now claim (or the
    # per-chat steering guard) forever — the acceptance timeout routes it
    # through the generic failure path into the legacy cancel flow.
    monkeypatch.setattr(runtime_module, "STEER_ACCEPT_TIMEOUT_SECONDS", 0.05)
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(
        db_session, user, workspace, session_id="steer-timeout"
    )
    acp_session = FakeAcpSession(
        [
            [StreamEvent(type="assistant_text", text="Working"), BLOCK_FOREVER],
            [StreamEvent(type="assistant_text", text="Fallback answer")],
        ],
        session_id="steer-timeout",
        steering_supported=True,
        steering_outcomes=["injected"],
        steer_gate=asyncio.Event(),  # never set — steer hangs until cancelled
    )
    acp_factory.queue(acp_session)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Timeout prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued.json()['id']}/send-now",
        headers=headers,
    )
    await run_background_task(chat.id)
    await asyncio.sleep(0)
    await run_background_task(chat.id)

    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    assert [item["content_text"] for item in messages if item["role"] == "user"].count(
        "Timeout prompt"
    ) == 1
    assert len(acp_session.steer_calls) == 1
    assert len(acp_session.prompt_calls) == 2
    assert acp_session.cancel_calls == 1
    assert ChatStreamRuntime._steering_chats == set()
    assert (
        await client.get(f"/api/v1/chat/chats/{chat.id}/queue", headers=headers)
    ).json() == []


async def test_send_now_can_steer_twice_in_one_acp_turn(
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
    chat = await create_chat_row(db_session, user, workspace, session_id="steer-double")
    acp_session = FakeAcpSession(
        [[StreamEvent(type="assistant_text", text="First"), BLOCK_FOREVER]],
        session_id="steer-double",
        steering_supported=True,
        steering_outcomes=["injected", "injected"],
        steering_scripts=[
            [StreamEvent(type="assistant_text", text="Second")],
            [StreamEvent(type="assistant_text", text="Third"), END_TURN],
        ],
    )
    acp_factory.queue(acp_session)
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await asyncio.sleep(0.05)

    first_queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Steer one", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{first_queued.json()['id']}/send-now",
        headers=headers,
    )
    first_handoff = await wait_for_message_event_type(
        client, headers, first["message_id"], "queue_processing"
    )
    second_assistant_id = first_handoff["render_payload"]["assistant_message_id"]
    await wait_for_message_event_type(
        client, headers, second_assistant_id, "stream_started"
    )
    await asyncio.sleep(0.05)

    second_queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Steer two", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{second_queued.json()['id']}/send-now",
        headers=headers,
    )
    await run_background_task(chat.id)

    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    assistants = [item for item in messages if item["role"] == "assistant"]
    assert len(assistants) == 3
    by_content = {item["content_text"]: item for item in assistants}
    assert by_content["First"]["stream_status"] == MessageStreamStatus.INTERRUPTED.value
    assert (
        by_content["Second"]["stream_status"] == MessageStreamStatus.INTERRUPTED.value
    )
    assert by_content["Third"]["stream_status"] == MessageStreamStatus.COMPLETED.value
    assert len(acp_session.prompt_calls) == 1
    assert len(acp_session.steer_calls) == 2


async def test_send_now_steer_terminates_active_tool_and_drops_late_update(
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
    chat = await create_chat_row(db_session, user, workspace, session_id="steer-tool")
    tool_id = "tool-active-during-steer"
    acp_session = FakeAcpSession(
        [
            [
                ToolCallStart(
                    session_update="tool_call",
                    tool_call_id=tool_id,
                    title="Long-running tool",
                ),
                StreamEvent(type="assistant_text", text="Before"),
                BLOCK_FOREVER,
            ]
        ],
        session_id="steer-tool",
        steering_supported=True,
        steering_outcomes=["injected"],
        steering_scripts=[
            [
                StreamEvent(type="assistant_text", text="After"),
                DelayedAcpUpdate(
                    0.2,
                    ToolCallProgress(
                        session_update="tool_call_update",
                        tool_call_id=tool_id,
                        status="completed",
                        raw_output="late result",
                    ),
                ),
                END_TURN,
            ]
        ],
    )
    acp_factory.queue(acp_session)
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await asyncio.sleep(0.05)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Rotate with tool", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued.json()['id']}/send-now",
        headers=headers,
    )
    await run_background_task(chat.id)

    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    old = next(item for item in messages if item["id"] == first["message_id"])
    new = next(
        item
        for item in messages
        if item["role"] == "assistant" and item["id"] != first["message_id"]
    )
    old_tools = [
        event
        for event in old["content_render"]["events"]
        if event["type"].startswith("tool_")
    ]
    assert old["stream_status"] == MessageStreamStatus.INTERRUPTED.value
    assert old_tools[-1]["type"] == "tool_failed"
    assert old_tools[-1]["tool"]["id"] == tool_id
    assert (
        old_tools[-1]["tool"]["error"]
        == "Tool ended before a terminal ACP update arrived"
    )
    assert new["content_text"] == "After"
    assert not any(
        event["type"].startswith("tool_") for event in new["content_render"]["events"]
    )


async def test_send_now_refuses_steering_while_permission_is_pending(
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
    chat = await create_chat_row(
        db_session, user, workspace, session_id="steer-permission"
    )
    permission = PermissionStep(
        options=[("allow_once", "Allow", "allow")],
        tool_call_id="permission-tool",
        on_response={},
    )
    acp_session = FakeAcpSession(
        [
            [permission],
            [StreamEvent(type="assistant_text", text="Legacy after permission")],
        ],
        session_id="steer-permission",
        steering_supported=True,
    )
    acp_factory.queue(acp_session)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Do not steer", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "permission_request"
    )
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued.json()['id']}/send-now",
        headers=headers,
    )
    await run_background_task(chat.id)
    await asyncio.sleep(0)
    await run_background_task(chat.id)
    assert acp_session.steer_calls == []
    assert acp_session.cancel_calls == 1


async def test_concurrent_send_now_claims_once_and_second_attempt_is_noop(
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
    chat = await create_chat_row(db_session, user, workspace, session_id="steer-race")
    acp_session = FakeAcpSession(
        [[StreamEvent(type="assistant_text", text="Before"), BLOCK_FOREVER]],
        session_id="steer-race",
        steering_supported=True,
        steering_outcomes=["injected"],
        steering_scripts=[
            [StreamEvent(type="assistant_text", text="Claimed once"), END_TURN]
        ],
    )
    acp_factory.queue(acp_session)
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await asyncio.sleep(0.05)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Race prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    queued_id = queued.json()["id"]
    queue_service = QueueService(streaming_cache.store)
    assert await queue_service.mark_send_now(str(chat.id), queued_id)
    assert await queue_service.mark_send_now(str(chat.id), queued_id)

    results = await asyncio.gather(
        *[
            ChatStreamRuntime.try_steer_send_now(
                chat_id=str(chat.id),
                queued_message_id=queued_id,
                queue_service=queue_service,
                session_factory=runtime_module.SessionLocal,
            )
            for _ in range(2)
        ]
    )
    assert results == [True, True]
    await run_background_task(chat.id)

    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    assert len(acp_session.steer_calls) == 1
    assert [item["content_text"] for item in messages if item["role"] == "user"].count(
        "Race prompt"
    ) == 1
    assert (
        sum(
            item["stream_status"] == MessageStreamStatus.INTERRUPTED.value
            for item in messages
            if item["role"] == "assistant"
        )
        == 1
    )


async def test_in_flight_steering_guard_allows_only_one_driver(
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
    chat = await create_chat_row(db_session, user, workspace, session_id="steer-guard")
    steer_gate = asyncio.Event()
    acp_session = FakeAcpSession(
        [[StreamEvent(type="assistant_text", text="Before"), BLOCK_FOREVER]],
        session_id="steer-guard",
        steering_supported=True,
        steering_outcomes=["injected"],
        steering_scripts=[
            [StreamEvent(type="assistant_text", text="Guarded"), END_TURN]
        ],
        steer_gate=steer_gate,
    )
    acp_factory.queue(acp_session)
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await asyncio.sleep(0.05)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Guard prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    queued_id = queued.json()["id"]
    queue_service = QueueService(streaming_cache.store)
    assert await queue_service.mark_send_now(str(chat.id), queued_id)

    first_attempt = asyncio.create_task(
        ChatStreamRuntime.try_steer_send_now(
            chat_id=str(chat.id),
            queued_message_id=queued_id,
            queue_service=queue_service,
            session_factory=runtime_module.SessionLocal,
        )
    )
    deadline = time.monotonic() + 2.0
    while not acp_session.steer_calls and time.monotonic() < deadline:
        await asyncio.sleep(0.01)
    assert len(acp_session.steer_calls) == 1

    second_result = await ChatStreamRuntime.try_steer_send_now(
        chat_id=str(chat.id),
        queued_message_id=queued_id,
        queue_service=queue_service,
        session_factory=runtime_module.SessionLocal,
    )
    assert second_result is True
    assert len(acp_session.steer_calls) == 1

    steer_gate.set()
    assert await first_attempt is True
    await run_background_task(chat.id)
    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    assert [item["content_text"] for item in messages if item["role"] == "user"].count(
        "Guard prompt"
    ) == 1


async def test_deleted_send_now_claim_is_noop_without_interrupting_live_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, session_id="steer-delete")
    acp_session = FakeAcpSession(
        [[StreamEvent(type="assistant_text", text="Keeps streaming"), BLOCK_FOREVER]],
        session_id="steer-delete",
        steering_supported=True,
    )
    acp_factory.queue(acp_session)
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await asyncio.sleep(0.05)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Deleted prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    queued_id = queued.json()["id"]
    queue_service = QueueService(streaming_cache.store)
    assert await queue_service.mark_send_now(str(chat.id), queued_id)

    async def delete_before_claim(chat_id: str, message_id: str) -> None:
        assert await queue_service.delete_message(chat_id, message_id)
        return None

    monkeypatch.setattr(queue_service, "pop_message_by_id", delete_before_claim)

    handled = await ChatStreamRuntime.try_steer_send_now(
        chat_id=str(chat.id),
        queued_message_id=queued_id,
        queue_service=queue_service,
        session_factory=runtime_module.SessionLocal,
    )
    assert handled is True
    assert acp_session.steer_calls == []
    acp_session._turn_done.set()
    await run_background_task(chat.id)
    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    old = next(item for item in messages if item["id"] == first["message_id"])
    assert old["stream_status"] == MessageStreamStatus.COMPLETED.value
    assert old["content_text"] == "Keeps streaming"


async def test_steer_materialize_failure_cancels_and_redelivers_once(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    acp_factory: FakeAcpSessionFactory,
    streaming_cache: EndpointCache,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(
        db_session, user, workspace, session_id="steer-materialize"
    )
    acp_session = FakeAcpSession(
        [
            [StreamEvent(type="assistant_text", text="Still live"), BLOCK_FOREVER],
            [StreamEvent(type="assistant_text", text="Retried")],
        ],
        session_id="steer-materialize",
        steering_supported=True,
        steering_outcomes=["injected"],
        steering_scripts=[[StreamEvent(type="assistant_text", text="Continues")]],
    )
    acp_factory.queue(acp_session)
    first = await send_message(client, headers, chat)
    await wait_for_message_event_type(
        client, headers, first["message_id"], "stream_started"
    )
    await asyncio.sleep(0.05)
    runtime = ChatStreamRuntime._active_runtimes[str(chat.id)]
    original_create_message = runtime.message_service.create_message
    fail_next_create = True

    async def fail_create_message(*args: Any, **kwargs: Any) -> Any:
        nonlocal fail_next_create
        if fail_next_create:
            fail_next_create = False
            raise RuntimeError("materialize failed")
        return await original_create_message(*args, **kwargs)

    monkeypatch.setattr(runtime.message_service, "create_message", fail_create_message)
    queued = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Retry me", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    queued_id = queued.json()["id"]
    await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now",
        headers=headers,
    )
    await run_background_task(chat.id)
    await asyncio.sleep(0)
    await run_background_task(chat.id)

    messages = (
        await client.get(f"/api/v1/chat/chats/{chat.id}/messages", headers=headers)
    ).json()["items"]
    old = next(item for item in messages if item["id"] == first["message_id"])
    retried = next(
        item
        for item in messages
        if item["role"] == "assistant" and item["id"] != first["message_id"]
    )
    assert old["stream_status"] == MessageStreamStatus.INTERRUPTED.value
    assert retried["stream_status"] == MessageStreamStatus.COMPLETED.value
    assert retried["content_text"] == "Retried"
    assert [item["content_text"] for item in messages if item["role"] == "user"].count(
        "Retry me"
    ) == 1
    assert len(acp_session.steer_calls) == 1
    assert len(acp_session.prompt_calls) == 2
    assert (
        await client.get(f"/api/v1/chat/chats/{chat.id}/queue", headers=headers)
    ).json() == []


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
