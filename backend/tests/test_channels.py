import asyncio
from collections.abc import AsyncIterator, Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import chat as chat_endpoint
from app.constants import MODELS
from app.models.db_models.channel import Channel, ChannelDelivery, ChannelMessage
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.chat import ChannelChatRequest
from app.services.acp.adapters import AgentKind
from app.services.channel import (
    ChannelService,
    ChannelState,
    MemberTurn,
    channel_service,
)
from app.services.sandbox_providers.base import SandboxProvider
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import EventSink

from tests.conftest import LoginClient, UserFactory
from tests.helpers import FakeProviderFactory, create_authenticated_workspace


TEST_MODEL_ID = "opencode:google-vertex-anthropic/claude-sonnet-4-5@20250929"

pytestmark = pytest.mark.anyio


async def create_source_message(
    db_session: AsyncSession,
    chat_id: UUID,
    *,
    duration_ms: int | None = 1234,
) -> Message:
    message = Message(
        chat_id=chat_id,
        role=MessageRole.ASSISTANT,
        content_text="channel-search-needle",
        stream_status=MessageStreamStatus.COMPLETED,
        duration_ms=duration_ms,
        created_at=datetime.now(timezone.utc) - timedelta(seconds=2),
    )
    db_session.add(message)
    await db_session.commit()
    await db_session.refresh(message)
    return message


class ScriptedTurns:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = [
            ("assistant_text", {"text": "PASS"})
        ]
        self.requests: list[ChannelChatRequest] = []
        self.sources: list[Message] = []
        self.turns: list[MemberTurn] = []
        self.publications: list[tuple[UUID, str, dict[str, Any]]] = []
        self.duration_ms: int | None = 1234
        self.gate: asyncio.Event | None = None
        self.emitted = asyncio.Event()
        self.provider_tasks: dict[str, asyncio.Task[str]] = {}

    async def initiate_chat_completion(
        self,
        request: ChannelChatRequest,
        user: User,
        *,
        event_sink: EventSink,
        task_started: Callable[[asyncio.Task[str]], None],
    ) -> None:
        self.requests.append(request)
        async with channel_service.session_factory() as db:
            source = await create_source_message(
                db, request.chat_id, duration_ms=self.duration_ms
            )
        self.sources.append(source)
        task = asyncio.create_task(self.emit(event_sink, source, self.events))
        self.provider_tasks[str(request.chat_id)] = task
        task_started(task)

    async def emit(
        self,
        event_sink: EventSink,
        source: Message,
        events: list[tuple[str, dict[str, Any]]],
    ) -> str:
        await event_sink("stream_started", {"message_id": str(source.id)})
        for kind, payload in events:
            await event_sink(kind, payload)
        self.emitted.set()
        if self.gate is not None:
            await self.gate.wait()
        return str(source.id)

    async def publish(
        self, channel: Channel, kind: str, payload: dict[str, Any]
    ) -> None:
        self.publications.append((channel.id, kind, payload))

    async def cancel_chat_turn(self, chat_id: str, *, timeout: float) -> None:
        task = self.provider_tasks.get(chat_id)
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def wake(self, state: ChannelState) -> None:
        state.paused = False
        state.quiet_until = 0
        await channel_service.wake(state)
        state.paused = True
        if state.timer is not None:
            state.timer.cancel()
            await asyncio.gather(state.timer, return_exceptions=True)
            state.timer = None
        turns = list(state.turns.values())
        self.turns.extend(turns)
        await asyncio.gather(*(turn.task for turn in turns if turn.task is not None))


class PermissionResolver:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def __call__(self, chat_id: str, request_id: str, *, option_id: str) -> bool:
        self.calls.append((chat_id, request_id, option_id))
        return request_id == "request-1"


async def reset_channel_states(turns: list[MemberTurn]) -> None:
    tasks: set[asyncio.Task[Any]] = set()
    for state in channel_service.states.values():
        state.deleted = True
        if state.timer is not None:
            tasks.add(state.timer)
        turns.extend(state.turns.values())
    for turn in turns:
        for task in (turn.task, turn.provider_task, turn.flush_task):
            if task is not None:
                tasks.add(task)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    channel_service.states.clear()


@pytest.fixture(autouse=True)
async def channel_runtime(
    monkeypatch: pytest.MonkeyPatch, anyio_backend: str, database: None
) -> AsyncIterator[ScriptedTurns]:
    await reset_channel_states([])
    runtime = ScriptedTurns()
    monkeypatch.setattr(channel_service, "publish", runtime.publish)
    monkeypatch.setattr(
        channel_service.chats,
        "initiate_chat_completion",
        runtime.initiate_chat_completion,
    )
    monkeypatch.setattr(ChatStreamRuntime, "cancel_chat_turn", runtime.cancel_chat_turn)
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())
    yield runtime
    await reset_channel_states(runtime.turns)


@pytest.fixture
async def owner(
    db_session: AsyncSession, create_user: UserFactory, login: LoginClient
) -> tuple[dict[str, str], User, Workspace]:
    return await create_authenticated_workspace(db_session, create_user, login)


@pytest.fixture
async def other_owner(
    db_session: AsyncSession, create_user: UserFactory, login: LoginClient
) -> tuple[dict[str, str], User, Workspace]:
    return await create_authenticated_workspace(
        db_session, create_user, login, email="other@example.com", username="other"
    )


@pytest.fixture
def channel_data(owner: tuple[dict[str, str], User, Workspace]) -> dict[str, Any]:
    return {
        "name": "Review",
        "workspace_id": str(owner[2].id),
        "members": [{"model_id": TEST_MODEL_ID}],
    }


@pytest.fixture
async def channel_state(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
) -> ChannelState:
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == 201, response.text
    state = channel_service.states[UUID(response.json()["id"])]
    state.paused = True
    return state


@pytest.fixture
async def source_message(
    db_session: AsyncSession, channel_state: ChannelState
) -> Message:
    return await create_source_message(
        db_session, channel_state.channel.members[0].chat_id
    )


@pytest.mark.parametrize(
    ("text", "silent"),
    [
        ("PASS", True),
        ("pass", True),
        ("`PASS`", True),
        ("**PASS**", True),
        ("PASS.", True),
        ("PASS — nothing new", True),
        ("Pass, nothing to add", True),
        ("Pass — nothing to add", False),
        ("Looks good.\nPASS", True),
        ("Nothing to add. PASS", True),
        ("LGTM! PASS", True),
        ("P", True),
        ("PA", True),
        ("", True),
        ("pass\nreason here", True),
        ("tests pass", False),
        ("All tests pass.", False),
        ("The build will pass", False),
        ("The check should PASS", False),
        ("pass the salt", False),
        ("Compass", False),
        ("Bypass it", False),
        ("PASSING", False),
        ("passes", False),
        ("a", False),
        ("Options:\npass\nor retry", False),
        ("Here's a stub:\n```python\ndef handler():\n    pass\n```", False),
        ("Here's a stub:\n    pass", False),
        ("Ran it.\nunit tests: PASS", False),
        ("CI: PASS", False),
        ("Nothing further to add.\nPASS — already covered", True),
    ],
)
def test_is_silent(text: str, silent: bool) -> None:
    assert ChannelService.is_silent(text) is silent


@pytest.mark.parametrize("deltas", [("PASS",), ("P", "A", "SS")])
async def test_pass_turn_never_creates_or_publishes_a_message(
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
    deltas: tuple[str, ...],
) -> None:
    message = await channel_service.new_message(channel_state, "Any objections?")
    channel_runtime.events = [("assistant_text", {"text": text}) for text in deltas]
    await channel_runtime.wake(channel_state)

    messages = await channel_service.messages(channel_state.channel, 0)
    assert [row.id for row in messages] == [message.id]
    assert not [
        payload
        for _, kind, payload in channel_runtime.publications
        if kind == "channel_message"
    ]
    deliveries = (await db_session.scalars(select(ChannelDelivery))).all()
    assert [(row.member_id, row.message_id) for row in deliveries] == [
        (channel_state.channel.members[0].id, message.id)
    ]


async def test_tool_segments_counts_and_source_duration_are_persisted(
    channel_state: ChannelState, channel_runtime: ScriptedTurns
) -> None:
    await channel_service.new_message(channel_state, "Check the implementation")
    channel_runtime.events = [
        ("assistant_text", {"text": "I will inspect the files."}),
        ("tool_started", {"tool": {"id": "read"}}),
        ("tool_completed", {"tool": {"id": "read"}}),
        ("tool_started", {"tool": {"id": "check"}}),
        ("assistant_text", {"text": "The final result."}),
        ("tool_completed", {"tool": {"id": "check"}}),
        ("tool_completed", {"tool": {"id": "read"}}),
    ]
    await channel_runtime.wake(channel_state)

    _, message = await channel_service.messages(channel_state.channel, 0)
    assert message.content == "The final result."
    assert message.status == "completed"
    assert message.tool_call_count == 2
    assert message.source_message_id == channel_runtime.sources[0].id
    assert message.duration_ms == channel_runtime.sources[0].duration_ms == 1234


async def test_sequence_increases_across_user_agent_and_deleted_messages(
    channel_state: ChannelState, channel_runtime: ScriptedTurns
) -> None:
    first = await channel_service.new_message(channel_state, "Review this")
    channel_runtime.events = [
        ("assistant_text", {"text": "Checking now."}),
        ("tool_started", {"tool": {"id": "check"}}),
        ("assistant_text", {"text": "PASS"}),
        ("tool_completed", {"tool": {"id": "check"}}),
    ]
    await channel_runtime.wake(channel_state)
    second = await channel_service.new_message(channel_state, "Explain the result")
    channel_runtime.events = [("assistant_text", {"text": "Here is the result."})]
    await channel_runtime.wake(channel_state)

    messages = await channel_service.messages(channel_state.channel, 0)
    assert len(messages) == 4
    assert [row.status for row in messages] == [
        "completed",
        "deleted",
        "completed",
        "completed",
    ]
    assert [messages[0].id, messages[2].id] == [first.id, second.id]
    assert messages[1].content == ""
    assert (
        messages[1].member_id
        == messages[3].member_id
        == channel_state.channel.members[0].id
    )
    seqs = [row.seq for row in messages]
    assert seqs == sorted(set(seqs))
    subsequent = await channel_service.messages(channel_state.channel, messages[1].seq)
    assert [row.id for row in subsequent] == [second.id, messages[3].id]


@pytest.mark.parametrize("outcome", ["error", "cancelled"])
async def test_unsuccessful_turn_redelivers_batch_and_cancelled_duration_falls_back(
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
    outcome: str,
) -> None:
    first = await channel_service.new_message(channel_state, "First question")
    second = await channel_service.new_message(channel_state, "Second question")
    channel_runtime.duration_ms = None
    channel_runtime.events = [
        ("assistant_text", {"text": "Partial reply"}),
        (outcome, {"error": "Provider failed"} if outcome == "error" else {}),
    ]
    started_at = datetime.now(timezone.utc)
    await channel_runtime.wake(channel_state)
    finished_at = datetime.now(timezone.utc)

    assert (await db_session.scalars(select(ChannelDelivery))).all() == []
    messages = await channel_service.messages(channel_state.channel, 0)
    reply = messages[-1]
    assert reply.status == "cancelled"
    assert reply.content == "Partial reply"
    source = channel_runtime.sources[0]
    assert reply.duration_ms is not None
    assert (
        int((started_at - source.created_at).total_seconds() * 1000)
        <= reply.duration_ms
    )
    assert reply.duration_ms <= int(
        (finished_at - source.created_at).total_seconds() * 1000
    )

    member = channel_state.channel.members[0]
    if outcome == "error":
        channel_state.retries[member.id].until = asyncio.get_running_loop().time()
    channel_runtime.events = [("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(channel_state)

    deliveries = (await db_session.scalars(select(ChannelDelivery))).all()
    assert {(row.member_id, row.message_id) for row in deliveries} == {
        (member.id, first.id),
        (member.id, second.id),
    }
    assert len(channel_runtime.requests) == 2
    for request in channel_runtime.requests:
        assert request.prompt.endswith(
            "[user]: First question\n[user]: Second question"
        )
    await channel_runtime.wake(channel_state)
    assert len(channel_runtime.requests) == 2


@pytest.mark.parametrize("action", ["messages", "stop"])
async def test_running_turn_is_interrupted_by_owner(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
    action: str,
) -> None:
    first = await channel_service.new_message(channel_state, "First question")
    second = await channel_service.new_message(channel_state, "Second question")
    channel_runtime.events = [("assistant_text", {"text": "Partial reply"})]
    channel_runtime.gate = asyncio.Event()
    wake = asyncio.create_task(channel_runtime.wake(channel_state))
    await asyncio.wait_for(channel_runtime.emitted.wait(), timeout=5)
    member = channel_state.channel.members[0]
    turn = channel_state.turns[member.id]
    assert turn.message is not None
    reply_id = turn.message.id
    assert turn.message.status == "streaming"
    assert turn.provider_task is not None
    assert not turn.provider_task.done()

    response = await client.post(
        f"/api/v1/channels/{channel_state.channel.id}/{action}",
        headers=owner[0],
        data={"content": "New question"} if action == "messages" else {},
    )
    assert response.status_code == (201 if action == "messages" else 204)
    channel_state.paused = True
    if channel_state.timer is not None:
        channel_state.timer.cancel()
        await asyncio.gather(channel_state.timer, return_exceptions=True)
        channel_state.timer = None
    await asyncio.gather(wake, return_exceptions=True)
    assert wake.cancelled()
    assert turn.provider_task.cancelled()
    reply = await db_session.get(ChannelMessage, reply_id)
    assert reply is not None
    assert reply.status == "cancelled"
    assert reply.content == "Partial reply"
    deliveries = (await db_session.scalars(select(ChannelDelivery))).all()
    expected = {(member.id, first.id), (member.id, second.id)}
    if action == "messages":
        assert deliveries == []
        expected.add((member.id, UUID(response.json()["id"])))
    else:
        assert {(row.member_id, row.message_id) for row in deliveries} == expected

    channel_runtime.gate.set()
    channel_runtime.events = [("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(channel_state)
    deliveries = (await db_session.scalars(select(ChannelDelivery))).all()
    assert {(row.member_id, row.message_id) for row in deliveries} == expected
    assert len(channel_runtime.requests) == (2 if action == "messages" else 1)
    if action == "messages":
        assert channel_runtime.requests[-1].prompt.endswith(
            "[user]: First question\n[user]: Second question\n[user]: New question"
        )


async def test_stop_marks_all_messages_seen_for_every_member(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    channel_data["members"] *= 2
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == 201, response.text
    state = channel_service.states[UUID(response.json()["id"])]
    first = await channel_service.new_message(state, "First question")
    second = await channel_service.new_message(state, "Second question")
    reply = await channel_service.new_message(
        state, "Prior reply", state.channel.members[0].id
    )
    await db_session.execute(
        update(ChannelMessage)
        .where(ChannelMessage.id == reply.id)
        .values(status="completed")
    )
    await db_session.commit()

    response = await client.post(
        f"/api/v1/channels/{state.channel.id}/stop", headers=owner[0]
    )
    assert response.status_code == 204
    deliveries = (await db_session.scalars(select(ChannelDelivery))).all()
    assert {(row.member_id, row.message_id) for row in deliveries} == {
        (member.id, message.id)
        for member in state.channel.members
        for message in (first, second, reply)
        if message.member_id != member.id
    }
    await channel_runtime.wake(state)
    assert channel_runtime.requests == []


async def test_backoff_doubles_caps_skips_wakes_and_clears_on_success(
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    message = await channel_service.new_message(channel_state, "Please retry")
    member = channel_state.channel.members[0]
    channel_runtime.events = [("error", {"error": "Provider unavailable"})]
    loop = asyncio.get_running_loop()
    for expected_delay in (5, 10, 20, 40, 80, 160, 300, 300):
        if member.id in channel_state.retries:
            channel_state.retries[member.id].until = loop.time()
        started = loop.time()
        await channel_runtime.wake(channel_state)
        elapsed = loop.time() - started
        retry = channel_state.retries[member.id]
        assert retry.delay == expected_delay
        assert retry.until - started == pytest.approx(
            expected_delay, abs=elapsed + 0.001
        )
        request_count = len(channel_runtime.requests)
        await channel_runtime.wake(channel_state)
        assert len(channel_runtime.requests) == request_count

    channel_state.retries[member.id].until = loop.time()
    channel_runtime.events = [("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(channel_state)
    assert member.id not in channel_state.retries
    deliveries = (await db_session.scalars(select(ChannelDelivery))).all()
    assert [(row.member_id, row.message_id) for row in deliveries] == [
        (member.id, message.id)
    ]


@pytest.mark.parametrize(
    "authenticated", [True, False], ids=["other-user", "anonymous"]
)
async def test_channel_routes_require_the_owner(
    client: AsyncClient,
    channel_state: ChannelState,
    source_message: Message,
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    authenticated: bool,
) -> None:
    message = await channel_service.new_message(
        channel_state,
        "Agent reply",
        channel_state.channel.members[0].id,
        source_message_id=source_message.id,
    )
    base = f"/api/v1/channels/{channel_state.channel.id}"
    routes: list[tuple[str, str, dict[str, Any]]] = [
        ("GET", base, {}),
        ("PATCH", base, {"json": {"name": "Renamed"}}),
        ("DELETE", base, {}),
        ("GET", f"{base}/messages", {}),
        ("POST", f"{base}/messages", {"data": {"content": "Hello"}}),
        ("GET", f"{base}/messages/{message.id}/activity", {}),
        ("GET", f"{base}/permissions", {}),
        ("GET", f"{base}/member-activity", {}),
        ("POST", f"{base}/stop", {}),
    ]
    if not authenticated:
        routes.extend(
            [
                ("GET", "/api/v1/channels", {}),
                ("POST", "/api/v1/channels", {"json": channel_data}),
            ]
        )
    headers = other_owner[0] if authenticated else {}
    for method, path, kwargs in routes:
        response = await client.request(method, path, headers=headers, **kwargs)
        assert response.status_code == (404 if authenticated else 401), (
            method,
            path,
            response.text,
        )


async def test_owner_can_read_rename_and_delete_channel(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    channel_id = channel_state.channel.id
    chat_ids = [member.chat_id for member in channel_state.channel.members]
    base = f"/api/v1/channels/{channel_id}"
    for suffix in ("", "/messages", "/permissions", "/member-activity"):
        response = await client.get(f"{base}{suffix}", headers=owner[0])
        assert response.status_code == 200, (suffix, response.text)

    response = await client.patch(base, headers=owner[0], json={"name": "Renamed"})
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Renamed"
    assert channel_state.channel.name == "Renamed"
    assert (
        await db_session.scalar(select(Channel.name).where(Channel.id == channel_id))
        == "Renamed"
    )
    assert list(
        await db_session.scalars(select(Chat.title).where(Chat.id.in_(chat_ids)))
    ) == ["Renamed"] * len(chat_ids)

    response = await client.delete(base, headers=owner[0])
    assert response.status_code == 204, response.text
    assert await db_session.get(Channel, channel_id) is None
    assert (
        await db_session.scalars(select(Chat).where(Chat.id.in_(chat_ids)))
    ).all() == []
    assert channel_id not in channel_service.states


async def test_channel_list_is_scoped_to_user_and_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_data: dict[str, Any],
) -> None:
    headers, user, workspace = owner
    second_workspace = Workspace(
        name="Second workspace",
        user_id=user.id,
        sandbox_id="second-sandbox",
        sandbox_provider="host",
        workspace_path="/tmp/agentrove-second-workspace",
        source_type="empty",
    )
    db_session.add(second_workspace)
    await db_session.commit()
    second = await client.post(
        "/api/v1/channels",
        headers=headers,
        json={**channel_data, "workspace_id": str(second_workspace.id)},
    )
    foreign = await client.post(
        "/api/v1/channels",
        headers=other_owner[0],
        json={**channel_data, "workspace_id": str(other_owner[2].id)},
    )
    assert second.status_code == foreign.status_code == 201
    for request_headers, params, expected in [
        (headers, {}, {str(channel_state.channel.id), second.json()["id"]}),
        (headers, {"workspace_id": str(workspace.id)}, {str(channel_state.channel.id)}),
        (headers, {"workspace_id": str(other_owner[2].id)}, set()),
        (other_owner[0], {}, {foreign.json()["id"]}),
    ]:
        response = await client.get(
            "/api/v1/channels", headers=request_headers, params=params
        )
        assert response.status_code == 200
        assert {item["id"] for item in response.json()} == expected


@pytest.mark.parametrize("invalid_activity", ["user", "deleted", "no-source"])
async def test_activity_requires_a_live_agent_message_with_a_source(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    source_message: Message,
    invalid_activity: str,
) -> None:
    message = await channel_service.new_message(
        channel_state,
        "Agent reply",
        channel_state.channel.members[0].id,
        source_message_id=source_message.id,
    )
    path = f"/api/v1/channels/{channel_state.channel.id}/messages/{message.id}/activity"
    response = await client.get(path, headers=owner[0])
    assert response.status_code == 200
    assert response.json()["id"] == str(source_message.id)
    assert response.json()["content_text"] == source_message.content_text

    changes = {
        "user": {"member_id": None},
        "deleted": {"status": "deleted"},
        "no-source": {"source_message_id": None},
    }
    await db_session.execute(
        update(ChannelMessage)
        .where(ChannelMessage.id == message.id)
        .values(**changes[invalid_activity])
    )
    await db_session.commit()
    response = await client.get(path, headers=owner[0])
    assert response.status_code == 404


async def test_member_permission_response_allows_only_the_owner(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    resolver = PermissionResolver()
    monkeypatch.setattr(chat_endpoint.session_registry, "resolve_permission", resolver)
    chat_id = channel_state.channel.members[0].chat_id
    path = f"/api/v1/chat/chats/{chat_id}/permissions/request-1/respond"
    response = await client.post(path, headers=owner[0], data={"option_id": "allow"})
    assert response.status_code == 200
    assert response.json() == {"success": True}
    response = await client.post(
        path, headers=other_owner[0], data={"option_id": "allow"}
    )
    assert response.status_code == 404
    assert resolver.calls == [(str(chat_id), "request-1", "allow")]


async def test_normal_chat_routes_hide_member_chats(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    source_message: Message,
) -> None:
    base = f"/api/v1/chat/chats/{channel_state.channel.members[0].chat_id}"
    for method, path, kwargs, expected_status in [
        ("GET", base, {}, 404),
        ("GET", f"{base}/messages", {}, 403),
        ("GET", f"/api/v1/chat/messages/{source_message.id}/events", {}, 404),
        ("PATCH", base, {"json": {"title": "Renamed"}}, 404),
        ("DELETE", base, {}, 404),
        ("DELETE", f"{base}/stream", {}, 404),
    ]:
        response = await client.request(method, path, headers=owner[0], **kwargs)
        assert response.status_code == expected_status, (method, path, response.text)


async def test_member_chats_are_hidden_from_list_search_and_delete_all(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    source_message: Message,
) -> None:
    headers, user, workspace = owner
    visible = Chat(title="Visible", user_id=user.id, workspace_id=workspace.id)
    db_session.add(visible)
    await db_session.commit()
    visible_message = await create_source_message(db_session, visible.id)

    response = await client.get("/api/v1/chat/chats", headers=headers)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(visible.id)]
    response = await client.get(
        "/api/v1/chat/chats/search",
        headers=headers,
        params={"q": "channel-search-needle"},
    )
    assert response.status_code == 200
    assert [item["chat_id"] for item in response.json()["results"]] == [str(visible.id)]

    response = await client.delete("/api/v1/chat/chats/all", headers=headers)
    assert response.status_code == 204
    await db_session.refresh(workspace)
    assert workspace.deleted_at is None
    await db_session.refresh(visible)
    await db_session.refresh(visible_message)
    await db_session.refresh(source_message)
    hidden = await db_session.get(Chat, source_message.chat_id)
    assert visible.deleted_at is not None
    assert visible_message.deleted_at is not None
    assert hidden is not None
    assert hidden.deleted_at is None
    assert source_message.deleted_at is None
    assert source_message.content_text == "channel-search-needle"


@pytest.mark.parametrize(
    ("display_name", "expected_names"),
    [
        (
            "Fancy / MODEL v2.1!!",
            ["fancy-model-v2.1", "fancy-model-v2.1-2", "fancy-model-v2.1-3"],
        ),
        ("A" * 40, ["a" * 32, "a" * 30 + "-2", "a" * 30 + "-3"]),
    ],
)
async def test_default_member_names_are_slugged_deduplicated_and_capped(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    display_name: str,
    expected_names: list[str],
) -> None:
    monkeypatch.setitem(
        MODELS, TEST_MODEL_ID, MODELS[TEST_MODEL_ID]._replace(display_name=display_name)
    )
    channel_data["members"] *= 3
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == 201, response.text
    assert [
        member["display_name"] for member in response.json()["members"]
    ] == expected_names


async def test_default_permission_modes_follow_each_provider(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
) -> None:
    models_by_kind = {model.agent_kind: model_id for model_id, model in MODELS.items()}
    expected_modes = {
        AgentKind.CLAUDE: "default",
        AgentKind.CODEX: "auto",
        AgentKind.OPENCODE: "build",
    }
    channel_data["members"] = [
        {"model_id": models_by_kind[kind]} for kind in expected_modes
    ]
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == 201, response.text
    members = response.json()["members"]
    assert {member["model_id"] for member in members} == {
        models_by_kind[kind] for kind in expected_modes
    }
    for member in members:
        assert (
            member["permission_mode"]
            == expected_modes[MODELS[member["model_id"]].agent_kind]
        )


@pytest.mark.parametrize(
    ("member_overrides", "status_code"),
    [
        ([{"display_name": "Reviewer"}, {"display_name": "reviewer"}], 400),
        ([{"display_name": "bad name"}], 422),
        ([{"display_name": "name!"}], 422),
        ([{"display_name": "-leading"}], 422),
        ([{"display_name": "a" * 33}], 422),
        ([{"display_name": ""}], 422),
        ([{"permission_mode": "default"}], 400),
        ([{"model_id": "unknown-model"}], 422),
    ],
    ids=[
        "duplicate-name",
        "space",
        "punctuation",
        "leading-hyphen",
        "too-long",
        "empty",
        "provider-mode",
        "unknown-model",
    ],
)
async def test_channel_creation_rejects_invalid_members(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    member_overrides: list[dict[str, str]],
    status_code: int,
) -> None:
    channel_data["members"] = [
        {"model_id": TEST_MODEL_ID, **overrides} for overrides in member_overrides
    ]
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == status_code, response.text


@pytest.mark.parametrize("workspace_status", ["foreign", "deleted"])
async def test_channel_creation_requires_an_owned_live_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    workspace_status: str,
) -> None:
    if workspace_status == "foreign":
        channel_data["workspace_id"] = str(other_owner[2].id)
    else:
        owner[2].deleted_at = datetime.now(timezone.utc)
        await db_session.commit()
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Workspace not found"


async def test_worktree_creation_requires_a_sandbox(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
) -> None:
    owner[2].sandbox_id = ""
    await db_session.commit()
    channel_data["worktree"] = True
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Workspace has no sandbox"
