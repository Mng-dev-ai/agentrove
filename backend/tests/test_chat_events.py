import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, get_args, get_type_hints
from uuid import UUID, uuid4

import pytest
from pydantic import TypeAdapter

from app.models.db_models.chat import Message
from app.models.db_models.enums import MessageRole
from app.models.schemas.chat import Chat as ChatSchema
from app.services import chat_events as chat_events_module
from app.services.chat_events import ChatEvent, ChatEventPublisher

pytestmark = pytest.mark.anyio

# The frontend's Vitest holds its ChatEvent union to the same file.
CHAT_EVENTS: list[dict[str, Any]] = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "test"
        / "chatEvents.json"
    ).read_text()
)
EVENT_TYPES = {
    get_args(get_type_hints(event_type)["kind"])[0]: event_type
    for event_type in get_args(ChatEvent)
}


class PublishedEvents:
    def __init__(self) -> None:
        self.raw: list[str] = []

    async def publish(self, channel: str, data: str) -> None:
        self.raw.append(data)

    @asynccontextmanager
    async def connection(self) -> AsyncIterator["PublishedEvents"]:
        yield self


async def publish_fixture_event(entry: dict[str, Any]) -> None:
    if entry["kind"] != "stream_started":
        event = TypeAdapter(EVENT_TYPES[entry["kind"]]).validate_python(entry)
        await ChatEventPublisher.publish(uuid4(), event)
        return
    chat_id = UUID(entry["chat_id"])
    await ChatEventPublisher.publish_stream_started(
        uuid4(),
        Message(
            id=UUID(entry["user_message_id"]), chat_id=chat_id, role=MessageRole.USER
        ),
        Message(
            id=UUID(entry["message_id"]), chat_id=chat_id, role=MessageRole.ASSISTANT
        ),
        UUID(entry["checkpoint_id"]) if entry["checkpoint_id"] else None,
        content=entry["content"],
        app_notice=entry["app_notice"],
        attachments=entry["attachments"],
        model_id=entry["model_id"],
        thinking_mode=entry["thinking_mode"],
        permission_mode=entry["permission_mode"],
        selected_persona_name=entry["selected_persona_name"],
        parent_chat_id=(
            UUID(entry["parent_chat_id"]) if entry["parent_chat_id"] else None
        ),
    )


async def test_fixture_events_are_what_the_backend_publishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    published = PublishedEvents()
    monkeypatch.setattr(chat_events_module, "cache_connection", published.connection)

    for entry in CHAT_EVENTS:
        await publish_fixture_event(entry)

    assert published.raw == [json.dumps(entry) for entry in CHAT_EVENTS]


def test_fixture_chats_are_chat_schema_dumps() -> None:
    chats = [entry["chat"] for entry in CHAT_EVENTS if entry["kind"] == "chat_created"]
    assert chats
    for chat in chats:
        dumped = ChatSchema.model_validate(chat).model_dump(mode="json")
        assert json.dumps(dumped) == json.dumps(chat)


def test_fixture_covers_every_chat_event_kind() -> None:
    assert {entry["kind"] for entry in CHAT_EVENTS} == EVENT_TYPES.keys()
