import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import chat as chat_endpoint
from app.constants import MODELS
from app.core import deps
from app.core.security import create_mcp_access_token
from app.models.db_models.automation import Automation
from app.models.db_models.channel import (
    Channel,
    ChannelDelivery,
    ChannelMember,
    ChannelMessage,
)
from app.core.security import create_scoped_mcp_token
from app.core.user_manager import password_fingerprint
from app.models.db_models.chat import Chat, Message, MessageAttachment
from app.models.db_models.enums import AttachmentType, MessageRole, MessageStreamStatus
from app.models.db_models.paired_device import PairedDevice
from app.models.db_models.push import PushDelivery
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.chat import ChatRequest
from app.models.types import AgentKind
from app.services import automation as automation_module
from app.services import channel as channel_module
from app.services import push as push_module
from app.services.channel import (
    MAX_ATTEMPTS,
    ChannelService,
    ChannelState,
    MemberTurn,
    TurnStatus,
    channel_service,
)
from app.services.automation import AutomationService
from app.services.chat import ChatService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChannelMemberTurn, EventSink
from app.services.user import UserService

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    EndpointCache,
    FakeProviderFactory,
    create_authenticated_workspace,
    create_chat_row,
)


TEST_MODEL_ID = "opencode:google-vertex/claude-sonnet-4-6@default"

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


async def attach_file(message_id: UUID, filename: str) -> None:
    async with channel_service.session_factory() as db:
        db.add(
            MessageAttachment(
                message_id=message_id,
                file_url="/api/v1/attachments/pending/preview",
                file_path=f"attachments/{filename}",
                file_type=AttachmentType.PDF
                if filename.endswith(".pdf")
                else AttachmentType.IMAGE,
                filename=filename,
            )
        )
        await db.commit()


async def hand_off(source: Message) -> None:
    async with channel_service.session_factory() as db:
        chat = await db.get_one(Chat, source.chat_id)
    await channel_service.attachment_saved(chat, source.id)


ATTACH = [
    ("tool_started", {"tool": {"id": "attach"}}),
    ("attach", {"filename": "chart.png"}),
    ("tool_completed", {"tool": {"id": "attach"}}),
]


class ScriptedTurns:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = [
            ("assistant_text", {"text": "PASS"})
        ]
        self.requests: list[ChatRequest] = []
        self.sources: list[Message] = []
        self.turns: list[MemberTurn] = []
        self.publications: list[tuple[UUID, str, dict[str, Any]]] = []
        self.duration_ms: int | None = 1234
        self.gate: asyncio.Event | None = None
        self.emitted = asyncio.Event()
        self.provider_tasks: dict[str, asyncio.Task[str]] = {}
        self.device_ids: list[frozenset[UUID]] = []

    async def initiate_chat_completion(
        self,
        request: ChatRequest,
        user: User,
        *,
        member_turn: ChannelMemberTurn,
        device_ids: frozenset[UUID],
    ) -> None:
        self.requests.append(request)
        self.device_ids.append(device_ids)
        async with channel_service.session_factory() as db:
            source = await create_source_message(
                db, request.chat_id, duration_ms=self.duration_ms
            )
        self.sources.append(source)
        task = asyncio.create_task(
            self.emit(member_turn.event_sink, source, self.events)
        )
        self.provider_tasks[str(request.chat_id)] = task
        member_turn.task_started(task)

    async def emit(
        self,
        event_sink: EventSink,
        source: Message,
        events: list[tuple[str, dict[str, Any]]],
    ) -> str:
        await event_sink("stream_started", {"message_id": str(source.id)})
        for kind, payload in events:
            if kind == "attach":
                await attach_file(source.id, payload["filename"])
                await hand_off(source)
            else:
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


def activity_publications(runtime: ScriptedTurns) -> list[dict[str, Any]]:
    return [
        payload
        for _, kind, payload in runtime.publications
        if kind == "channel_member_activity"
    ]


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
def channel_queue(monkeypatch: pytest.MonkeyPatch) -> EndpointCache:
    cache = EndpointCache()
    monkeypatch.setattr(deps, "cache_connection", cache.connect)
    monkeypatch.setattr(channel_module, "cache_connection", cache.connect)
    monkeypatch.setattr(automation_module, "cache_connection", cache.connect)
    return cache


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
        ("*", True),
        ("```py\nx = 1\n```", False),
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
    message = await channel_service.new_message(
        channel_state, "Any objections?", device_ids=frozenset()
    )
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


@pytest.mark.parametrize(
    "replies", [["Shipped it."], ["PASS"], ["Shipped it.", "PASS"]]
)
async def test_settled_run_pushes_its_last_visible_reply_once(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    channel_queue: EndpointCache,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    replies: list[str],
) -> None:
    for name in ("APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID"):
        monkeypatch.setattr(push_module.settings, name, "configured")
    response = await client.post(
        "/api/v1/push/devices",
        json={"token": "abc123", "sandbox": True},
        headers=owner[0],
    )
    assert response.status_code == 204
    await channel_service.new_message(channel_state, "Ship it?", device_ids=frozenset())

    for index, reply in enumerate(replies):
        if index:
            await channel_service.post(channel_state.channel, "Again?", [], frozenset())
            assert channel_state.timer is not None
            channel_state.timer.cancel()
            await asyncio.gather(channel_state.timer, return_exceptions=True)
            channel_state.timer = None
        channel_runtime.events = [("assistant_text", {"text": reply})]
        await channel_runtime.wake(channel_state)
    await channel_runtime.wake(channel_state)
    await channel_runtime.wake(channel_state)

    deliveries = (await db_session.scalars(select(PushDelivery))).all()
    completions = [
        payload
        for payload in activity_publications(channel_runtime)
        if "completed" in payload
    ]
    if replies != ["Shipped it."]:
        assert deliveries == []
        assert completions == []
        return
    [delivery] = deliveries
    [message] = [
        message
        for message in await channel_service.messages(channel_state.channel, 0)
        if message.member_id is not None
    ]
    member = channel_state.channel.members[0]
    assert (delivery.event_key, delivery.path, delivery.collapse_id) == (
        f"{message.id}:complete",
        f"/channels/{channel_state.channel.id}",
        f"{channel_state.channel.id}:complete",
    )
    assert (delivery.title, delivery.body) == (
        "#Review",
        f"{member.display_name}: Shipped it.",
    )
    [completion] = completions
    assert completion.pop("completed") == {
        "title": delivery.title,
        "body": delivery.body,
    }
    assert completion == channel_service.member_activity(channel_state)


async def test_tool_segments_counts_and_source_duration_are_persisted(
    channel_state: ChannelState, channel_runtime: ScriptedTurns
) -> None:
    await channel_service.new_message(
        channel_state, "Check the implementation", device_ids=frozenset()
    )
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
    first = await channel_service.new_message(
        channel_state, "Review this", device_ids=frozenset()
    )
    channel_runtime.events = [
        ("assistant_text", {"text": "Checking now."}),
        ("tool_started", {"tool": {"id": "check"}}),
        ("assistant_text", {"text": "PASS"}),
        ("tool_completed", {"tool": {"id": "check"}}),
    ]
    await channel_runtime.wake(channel_state)
    second = await channel_service.new_message(
        channel_state, "Explain the result", device_ids=frozenset()
    )
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


@pytest.mark.parametrize(
    ("events", "status", "content"),
    [
        (
            [*ATTACH, ("assistant_text", {"text": "Here is the chart."})],
            "completed",
            "Here is the chart.",
        ),
        (
            [
                ("assistant_text", {"text": "Drawing it."}),
                *ATTACH,
                ("attach", {"filename": "report.pdf"}),
                ("tool_completed", {"tool": {"id": "attach-pdf"}}),
                ("assistant_text", {"text": "Done."}),
            ],
            "completed",
            "Done.",
        ),
        ([*ATTACH, ("assistant_text", {"text": "PASS"})], "completed", ""),
        (
            [
                ("assistant_text", {"text": "Drawing it."}),
                *ATTACH,
                ("error", {"error": "Provider failed"}),
            ],
            "cancelled",
            "Drawing it.",
        ),
        ([*ATTACH[:2], ("cancelled", {})], "cancelled", ""),
    ],
    ids=["before-text", "while-streaming", "pass", "failed", "stopped"],
)
async def test_member_attachments_are_promoted_onto_its_reply(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    events: list[tuple[str, dict[str, Any]]],
    status: str,
    content: str,
) -> None:
    base = f"/api/v1/channels/{channel_state.channel.id}"
    await channel_service.new_message(channel_state, "Draw it", device_ids=frozenset())
    await client.post(f"{base}/viewed", headers=owner[0])
    channel_runtime.events = events
    await channel_runtime.wake(channel_state)

    reply = (await client.get(f"{base}/messages", headers=owner[0])).json()[-1]
    assert (reply["author_type"], reply["status"], reply["content"]) == (
        "agent",
        status,
        content,
    )
    filenames = [event[1]["filename"] for event in events if event[0] == "attach"]
    assert [a["filename"] for a in reply["attachments"]] == filenames
    assert [a["file_url"] for a in reply["attachments"]] == [
        f"/api/v1/attachments/{a['id']}/preview" for a in reply["attachments"]
    ]
    published = [
        payload["message"]
        for _, kind, payload in channel_runtime.publications
        if kind == "channel_message" and payload["message"]["id"] == reply["id"]
    ]
    assert published[-1] == reply
    assert any(
        message["status"] == "streaming" and message["attachments"]
        for message in published
    )
    assert (await client.get(base, headers=owner[0])).json()["unread"] is True
    if status == "completed":
        channel_state.paused = False
        assert await channel_service.settle(channel_state) == (
            UUID(reply["id"]),
            "#Review",
            f"{channel_state.channel.members[0].display_name}: "
            + (content or "Open the channel to see the result."),
        )
        channel_state.paused = True


async def test_attachment_saved_after_the_turn_finished_lands_on_a_reply(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    await channel_service.new_message(channel_state, "Draw it", device_ids=frozenset())
    channel_runtime.events = [("cancelled", {})]
    await channel_runtime.wake(channel_state)
    url = f"/api/v1/channels/{channel_state.channel.id}/messages"
    assert len((await client.get(url, headers=owner[0])).json()) == 1

    [source] = channel_runtime.sources
    await db_session.execute(
        update(Message)
        .where(Message.id == source.id)
        .values(stream_status=MessageStreamStatus.INTERRUPTED)
    )
    await db_session.commit()
    await attach_file(source.id, "chart.png")
    for _ in range(2):
        await hand_off(source)

    _, reply = (await client.get(url, headers=owner[0])).json()
    assert (reply["status"], reply["content"]) == ("cancelled", "")
    assert [a["filename"] for a in reply["attachments"]] == ["chart.png"]
    published = [
        payload["message"]
        for _, kind, payload in channel_runtime.publications
        if kind == "channel_message"
    ]
    assert published[-1] == reply


async def test_attachment_of_a_removed_member_lands_on_its_reply(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    channel_data["members"] = [
        {"model_id": TEST_MODEL_ID, "display_name": name} for name in ("alpha", "beta")
    ]
    created = await client.post("/api/v1/channels", json=channel_data, headers=owner[0])
    assert created.status_code == 201, created.text
    channel_id = UUID(created.json()["id"])
    channel_service.states[channel_id].paused = True
    beta = channel_service.states[channel_id].channel.members[1]
    handed, recovered = [
        await create_source_message(db_session, beta.chat_id) for _ in range(2)
    ]
    base = f"/api/v1/channels/{channel_id}"
    removed = await client.delete(f"{base}/members/{beta.id}", headers=owner[0])
    assert removed.status_code == 200, removed.text
    assert [m["id"] for m in removed.json()["former_members"]] == [str(beta.id)]

    await attach_file(handed.id, "handed.png")
    await hand_off(handed)
    await attach_file(recovered.id, "recovered.png")
    await channel_service.recover()
    for state in channel_service.states.values():
        state.paused = True
        channel_service.schedule(state)

    replies = (await client.get(f"{base}/messages", headers=owner[0])).json()
    assert sorted(
        (r["member_id"], r["status"], [a["filename"] for a in r["attachments"]])
        for r in replies
    ) == [
        (str(beta.id), "completed", ["handed.png"]),
        (str(beta.id), "completed", ["recovered.png"]),
    ]


async def test_attachment_saved_for_a_deleted_channel_is_ignored(
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    source = await create_source_message(
        db_session, channel_state.channel.members[0].chat_id
    )
    await attach_file(source.id, "chart.png")
    channel_state.deleted = True
    await hand_off(source)

    assert await channel_service.messages(channel_state.channel, 0) == []
    assert channel_runtime.publications == []


async def test_recover_cancels_and_republishes_streaming_replies(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
) -> None:
    reply = await channel_service.new_message(
        channel_state,
        "Partial reply",
        channel_state.channel.members[0].id,
        device_ids=frozenset(),
    )

    await channel_service.recover()
    for state in channel_service.states.values():
        state.paused = True
        channel_service.schedule(state)

    [published] = [
        payload["message"]
        for _, kind, payload in channel_runtime.publications
        if kind == "channel_message"
    ]
    assert (published["id"], published["status"], published["content"]) == (
        str(reply.id),
        "cancelled",
        "Partial reply",
    )


async def test_recover_promotes_attachments_of_interrupted_replies(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    member = channel_state.channel.members[0]
    replies = {}
    for text in ("Here is the chart.", "", "PASS"):
        source = await create_source_message(db_session, member.chat_id)
        if text != "PASS":
            await attach_file(source.id, "chart.png")
        replies[text] = await channel_service.new_message(
            channel_state,
            text,
            member.id,
            source_message_id=source.id,
            device_ids=frozenset(),
        )
    orphan = await create_source_message(db_session, member.chat_id)
    orphan.stream_status = MessageStreamStatus.IN_PROGRESS
    await db_session.commit()
    await attach_file(orphan.id, "orphan.png")
    missed = await create_source_message(db_session, member.chat_id)
    replies["Done."] = await channel_service.new_message(
        channel_state,
        "Done.",
        member.id,
        source_message_id=missed.id,
        device_ids=frozenset(),
    )
    await db_session.execute(
        update(ChannelMessage)
        .where(ChannelMessage.id == replies["Done."].id)
        .values(status="completed")
    )
    await db_session.commit()
    await attach_file(missed.id, "missed.png")

    for _ in range(2):
        await channel_service.recover()
    for state in channel_service.states.values():
        state.paused = True
        channel_service.schedule(state)

    messages = {
        message["id"]: message
        for message in (
            await client.get(
                f"/api/v1/channels/{channel_state.channel.id}/messages",
                headers=owner[0],
            )
        ).json()
    }
    for text, expected in (
        ("Here is the chart.", ("cancelled", "Here is the chart.", ["chart.png"])),
        ("", ("cancelled", "", ["chart.png"])),
        ("PASS", ("deleted", "", [])),
        ("Done.", ("completed", "Done.", ["missed.png"])),
    ):
        message = messages[str(replies[text].id)]
        assert (
            message["status"],
            message["content"],
            [a["filename"] for a in message["attachments"]],
        ) == expected
    [orphan_reply] = [
        message
        for message in messages.values()
        if message["id"] not in {str(reply.id) for reply in replies.values()}
    ]
    assert (
        orphan_reply["status"],
        orphan_reply["content"],
        [a["filename"] for a in orphan_reply["attachments"]],
    ) == ("cancelled", "", ["orphan.png"])
    published = [
        payload["message"]
        for _, kind, payload in channel_runtime.publications
        if kind == "channel_message"
    ]
    assert [m["attachments"] for m in published if m["status"] == "cancelled"][:2] == [
        messages[str(replies[text].id)]["attachments"]
        for text in ("Here is the chart.", "")
    ]


async def test_member_chat_attachment_routes_allow_only_the_owner(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    headers, user, _workspace = owner
    member = channel_state.channel.members[0]
    source = Message(
        chat_id=member.chat_id,
        content_text="",
        content_render={"events": []},
        role=MessageRole.ASSISTANT,
        stream_status=MessageStreamStatus.IN_PROGRESS,
    )
    db_session.add(source)
    docker_workspace = Workspace(
        name="Docker Workspace",
        user_id=user.id,
        sandbox_id="sandbox-docker",
        sandbox_provider="docker",
        workspace_path="/tmp/agentrove-test-docker",
        source_type="empty",
    )
    db_session.add(docker_workspace)
    await db_session.commit()
    docker_chat = await create_chat_row(db_session, user, docker_workspace)
    scoped_token = create_scoped_mcp_token(
        {
            "sub": str(user.id),
            "wid": str(docker_workspace.id),
            "cid": str(docker_chat.id),
            "did": [],
            "pwd": password_fingerprint(user.hashed_password),
        }
    )
    scoped = {"Authorization": f"Bearer {scoped_token}"}
    url = f"/api/v1/chat/chats/{member.chat_id}/attachments"
    upload = {"file": ("chart.png", b"\x89PNG member", "image/png")}

    for path, request_headers, kwargs, expected_status in [
        (url, other_owner[0], {"files": upload}, 404),
        (f"{url}/sandbox", other_owner[0], {"json": {"path": "chart.png"}}, 404),
        (f"{url}/sandbox", scoped, {"json": {"path": "chart.png"}}, 404),
        (url, scoped, {"files": upload}, 403),
    ]:
        response = await client.post(path, headers=request_headers, **kwargs)
        assert response.status_code == expected_status, (path, response.text)

    response = await client.post(url, files=upload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["message_id"] == str(source.id)
    reply = await db_session.scalar(
        select(ChannelMessage).where(ChannelMessage.source_message_id == source.id)
    )
    assert reply is not None
    assert reply.status == "cancelled"
    for action in ("preview", "download"):
        hidden = f"/api/v1/attachments/{response.json()['id']}/{action}"
        assert (await client.get(hidden, headers=headers)).status_code == 404
        path = f"/api/v1/attachments/{reply.attachments[0].id}/{action}"
        owner_response = await client.get(path, headers=headers)
        assert owner_response.status_code == 200, path
        assert owner_response.content == b"\x89PNG member"
        other_response = await client.get(path, headers=other_owner[0])
        assert other_response.status_code == 403, path


@pytest.mark.parametrize("outcome", ["error", "cancelled"])
async def test_unsuccessful_turn_redelivers_batch_and_cancelled_duration_falls_back(
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
    outcome: str,
) -> None:
    first = await channel_service.new_message(
        channel_state, "First question", device_ids=frozenset()
    )
    second = await channel_service.new_message(
        channel_state, "Second question", device_ids=frozenset()
    )
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


async def test_revoking_a_device_cancels_its_member_turn_and_drops_its_messages(
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    device = PairedDevice(user_id=channel_state.channel.user_id, name="Laptop")
    db_session.add(device)
    await db_session.commit()
    message = await channel_service.new_message(
        channel_state, "Run the migration", device_ids=frozenset({device.id})
    )
    channel_runtime.events = [("assistant_text", {"text": "Partial reply"})]
    channel_runtime.gate = asyncio.Event()
    wake = asyncio.create_task(channel_runtime.wake(channel_state))
    await asyncio.wait_for(channel_runtime.emitted.wait(), timeout=5)
    member = channel_state.channel.members[0]
    turn = channel_state.turns[member.id]
    assert channel_runtime.device_ids == [frozenset({device.id})]

    device.revoked_at = datetime.now(timezone.utc)
    await db_session.commit()
    await channel_service.cancel_device_turns(frozenset({device.id}))
    await asyncio.gather(wake, return_exceptions=True)
    await channel_runtime.wake(channel_state)

    assert turn.status is TurnStatus.FINISHED
    assert turn.message is not None
    reply = await db_session.get(ChannelMessage, turn.message.id)
    assert reply is not None
    assert reply.status == "cancelled"
    assert len(channel_runtime.requests) == 1
    assert (await db_session.scalars(select(ChannelDelivery.message_id))).all() == [
        message.id
    ]


@pytest.mark.parametrize("action", ["messages", "stop"])
async def test_running_turn_is_interrupted_by_owner(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
    action: str,
) -> None:
    first = await channel_service.new_message(
        channel_state, "First question", device_ids=frozenset()
    )
    second = await channel_service.new_message(
        channel_state, "Second question", device_ids=frozenset()
    )
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


async def test_mentions_wake_only_addressed_members_and_keep_the_rest_as_context(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    channel_runtime: ScriptedTurns,
) -> None:
    channel_data["members"] = [
        {"model_id": TEST_MODEL_ID, "display_name": name} for name in ("alpha", "beta")
    ]
    response = await client.post(
        "/api/v1/channels", json=channel_data, headers=owner[0]
    )
    assert response.status_code == 201, response.text
    state = channel_service.states[UUID(response.json()["id"])]
    alpha, beta = state.channel.members
    targeted = await channel_service.new_message(
        state,
        "@alpha check @beta/file.ts and https://x.dev/@beta",
        device_ids=frozenset(),
    )
    assert targeted.audience == [str(alpha.id)]

    channel_runtime.events = [("assistant_text", {"text": "On it"})]
    await channel_runtime.wake(state)
    await channel_runtime.wake(state)
    assert [request.chat_id for request in channel_runtime.requests] == [alpha.chat_id]

    await channel_service.new_message(
        state, "@everyone thoughts?", device_ids=frozenset()
    )
    channel_runtime.events = [("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(state)
    prompts = {request.chat_id: request.prompt for request in channel_runtime.requests}
    assert prompts[beta.chat_id].endswith(
        "[user → @alpha]: @alpha check @beta/file.ts and https://x.dev/@beta\n"
        "[alpha → user]: On it\n"
        "[user]: @everyone thoughts?"
    )
    assert prompts[alpha.chat_id] == "[user]: @everyone thoughts?"


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
    first = await channel_service.new_message(
        state, "First question", device_ids=frozenset()
    )
    second = await channel_service.new_message(
        state, "Second question", device_ids=frozenset()
    )
    reply = await channel_service.new_message(
        state, "Prior reply", state.channel.members[0].id, device_ids=frozenset()
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


async def test_backoff_doubles_skips_wakes_and_clears_on_success(
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    message = await channel_service.new_message(
        channel_state, "Please retry", device_ids=frozenset()
    )
    member = channel_state.channel.members[0]
    channel_runtime.events = [("error", {"error": "Provider unavailable"})]
    loop = asyncio.get_running_loop()
    for expected_delay in (5, 10, 20, 40):
        if member.id in channel_state.retries:
            channel_state.retries[member.id].until = loop.time()
        started = loop.time()
        await channel_runtime.wake(channel_state)
        elapsed = loop.time() - started
        retry = channel_state.retries[member.id]
        assert retry.delay == expected_delay
        assert activity_publications(channel_runtime)[-1]["member_ids"] == []
        assert activity_publications(channel_runtime)[-1]["retrying_member_ids"] == [
            str(member.id)
        ]
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
    assert activity_publications(channel_runtime)[-1]["retrying_member_ids"] == []
    deliveries = (await db_session.scalars(select(ChannelDelivery))).all()
    assert [(row.member_id, row.message_id) for row in deliveries] == [
        (member.id, message.id)
    ]


async def test_failed_turn_reason_is_in_the_activity_snapshot_until_success(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
) -> None:
    await channel_service.new_message(
        channel_state, "Please retry", device_ids=frozenset()
    )
    member = channel_state.channel.members[0]
    long_reason = "Provider unavailable: " + "x" * 400
    channel_runtime.events = [
        ("error", {"error": f"{long_reason}\nTraceback (most recent call last):"})
    ]
    await channel_runtime.wake(channel_state)
    url = f"/api/v1/channels/{channel_state.channel.id}/member-activity"

    activity = (await client.get(url, headers=owner[0])).json()
    reason = activity["member_errors"][str(member.id)]
    assert activity["retrying_member_ids"] == [str(member.id)]
    assert reason == f"{long_reason[:299]}…"

    channel_state.retries[member.id].until = asyncio.get_running_loop().time()
    channel_runtime.events = [("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(channel_state)
    activity = (await client.get(url, headers=owner[0])).json()
    assert activity["retrying_member_ids"] == []
    assert activity["member_errors"] == {}


async def give_up(state: ChannelState, runtime: ScriptedTurns) -> None:
    member_id = state.channel.members[0].id
    runtime.events = [("error", {"error": "Authentication required"})]
    for _ in range(MAX_ATTEMPTS):
        if member_id in state.retries:
            state.retries[member_id].until = asyncio.get_running_loop().time()
        await runtime.wake(state)


async def test_member_gives_up_after_max_attempts(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
) -> None:
    await channel_service.new_message(
        channel_state, "Please retry", device_ids=frozenset()
    )
    member = channel_state.channel.members[0]
    await give_up(channel_state, channel_runtime)
    activity = (
        await client.get(
            f"/api/v1/channels/{channel_state.channel.id}/member-activity",
            headers=owner[0],
        )
    ).json()

    assert len(channel_runtime.requests) == MAX_ATTEMPTS
    assert activity["retrying_member_ids"] == []
    assert activity["member_errors"] == {}
    assert activity["unavailable_members"] == {
        str(member.id): "Gave up after 5 attempts: Authentication required"
    }
    assert channel_state.retries == {}
    assert channel_state.turns == {}
    await channel_runtime.wake(channel_state)
    assert len(channel_runtime.requests) == MAX_ATTEMPTS


async def test_member_that_gave_up_does_not_keep_a_failed_turn(
    monkeypatch: pytest.MonkeyPatch,
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
) -> None:
    await channel_service.new_message(
        channel_state, "Please retry", device_ids=frozenset()
    )
    member = channel_state.channel.members[0]
    finish = channel_service.finish

    async def failing_finish(state: ChannelState, turn: MemberTurn) -> None:
        if turn.member.id in state.gave_up:
            raise RuntimeError("Database unavailable")
        await finish(state, turn)

    monkeypatch.setattr(channel_service, "finish", failing_finish)
    await give_up(channel_state, channel_runtime)
    assert member.id in channel_state.turns
    await channel_runtime.wake(channel_state)
    activity = (
        await client.get(
            f"/api/v1/channels/{channel_state.channel.id}/member-activity",
            headers=owner[0],
        )
    ).json()

    assert len(channel_runtime.requests) == MAX_ATTEMPTS
    assert channel_state.turns == {}
    assert channel_state.retries == {}
    channel_state.paused = False
    assert ChannelService.idle(channel_state)
    assert activity["retrying_member_ids"] == []
    assert activity["unavailable_members"] == {
        str(member.id): "Gave up after 5 attempts: Authentication required"
    }


async def test_user_post_gives_a_member_that_gave_up_fresh_attempts(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
) -> None:
    await channel_service.new_message(
        channel_state, "Please retry", device_ids=frozenset()
    )
    member = channel_state.channel.members[0]
    await give_up(channel_state, channel_runtime)

    response = await client.post(
        f"/api/v1/channels/{channel_state.channel.id}/messages",
        headers=owner[0],
        data={"content": "Try again"},
    )
    assert response.status_code == 201
    channel_state.paused = True
    if channel_state.timer is not None:
        channel_state.timer.cancel()
        await asyncio.gather(channel_state.timer, return_exceptions=True)
        channel_state.timer = None
    assert activity_publications(channel_runtime)[-1]["unavailable_members"] == {}

    await channel_runtime.wake(channel_state)
    assert len(channel_runtime.requests) == MAX_ATTEMPTS + 1
    assert channel_state.retries[member.id].attempts == 1
    assert activity_publications(channel_runtime)[-1]["retrying_member_ids"] == [
        str(member.id)
    ]


async def test_unknown_model_member_is_reported_unavailable(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
) -> None:
    member = channel_state.channel.members[0]
    await db_session.execute(
        update(ChannelMember)
        .where(ChannelMember.id == member.id)
        .values(model_id="retired:model")
    )
    await db_session.commit()
    member.model_id = "retired:model"
    await channel_service.new_message(channel_state, "Hello", device_ids=frozenset())
    await channel_runtime.wake(channel_state)

    response = await client.get(
        f"/api/v1/channels/{channel_state.channel.id}", headers=owner[0]
    )
    assert channel_runtime.requests == []
    assert response.json()["activity"]["unavailable_members"] == {
        str(member.id): "Model retired:model is unknown on this instance"
    }
    permission_only = await client.patch(
        f"/api/v1/channels/{channel_state.channel.id}/members/{member.id}",
        json={"permission_mode": "build"},
        headers=owner[0],
    )
    assert permission_only.status_code == 400, permission_only.text
    assert "known model" in permission_only.json()["detail"]


async def test_activity_reports_members_waiting_for_approval(
    channel_state: ChannelState, channel_runtime: ScriptedTurns
) -> None:
    await channel_service.new_message(
        channel_state, "Run the migration", device_ids=frozenset()
    )
    channel_runtime.events = [
        (
            "permission_request",
            {
                "request_id": "request-1",
                "tool_name": "bash",
                "tool_input": {},
                "data": {"options": []},
            },
        ),
        ("assistant_text", {"text": "PASS"}),
    ]
    await channel_runtime.wake(channel_state)

    member_id = str(channel_state.channel.members[0].id)
    assert [
        (activity["member_ids"], activity["waiting_member_ids"])
        for activity in activity_publications(channel_runtime)
    ] == [
        ([member_id], []),
        ([member_id], [member_id]),
        ([member_id], []),
        ([], []),
    ]


@pytest.mark.parametrize("resolved", [True, False], ids=["resolved", "turn-ended"])
async def test_activity_reports_member_questions_until_resolved(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    resolved: bool,
) -> None:
    for name in ("APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID"):
        monkeypatch.setattr(push_module.settings, name, "configured")
    response = await client.post(
        "/api/v1/push/devices",
        json={"token": "abc123", "sandbox": True},
        headers=owner[0],
    )
    assert response.status_code == 204
    await channel_service.new_message(
        channel_state, "Pick a color", device_ids=frozenset()
    )
    data = {"message": "Choose a color", "tool_call_id": None, "requested_schema": {}}
    request = ("elicitation_request", {"request_id": "elicit-1", "data": data})
    channel_runtime.events = [
        request,
        request,
        *([("elicitation_resolved", {"request_id": "elicit-1"})] if resolved else []),
        ("assistant_text", {"text": "PASS"}),
    ]
    await channel_runtime.wake(channel_state)

    member = channel_state.channel.members[0]
    member_id = str(member.id)
    pending = {
        "member_id": member_id,
        "chat_id": str(member.chat_id),
        "request": {"request_id": "elicit-1", **data},
    }
    activities = activity_publications(channel_runtime)
    assert [
        (
            activity["member_ids"],
            activity["waiting_member_ids"],
            activity["elicitations"],
        )
        for activity in activities
    ] == [
        ([member_id], [], []),
        ([member_id], [member_id], [pending]),
        ([member_id], [], []),
        ([], [], []),
    ]
    assert activities[1]["asked"] == {
        "title": f"#{channel_state.channel.name}",
        "body": f"{member.display_name} asks: Choose a color",
    }
    assert [activity.get("asked") for activity in activities[2:]] == [None, None]
    assert channel_state.elicitations == {}

    await channel_service.new_message(
        channel_state, "Pick again", device_ids=frozenset()
    )
    channel_runtime.events = [request, ("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(channel_state)

    path = f"/channels/{channel_state.channel.id}"
    deliveries = (await db_session.scalars(select(PushDelivery))).all()
    assert sorted(
        (row.event_key, row.collapse_id, row.title, row.body, row.path)
        for row in deliveries
    ) == sorted(
        (
            f"{path}:ask:{source.id}:elicit-1",
            f"ask:{source.id}:elicit-1",
            f"#{channel_state.channel.name}",
            f"{member.display_name} asks: Choose a color",
            path,
        )
        for source in channel_runtime.sources
    )


async def test_question_from_a_finished_turn_is_declined(
    channel_state: ChannelState,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    declined: list[tuple[str, str, str]] = []

    def resolve_elicitation(chat_id: str, request_id: str, *, action: str) -> bool:
        declined.append((chat_id, request_id, action))
        return True

    monkeypatch.setattr(
        channel_module.session_registry, "resolve_elicitation", resolve_elicitation
    )
    member = channel_state.channel.members[0]
    turn = MemberTurn(member, [], status=TurnStatus.CANCELLED)
    await channel_service.handle_event(
        channel_state,
        turn,
        "elicitation_request",
        {"request_id": "elicit-1", "data": {"message": "Choose"}},
    )
    assert declined == [(str(member.chat_id), "elicit-1", "decline")]
    assert channel_state.elicitations == {}


@pytest.mark.parametrize(
    "authenticated", [True, False], ids=["other-user", "anonymous"]
)
async def test_channel_routes_require_the_owner(
    client: AsyncClient,
    channel_state: ChannelState,
    source_message: Message,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    channel_queue: EndpointCache,
    authenticated: bool,
) -> None:
    message = await channel_service.new_message(
        channel_state,
        "Agent reply",
        channel_state.channel.members[0].id,
        source_message_id=source_message.id,
        device_ids=frozenset(),
    )
    base = f"/api/v1/channels/{channel_state.channel.id}"
    queued = await client.post(
        f"{base}/queue", headers=owner[0], data={"content": "Queued"}
    )
    assert queued.status_code == 201
    queued_path = f"{base}/queue/{queued.json()['id']}"
    member_path = f"{base}/members/{channel_state.channel.members[0].id}"
    routes: list[tuple[str, str, dict[str, Any]]] = [
        ("GET", base, {}),
        ("PATCH", base, {"json": {"name": "Renamed"}}),
        ("PATCH", base, {"json": {"pinned": True}}),
        ("DELETE", base, {}),
        ("GET", f"{base}/messages", {}),
        ("POST", f"{base}/messages", {"data": {"content": "Hello"}}),
        ("GET", f"{base}/messages/{message.id}/activity", {}),
        ("GET", f"{base}/permissions", {}),
        ("GET", f"{base}/member-activity", {}),
        ("POST", f"{base}/viewed", {}),
        ("POST", f"{base}/stop", {}),
        ("GET", f"{base}/queue", {}),
        ("POST", f"{base}/queue", {"data": {"content": "Hello"}}),
        ("PATCH", queued_path, {"json": {"content": "Hijacked"}}),
        ("DELETE", queued_path, {}),
        ("POST", f"{queued_path}/send-now", {}),
        ("POST", f"{base}/members", {"json": {"model_id": TEST_MODEL_ID}}),
        ("PATCH", member_path, {"json": {"display_name": "Hijacked"}}),
        ("DELETE", member_path, {}),
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
    queue = await client.get(f"{base}/queue", headers=owner[0])
    assert [item["content"] for item in queue.json()] == ["Queued"]


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


async def test_member_reply_marks_channel_unread_until_viewed(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    base = f"/api/v1/channels/{channel_state.channel.id}"
    assert (await client.get(base, headers=owner[0])).json()["unread"] is True
    for _ in range(2):
        response = await client.post(f"{base}/viewed", headers=owner[0])
        assert response.status_code == 204, response.text
        assert (await client.get(base, headers=owner[0])).json()["unread"] is False

    await channel_service.new_message(
        channel_state,
        "Agent reply",
        channel_state.channel.members[0].id,
        device_ids=frozenset(),
    )
    listed = await client.get("/api/v1/channels", headers=owner[0])
    assert [channel["unread"] for channel in listed.json()] == [True]

    await client.post(f"{base}/viewed", headers=owner[0])
    assert (await client.get(base, headers=owner[0])).json()["unread"] is False


async def test_messages_page_latest_and_before_seq_and_keep_after_seq(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    for index in range(5):
        await channel_service.new_message(
            channel_state, f"Message {index}", device_ids=frozenset()
        )
    url = f"/api/v1/channels/{channel_state.channel.id}/messages"
    cases: list[tuple[dict[str, int], list[int]]] = [
        ({"limit": 2}, [4, 5]),
        ({"limit": 2, "before_seq": 4}, [2, 3]),
        ({"limit": 2, "before_seq": 2}, [1]),
        ({"limit": 2, "before_seq": 1}, []),
        ({"after_seq": 2}, [3, 4, 5]),
        ({}, [1, 2, 3, 4, 5]),
    ]
    for params, expected in cases:
        response = await client.get(url, headers=owner[0], params=params)
        assert [message["seq"] for message in response.json()] == expected, params
    for params in ({"limit": 0}, {"limit": 101}, {"before_seq": 0}):
        response = await client.get(url, headers=owner[0], params=params)
        assert response.status_code == 422


async def test_own_post_and_rename_keep_a_read_channel_read(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    base = f"/api/v1/channels/{channel_state.channel.id}"
    await client.post(f"{base}/viewed", headers=owner[0])

    response = await client.post(
        f"{base}/messages", headers=owner[0], data={"content": "Hello"}
    )
    assert response.status_code == 201, response.text
    assert (await client.get(base, headers=owner[0])).json()["unread"] is False

    response = await client.patch(base, headers=owner[0], json={"name": "Renamed"})
    assert response.json()["unread"] is False


async def test_pin_round_trips_without_touching_name_unread_or_recency(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    base = f"/api/v1/channels/{channel_state.channel.id}"
    before = (await client.get(base, headers=owner[0])).json()
    assert before["unread"] is True
    assert before["pinned_at"] is None

    pinned = (await client.patch(base, headers=owner[0], json={"pinned": True})).json()
    assert pinned["pinned_at"] is not None
    assert pinned["unread"] is True
    assert pinned["name"] == before["name"]
    assert pinned["updated_at"] == before["updated_at"]
    repinned = await client.patch(base, headers=owner[0], json={"pinned": True})
    assert repinned.json()["pinned_at"] == pinned["pinned_at"]

    renamed = await client.patch(base, headers=owner[0], json={"name": "Renamed"})
    assert renamed.json()["name"] == "Renamed"
    assert renamed.json()["pinned_at"] == pinned["pinned_at"]

    await client.post(f"{base}/viewed", headers=owner[0])
    read = (await client.get(base, headers=owner[0])).json()
    unpinned = await client.patch(base, headers=owner[0], json={"pinned": False})
    assert unpinned.json()["pinned_at"] is None
    assert unpinned.json()["unread"] is False
    assert unpinned.json()["updated_at"] == read["updated_at"]
    pinned_read = await client.patch(base, headers=owner[0], json={"pinned": True})
    assert pinned_read.json()["unread"] is False


async def test_channel_list_is_scoped_to_user_and_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_data: dict[str, Any],
    tmp_path: Path,
) -> None:
    headers, user, workspace = owner
    second_workspace = Workspace(
        name="Second workspace",
        user_id=user.id,
        sandbox_id="second-sandbox",
        sandbox_provider="host",
        workspace_path=str(tmp_path / "second"),
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
        device_ids=frozenset(),
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


async def test_member_elicitation_response_allows_only_the_owner(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    calls: list[tuple[str, str, str]] = []

    def resolve_elicitation(
        chat_id: str, request_id: str, *, action: str, content: Any
    ) -> bool:
        calls.append((chat_id, request_id, action))
        return request_id == "elicit-1"

    monkeypatch.setattr(
        chat_endpoint.session_registry, "resolve_elicitation", resolve_elicitation
    )
    chat_id = channel_state.channel.members[0].chat_id
    path = f"/api/v1/chat/chats/{chat_id}/elicitation/elicit-1/respond"
    body = {"request_id": "elicit-1", "action": "decline", "content": None}
    response = await client.post(path, headers=owner[0], json=body)
    assert response.status_code == 200
    assert response.json() == {"success": True}
    response = await client.post(path, headers=other_owner[0], json=body)
    assert response.status_code == 404
    assert calls == [(str(chat_id), "elicit-1", "decline")]


async def test_member_context_usage_is_readable_only_by_the_owner(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    monkeypatch.setattr(chat_endpoint, "cache_connection", EndpointCache().connect)
    chat_id = channel_state.channel.members[0].chat_id
    await db_session.execute(
        update(Chat).where(Chat.id == chat_id).values(context_token_usage=1234)
    )
    await db_session.commit()
    path = f"/api/v1/chat/chats/{chat_id}/context-usage"
    response = await client.get(path, headers=owner[0])
    assert response.status_code == 200
    assert response.json()["tokens_used"] == 1234
    response = await client.get(path, headers=other_owner[0])
    assert response.status_code == 404


async def test_normal_chat_routes_hide_member_chats(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    source_message: Message,
) -> None:
    base = f"/api/v1/chat/chats/{channel_state.channel.members[0].chat_id}"
    response = await client.get(base, headers=owner[0])
    assert response.status_code == 200
    assert response.json()["channel_id"] == str(channel_state.channel.id)
    for method, path, kwargs, expected_status in [
        ("GET", f"{base}/messages", {}, 403),
        ("GET", f"/api/v1/chat/messages/{source_message.id}/events", {}, 404),
        ("PATCH", base, {"json": {"title": "Renamed"}}, 404),
        ("DELETE", base, {}, 404),
        ("DELETE", f"{base}/stream", {}, 404),
        ("POST", f"{base}/queue", {"data": {"content": "hi"}}, 404),
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


async def search_messages(
    client: AsyncClient, headers: dict[str, str], q: str
) -> dict[str, Any]:
    response = await client.get(
        "/api/v1/chat/chats/search", headers=headers, params={"q": q}
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_message_search_returns_own_live_channel_messages(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    other_owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    headers, user, workspace = owner
    member = channel_state.channel.members[0]
    chat = Chat(title="Plain", user_id=user.id, workspace_id=workspace.id)
    db_session.add(chat)
    await db_session.commit()
    for content in ("chat 100%_needle", "chat 100xxneedle"):
        message = await create_source_message(db_session, chat.id)
        message.content_text = content
    await db_session.commit()
    post = await channel_service.new_message(
        channel_state, "owner 100%_needle", device_ids=frozenset()
    )
    reply = await channel_service.new_message(
        channel_state, "member 100%_needle", member.id, device_ids=frozenset()
    )
    await channel_service.new_message(
        channel_state, "wildcard 100xxneedle", member.id, device_ids=frozenset()
    )
    silent = await channel_service.new_message(
        channel_state, "silent 100%_needle", member.id, device_ids=frozenset()
    )
    await db_session.execute(
        update(ChannelMessage)
        .where(ChannelMessage.id == silent.id)
        .values(status="deleted")
    )
    await db_session.commit()

    body = await search_messages(client, headers, "100%_needle")
    assert [item["chat_id"] for item in body["results"]] == [str(chat.id)]
    assert body["results"][0]["match_count"] == 1
    assert body["results"][0]["matches"][0]["snippet_match"] == "100%_needle"
    assert body["truncated"] is False
    assert body["channel_truncated"] is False
    [result] = body["channel_results"]
    assert result["channel_id"] == str(channel_state.channel.id)
    assert result["channel_name"] == "Review"
    assert result["workspace_name"] == workspace.name
    assert result["match_count"] == 2
    assert [
        (match["message_id"], match["author"], match["snippet_match"])
        for match in result["matches"]
    ] == [
        (str(reply.id), member.display_name, "100%_needle"),
        (str(post.id), None, "100%_needle"),
    ]
    body = await search_messages(client, headers, "needle")
    assert body["channel_results"][0]["match_count"] == 3
    response = await client.get(
        "/api/v1/chat/chats/search",
        headers=headers,
        params={"q": "100%_needle", "per_chat_limit": 1},
    )
    assert (response.json()["truncated"], response.json()["channel_truncated"]) == (
        False,
        True,
    )
    body = await search_messages(client, other_owner[0], "needle")
    assert body["channel_results"] == []

    response = await client.delete(
        f"/api/v1/channels/{channel_state.channel.id}", headers=headers
    )
    assert response.status_code == 204
    body = await search_messages(client, headers, "needle")
    assert body["channel_results"] == []
    assert [item["chat_id"] for item in body["results"]] == [str(chat.id)]


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
        ([{"display_name": "Everyone"}], 422),
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
        "reserved-name",
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


async def user_messages(channel_state: ChannelState) -> list[str]:
    return [
        message.content
        for message in await channel_service.messages(channel_state.channel, 0)
        if message.member_id is None
    ]


async def test_queued_message_can_be_edited_deleted_and_sent_now(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_queue: EndpointCache,
) -> None:
    base = f"/api/v1/channels/{channel_state.channel.id}/queue"
    kept = await client.post(base, headers=owner[0], data={"content": "Later"})
    dropped = await client.post(base, headers=owner[0], data={"content": "Drop"})
    assert kept.status_code == dropped.status_code == 201
    kept_id, dropped_id = kept.json()["id"], dropped.json()["id"]
    missing = uuid4()

    edited = await client.patch(
        f"{base}/{kept_id}", headers=owner[0], json={"content": "Edited"}
    )
    assert edited.status_code == 200
    assert edited.json()["content"] == "Edited"
    deleted = await client.delete(f"{base}/{dropped_id}", headers=owner[0])
    assert deleted.status_code == 204
    for method, path, kwargs in [
        ("PATCH", f"{base}/{missing}", {"json": {"content": "x"}}),
        ("DELETE", f"{base}/{missing}", {}),
        ("POST", f"{base}/{missing}/send-now", {}),
    ]:
        response = await client.request(method, path, headers=owner[0], **kwargs)
        assert response.status_code == 404, (method, path)
    queued = await client.get(base, headers=owner[0])
    assert [item["content"] for item in queued.json()] == ["Edited"]
    assert await user_messages(channel_state) == []

    sent = await client.post(f"{base}/{kept_id}/send-now", headers=owner[0])

    assert sent.status_code == 204
    assert (await client.get(base, headers=owner[0])).json() == []
    assert await user_messages(channel_state) == ["Edited"]


async def test_message_queued_on_an_idle_channel_is_sent_immediately(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    channel_queue: EndpointCache,
) -> None:
    channel_state.paused = False
    base = f"/api/v1/channels/{channel_state.channel.id}/queue"

    queued = await client.post(base, headers=owner[0], data={"content": "Go"})

    assert queued.status_code == 201
    assert (await client.get(base, headers=owner[0])).json() == []
    assert await user_messages(channel_state) == ["Go"]
    assert (
        channel_state.channel.id,
        "channel_queue_sent",
        {"id": queued.json()["id"]},
    ) in (channel_runtime.publications)


AUTOMATION_POST = "[Automation: Digest]\nReview yesterday's changes"


async def add_channel_automation(
    db_session: AsyncSession, channel: Channel, **overrides: Any
) -> Automation:
    values: dict[str, Any] = {
        "name": "Digest",
        "prompt": "Review yesterday's changes",
        "model_id": TEST_MODEL_ID,
        "cron_expression": "0 9 * * *",
        "next_run_at": datetime.now(timezone.utc) - timedelta(minutes=1),
        **overrides,
    }
    automation = Automation(
        user_id=channel.user_id,
        workspace_id=channel.workspace_id,
        channel_id=channel.id,
        **values,
    )
    db_session.add(automation)
    await db_session.commit()
    await db_session.refresh(automation)
    return automation


def automation_service() -> AutomationService:
    return AutomationService(ChatService(UserService()))


async def standalone_chats(db_session: AsyncSession) -> list[Chat]:
    return list(
        (await db_session.scalars(select(Chat).where(Chat.channel_id.is_(None)))).all()
    )


async def test_automation_posts_its_prompt_into_an_idle_channel_and_wakes_members(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    channel_queue: EndpointCache,
) -> None:
    channel_state.paused = False
    channel_id = str(channel_state.channel.id)
    created = await client.post(
        "/api/v1/automations",
        headers=owner[0],
        json={
            "name": "Digest",
            "prompt": "Review yesterday's changes",
            "model_id": TEST_MODEL_ID,
            "cron_expression": "0 9 * * *",
            "workspace_id": str(owner[2].id),
            "channel_id": channel_id,
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["channel_id"] == channel_id

    ran = await client.post(
        f"/api/v1/automations/{created.json()['id']}/run", headers=owner[0]
    )

    assert ran.status_code == 200, ran.text
    assert ran.json() == {"chat_id": None, "channel_id": channel_id}
    assert await user_messages(channel_state) == [AUTOMATION_POST]
    assert channel_state.timer is not None
    await channel_runtime.wake(channel_state)
    [request] = channel_runtime.requests
    assert AUTOMATION_POST in request.prompt
    assert await standalone_chats(db_session) == []


async def test_busy_channel_queues_one_run_per_automation_until_idle(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
    channel_queue: EndpointCache,
) -> None:
    automation = await add_channel_automation(db_session, channel_state.channel)
    await channel_service.new_message(
        channel_state, "Start reviewing", device_ids=frozenset()
    )
    channel_runtime.gate = asyncio.Event()
    turn = asyncio.create_task(channel_runtime.wake(channel_state))
    await asyncio.wait_for(channel_runtime.emitted.wait(), timeout=5)
    channel_state.paused = False
    run_path = f"/api/v1/automations/{automation.id}/run"
    queue_path = f"/api/v1/channels/{channel_state.channel.id}/queue"

    _, ran = await asyncio.gather(
        automation_service().run_due_automations(),
        client.post(run_path, headers=owner[0]),
    )
    again = await client.post(run_path, headers=owner[0])

    assert ran.status_code == again.status_code == 200
    queued = (await client.get(queue_path, headers=owner[0])).json()
    assert [item["content"] for item in queued] == [AUTOMATION_POST]
    assert await user_messages(channel_state) == ["Start reviewing"]
    channel_runtime.gate.set()
    await turn
    channel_state.paused = False
    await channel_service.dispatch_queued(channel_state.channel)
    assert await user_messages(channel_state) == ["Start reviewing", AUTOMATION_POST]
    assert (await client.get(queue_path, headers=owner[0])).json() == []
    assert await standalone_chats(db_session) == []


async def test_deleted_target_channel_disables_the_automation_without_a_chat(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_queue: EndpointCache,
) -> None:
    automation = await add_channel_automation(db_session, channel_state.channel)
    deleted = await client.delete(
        f"/api/v1/channels/{channel_state.channel.id}", headers=owner[0]
    )
    assert deleted.status_code == 204

    ran = await client.post(
        f"/api/v1/automations/{automation.id}/run", headers=owner[0]
    )
    assert ran.status_code == 404
    assert ran.json()["detail"] == "Target channel not found in this workspace"
    await automation_service().run_due_automations()

    await db_session.refresh(automation)
    assert automation.enabled is False
    assert automation.channel_id == channel_state.channel.id
    assert (await db_session.scalars(select(Chat))).all() == []


async def test_retired_model_does_not_disable_a_channel_automation(
    db_session: AsyncSession,
    channel_state: ChannelState,
    channel_queue: EndpointCache,
) -> None:
    channel_state.paused = False
    automation = await add_channel_automation(
        db_session, channel_state.channel, model_id="antigravity:gemini-3.1-pro"
    )

    await automation_service().run_due_automations()

    await db_session.refresh(automation)
    assert automation.enabled is True
    assert await user_messages(channel_state) == [AUTOMATION_POST]


async def test_automation_from_a_revoked_device_does_not_post(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_queue: EndpointCache,
) -> None:
    channel_state.paused = False
    device = PairedDevice(
        user_id=channel_state.channel.user_id,
        name="Laptop",
        revoked_at=datetime.now(timezone.utc),
    )
    db_session.add(device)
    await db_session.commit()
    automation = await add_channel_automation(
        db_session, channel_state.channel, device_ids=frozenset({device.id})
    )

    await automation_service().run_due_automations()
    ran = await client.post(
        f"/api/v1/automations/{automation.id}/run", headers=owner[0]
    )

    assert ran.status_code == 403
    assert await user_messages(channel_state) == []
    queue = await client.get(
        f"/api/v1/channels/{channel_state.channel.id}/queue", headers=owner[0]
    )
    assert queue.json() == []


async def complete(db_session: AsyncSession, message: ChannelMessage) -> None:
    await db_session.execute(
        update(ChannelMessage)
        .where(ChannelMessage.id == message.id)
        .values(status="completed")
    )
    await db_session.commit()


async def test_members_are_added_edited_and_removed_keeping_their_history(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    owner: tuple[dict[str, str], User, Workspace],
    channel_data: dict[str, Any],
    channel_runtime: ScriptedTurns,
    db_session: AsyncSession,
) -> None:
    monkeypatch.setattr(channel_module, "NEWCOMER_HISTORY", 3)
    channel_data["members"] = [{"model_id": TEST_MODEL_ID, "display_name": "alpha"}]
    created = await client.post("/api/v1/channels", json=channel_data, headers=owner[0])
    assert created.status_code == 201, created.text
    state = channel_service.states[UUID(created.json()["id"])]
    state.paused = True
    [alpha] = state.channel.members
    base = f"/api/v1/channels/{state.channel.id}"
    for text in ("Old question", "Second question"):
        await channel_service.new_message(state, text, device_ids=frozenset())
    channel_runtime.events = [("assistant_text", {"text": "Alpha answer"})]
    await channel_runtime.wake(state)
    assert alpha.introduced
    await channel_service.new_message(state, "@alpha follow up", device_ids=frozenset())

    added = await client.post(
        f"{base}/members",
        json={"model_id": TEST_MODEL_ID, "display_name": "beta"},
        headers=owner[0],
    )
    assert added.status_code == 201, added.text
    assert [m["display_name"] for m in added.json()["members"]] == ["alpha", "beta"]
    assert added.json()["former_members"] == []
    beta = state.channel.members[1]
    assert not alpha.introduced
    assert channel_runtime.requests[1:] == []

    await channel_service.new_message(state, "Hello everyone", device_ids=frozenset())
    channel_runtime.events = [("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(state)
    prompts = {request.chat_id: request.prompt for request in channel_runtime.requests}
    assert prompts[alpha.chat_id].startswith(
        "You are alpha, a member of a group chat channel with the user and beta."
    )
    assert prompts[beta.chat_id].endswith(
        "[user]: Second question\n"
        "[alpha]: Alpha answer\n"
        "[user → @alpha]: @alpha follow up\n"
        "[user]: Hello everyone"
    )
    assert "Old question" not in prompts[beta.chat_id]

    claude_model = next(
        model_id
        for model_id, model in MODELS.items()
        if model.agent_kind is AgentKind.CLAUDE
    )
    edited = await client.patch(
        f"{base}/members/{beta.id}",
        json={"display_name": "gamma", "model_id": claude_model, "persona": "Critic"},
        headers=owner[0],
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["members"][1] | {"id": None, "chat_id": None} == {
        "id": None,
        "chat_id": None,
        "display_name": "gamma",
        "model_id": claude_model,
        "permission_mode": "default",
        "persona": "Critic",
        "thinking_mode": None,
    }
    assert (beta.display_name, beta.permission_mode) == ("gamma", "default")
    invalid = await client.patch(
        f"{base}/members/{beta.id}",
        json={"permission_mode": "build"},
        headers=owner[0],
    )
    assert invalid.status_code == 400, invalid.text

    await channel_service.new_message(state, "@alpha last call", device_ids=frozenset())
    await complete(
        db_session,
        await channel_service.new_message(
            state, "Alpha final", alpha.id, device_ids=frozenset()
        ),
    )
    anchor_chat_id = created.json()["anchor_chat_id"]
    removed = await client.delete(f"{base}/members/{alpha.id}", headers=owner[0])
    assert removed.status_code == 200, removed.text
    body = removed.json()
    assert [m["display_name"] for m in body["members"]] == ["gamma"]
    assert [m["display_name"] for m in body["former_members"]] == ["alpha"]
    assert body["anchor_chat_id"] == anchor_chat_id
    assert await db_session.get(Chat, alpha.chat_id) is not None
    removed_row = await db_session.get(ChannelMember, alpha.id)
    assert removed_row is not None and removed_row.removed_at is not None
    messages = (await client.get(f"{base}/messages", headers=owner[0])).json()
    assert [m["content"] for m in messages if m["member_id"] == str(alpha.id)] == [
        "Alpha answer",
        "Alpha final",
    ]

    duplicate = await client.post(
        f"{base}/members",
        json={"model_id": TEST_MODEL_ID, "display_name": "Alpha"},
        headers=owner[0],
    )
    assert duplicate.status_code == 400, duplicate.text
    last = await client.delete(f"{base}/members/{beta.id}", headers=owner[0])
    assert last.status_code == 400, last.text
    gone = await client.patch(
        f"{base}/members/{alpha.id}", json={"persona": None}, headers=owner[0]
    )
    assert gone.status_code == 404, gone.text

    mention = await channel_service.new_message(
        state, "@alpha are you there?", device_ids=frozenset()
    )
    assert mention.audience is None
    channel_runtime.requests.clear()
    channel_runtime.events = [("assistant_text", {"text": "Alpha left"})]
    await channel_runtime.wake(state)
    [request] = channel_runtime.requests
    assert request.chat_id == beta.chat_id
    assert request.prompt.startswith(
        "You are gamma, a member of a group chat channel with the user and no other agents."
    )
    assert request.prompt.endswith(
        "[user → @alpha]: @alpha last call\n"
        "[alpha]: Alpha final\n"
        "[user]: @alpha are you there?"
    )

    channel_service.states.clear()
    await channel_service.recover()
    recovered = channel_service.states[state.channel.id]
    recovered.paused = True
    assert [m.display_name for m in recovered.channel.members] == ["gamma"]
    reread = (await client.get(base, headers=owner[0])).json()
    assert [m["display_name"] for m in reread["former_members"]] == ["alpha"]
    messages = (await client.get(f"{base}/messages", headers=owner[0])).json()
    assert [m["content"] for m in messages if m["member_id"] == str(alpha.id)] == [
        "Alpha answer",
        "Alpha final",
    ]
    assert channel_service.anchor_chat_id(recovered.channel) == UUID(anchor_chat_id)
    await channel_service.new_message(
        recovered, "After restart", device_ids=frozenset()
    )
    channel_runtime.requests.clear()
    channel_runtime.events = [("assistant_text", {"text": "PASS"})]
    await channel_runtime.wake(recovered)
    assert [r.chat_id for r in channel_runtime.requests] == [beta.chat_id]


async def test_member_changes_are_refused_while_its_turn_runs(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
    channel_runtime: ScriptedTurns,
) -> None:
    member = channel_state.channel.members[0]
    channel_state.gave_up[member.id] = "Gave up"
    path = f"/api/v1/channels/{channel_state.channel.id}/members/{member.id}"
    cleared = await client.patch(path, json={}, headers=owner[0])
    assert cleared.status_code == 200, cleared.text
    assert member.id not in channel_state.gave_up

    await channel_service.new_message(channel_state, "Question", device_ids=frozenset())
    channel_runtime.events = [("assistant_text", {"text": "Working"})]
    channel_runtime.gate = asyncio.Event()
    wake = asyncio.create_task(channel_runtime.wake(channel_state))
    await asyncio.wait_for(channel_runtime.emitted.wait(), timeout=5)
    for method, kwargs in (("PATCH", {"json": {"persona": None}}), ("DELETE", {})):
        response = await client.request(method, path, headers=owner[0], **kwargs)
        assert response.status_code == 409, (method, response.text)
        assert "busy" in response.json()["detail"]
    channel_runtime.gate.set()
    await wake
    response = await client.patch(path, json={"persona": None}, headers=owner[0])
    assert response.status_code == 200, response.text


async def test_member_changes_on_a_deleted_channel_are_not_found(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    channel_state.deleted = True
    base = f"/api/v1/channels/{channel_state.channel.id}/members"
    member_path = f"{base}/{channel_state.channel.members[0].id}"
    for method, path, kwargs in (
        ("POST", base, {"json": {"model_id": TEST_MODEL_ID}}),
        ("PATCH", member_path, {"json": {"persona": None}}),
        ("DELETE", member_path, {}),
    ):
        response = await client.request(method, path, headers=owner[0], **kwargs)
        assert response.status_code == 404, (method, response.text)
    assert len(channel_state.channel.all_members) == 1


async def test_turn_in_flight_does_not_mark_its_member_introduced_after_a_change(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    member = channel_state.channel.members[0]
    turn = MemberTurn(member, [], introducing=True)
    channel_state.turns[member.id] = turn
    added = await client.post(
        f"/api/v1/channels/{channel_state.channel.id}/members",
        json={"model_id": TEST_MODEL_ID},
        headers=owner[0],
    )
    assert added.status_code == 201, added.text
    await channel_service.handle_event(
        channel_state, turn, "assistant_thinking", {"text": "Hmm"}
    )
    assert not member.introduced
    row = await db_session.get(ChannelMember, member.id)
    assert row is not None and not row.introduced


async def test_introduction_acknowledged_during_a_change_stays_reset(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    member = channel_state.channel.members[0]
    turn = MemberTurn(member, [], introducing=True)
    channel_state.turns[member.id] = turn
    gate = asyncio.Event()
    factory = channel_service.session_factory
    calls: list[None] = []

    @asynccontextmanager
    async def gated() -> AsyncIterator[AsyncSession]:
        await gate.wait()
        async with factory() as db:
            yield db

    def session_factory() -> Any:
        if calls:
            return factory()
        calls.append(None)
        return gated()

    monkeypatch.setattr(channel_service, "session_factory", session_factory)
    acknowledged = asyncio.create_task(
        channel_service.handle_event(
            channel_state, turn, "assistant_thinking", {"text": "Hmm"}
        )
    )
    await asyncio.sleep(0)
    added = asyncio.create_task(
        client.post(
            f"/api/v1/channels/{channel_state.channel.id}/members",
            json={"model_id": TEST_MODEL_ID},
            headers=owner[0],
        )
    )
    await asyncio.wait({added}, timeout=0.5)
    gate.set()
    await acknowledged
    assert (await added).status_code == 201
    assert not member.introduced
    row = await db_session.get(ChannelMember, member.id)
    assert row is not None and not row.introduced


async def test_agent_tokens_cannot_change_members(
    client: AsyncClient,
    owner: tuple[dict[str, str], User, Workspace],
    channel_state: ChannelState,
) -> None:
    user = owner[1]
    token = create_mcp_access_token(str(user.id), user.hashed_password, frozenset())
    base = f"/api/v1/channels/{channel_state.channel.id}/members"
    member_path = f"{base}/{channel_state.channel.members[0].id}"
    for method, path, kwargs in (
        ("POST", base, {"json": {"model_id": TEST_MODEL_ID}}),
        ("PATCH", member_path, {"json": {"persona": None}}),
        ("DELETE", member_path, {}),
    ):
        response = await client.request(
            method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs
        )
        assert response.status_code == 403, (method, response.text)
