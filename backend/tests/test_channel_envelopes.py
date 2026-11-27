import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, get_args
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.channel import Channel, ChannelMember, ChannelMessage
from app.services.channels import publisher as publisher_module
from app.services.channels import state as state_module
from app.services.channels.engine import channel_engine
from app.services.channels.publisher import ChannelEnvelopeKind
from app.services.channels.state import ChannelState, MemberTurn
from app.services.push import PushService
from app.services.queue import ChannelQueueService
from app.utils.cache import cache_connection

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace

pytestmark = pytest.mark.anyio

# The frontend's Vitest holds its ChannelEnvelope union to the same file.
CHANNEL_ENVELOPES: list[dict[str, Any]] = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "test"
        / "channelEnvelopes.json"
    ).read_text()
)
ENVELOPE_KINDS = set(get_args(ChannelEnvelopeKind))
ACTIVITY_NOTICES = {"asked", "completed"}
MODEL_ID = "opencode:google-vertex/claude-sonnet-4-6@default"
UNLABELLED_OPTION = {
    "kind": "allow_once",
    "name": None,
    "option_id": None,
    "permission_mode": None,
}


class PublishedEnvelopes:
    def __init__(self) -> None:
        self.raw: list[str] = []

    async def publish(self, channel: str, data: str) -> None:
        self.raw.append(data)

    @asynccontextmanager
    async def connection(self) -> AsyncIterator["PublishedEnvelopes"]:
        yield self

    @staticmethod
    async def skip_push(*args: Any, **kwargs: Any) -> None:
        return None


def fixture_entry(kind: str, notice: str | None = None) -> dict[str, Any]:
    [match] = [
        entry
        for entry in CHANNEL_ENVELOPES
        if entry["kind"] == kind
        and ACTIVITY_NOTICES & entry["payload"].keys()
        == ({notice} if notice else set())
    ]
    return match


def fixture_payload(kind: str, notice: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = fixture_entry(kind, notice)["payload"]
    return payload


def fixture_state() -> tuple[ChannelState, ChannelMessage]:
    request = fixture_payload("channel_permission_request")
    message = dict(fixture_payload("channel_message")["message"])
    del message["author_type"]
    member = ChannelMember(
        id=UUID(request["member_id"]),
        chat_id=UUID(request["chat_id"]),
        model_id=MODEL_ID,
        display_name="claude-sonnet-4.6-google-vertex",
    )
    channel = Channel(
        id=UUID(message["channel_id"]),
        user_id=uuid4(),
        name="Review",
        all_members=[member],
    )
    channel_message = ChannelMessage(
        **(
            message
            | {
                "id": UUID(message["id"]),
                "channel_id": channel.id,
                "created_at": datetime.fromisoformat(message["created_at"]),
            }
        )
    )
    return ChannelState(channel=channel), channel_message


async def create_paused_channel(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> tuple[dict[str, str], ChannelState]:
    headers, _, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await client.post(
        "/api/v1/channels",
        json={
            "name": "Review",
            "workspace_id": str(workspace.id),
            "members": [{"model_id": MODEL_ID}],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    state = channel_engine.states[UUID(created.json()["id"])]
    state.paused = True
    return headers, state


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> PublishedEnvelopes:
    recorder = PublishedEnvelopes()
    monkeypatch.setattr(publisher_module, "cache_connection", recorder.connection)
    monkeypatch.setattr(PushService, "notify_permission", recorder.skip_push)
    monkeypatch.setattr(PushService, "notify_question", recorder.skip_push)
    monkeypatch.setattr(
        state_module,
        "ACTIVITY_EPOCH",
        fixture_payload("channel_member_activity")["epoch"],
    )
    return recorder


async def test_fixture_envelopes_are_what_the_channel_publishers_emit(
    published: PublishedEnvelopes,
) -> None:
    state, message = fixture_state()
    member = state.channel.members[0]
    turn = MemberTurn(member=member, batch=[])
    permission = fixture_payload("channel_permission_request")["request"]
    asked = fixture_payload("channel_member_activity", "asked")
    elicitation = dict(asked["elicitations"][0]["request"])
    request_id = elicitation.pop("request_id")
    plain = fixture_payload("channel_member_activity")

    await channel_engine.publisher.publish_message(state.channel, message)
    await channel_engine.requests.request_permission(
        state,
        turn,
        {
            "request_id": permission["request_id"],
            "tool_name": permission["tool_name"],
            "tool_input": permission["tool_input"],
            "data": {"options": permission["options"]},
        },
    )
    await channel_engine.requests.request_elicitation(
        state, turn, {"request_id": request_id, "data": elicitation}
    )
    await channel_engine.requests.resolve_permissions(
        state, member.id, permission["request_id"]
    )
    state.gave_up[member.id] = plain["unavailable_members"][str(member.id)]
    await channel_engine.publisher.publish_activity(state)
    state.elicitations.clear()
    state.last_reply = ("Reviewer", message)
    await channel_engine.settle(state)

    for entry in CHANNEL_ENVELOPES:
        if entry["kind"] != "channel_queue_sent":
            assert json.dumps(entry) in published.raw


def test_fixture_covers_every_envelope_kind_and_activity_notice() -> None:
    assert {entry["kind"] for entry in CHANNEL_ENVELOPES} == ENVELOPE_KINDS
    for notice in (None, *ACTIVITY_NOTICES):
        assert fixture_payload("channel_member_activity", notice)["elicitations"]


async def test_rest_catch_up_returns_the_fixture_payloads_unchanged(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, state = await create_paused_channel(client, db_session, create_user, login)
    request = fixture_payload("channel_permission_request")
    unlabelled = request | {
        "request": request["request"]
        | {"request_id": "perm-2", "options": [UNLABELLED_OPTION]}
    }
    activity = fixture_payload("channel_member_activity")
    monkeypatch.setattr(state_module, "ACTIVITY_EPOCH", activity["epoch"])
    for pending in (request, unlabelled):
        state.permissions[(uuid4(), pending["request"]["request_id"])] = pending
    state.activity_version = activity["version"]
    state.waiting_member_ids = activity["waiting_member_ids"]
    state.elicitation_requests = activity["elicitations"]
    state.gave_up_members = activity["unavailable_members"]
    base = f"/api/v1/channels/{state.channel.id}"

    permissions = await client.get(f"{base}/permissions", headers=headers)
    member_activity = await client.get(f"{base}/member-activity", headers=headers)

    assert permissions.text == json.dumps([request, unlabelled], separators=(",", ":"))
    assert member_activity.text == json.dumps(activity, separators=(",", ":"))


async def test_sending_a_queued_message_publishes_the_fixture_queue_sent(
    published: PublishedEnvelopes,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _, state = await create_paused_channel(client, db_session, create_user, login)
    entry = fixture_entry("channel_queue_sent")
    channel_id = str(state.channel.id)

    async with cache_connection() as cache:
        queue = ChannelQueueService(cache)
        await queue.requeue_message(
            channel_id,
            {
                "content": "Queued follow-up",
                "device_ids": [],
                "id": entry["payload"]["id"],
                "queued_at": datetime.now(timezone.utc).isoformat(),
                "attachments": None,
            },
        )
        await channel_engine.send_queued_now(
            state.channel, queue, UUID(entry["payload"]["id"]), frozenset()
        )

    assert json.dumps(entry | {"channelId": channel_id}) in published.raw
