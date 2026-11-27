import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, get_args, get_type_hints
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageRole
from app.services import chat_events as chat_events_module
from app.services.agent import AgentService
from app.services.chat import ChatService
from app.services.chat_events import ChatEvent, ChatEventPublisher
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChatStreamRequest
from app.services.user import UserService
from app.utils.cache import cache_connection

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace

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


def event_of(kind: str) -> dict[str, Any]:
    return next(entry for entry in CHAT_EVENTS if entry["kind"] == kind)


async def title_from_fixture(*args: Any, **kwargs: Any) -> str:
    title: str = event_of("title_updated")["title"]
    return title


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> PublishedEvents:
    recorder = PublishedEvents()
    monkeypatch.setattr(chat_events_module, "cache_connection", recorder.connection)
    return recorder


async def test_announcing_a_chat_publishes_the_fixture_chat_created(
    published: PublishedEvents,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    entry = event_of("chat_created")
    chat = entry["chat"]
    owned = chat | {"user_id": str(user.id), "workspace_id": str(workspace.id)}

    async with SessionLocal() as db:
        await ChatService(
            UserService(), session_factory=SessionLocal
        )._commit_and_announce(
            db,
            Chat(
                id=UUID(chat["id"]),
                title=chat["title"],
                user_id=user.id,
                workspace_id=workspace.id,
                created_at=datetime.fromisoformat(chat["created_at"]),
                updated_at=datetime.fromisoformat(chat["updated_at"]),
                last_model_id=chat["last_model_id"],
            ),
        )

    assert published.raw == [json.dumps(entry | {"chat": owned})]


async def test_starting_a_turn_publishes_the_fixture_stream_started(
    published: PublishedEvents,
) -> None:
    entries = [entry for entry in CHAT_EVENTS if entry["kind"] == "stream_started"]

    for entry in entries:
        chat_id = UUID(entry["chat_id"])
        await ChatEventPublisher.publish_stream_started(
            uuid4(),
            Message(
                id=UUID(entry["user_message_id"]),
                chat_id=chat_id,
                role=MessageRole.USER,
            ),
            Message(
                id=UUID(entry["message_id"]),
                chat_id=chat_id,
                role=MessageRole.ASSISTANT,
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

    assert published.raw == [json.dumps(entry) for entry in entries]


async def test_titling_a_new_chat_publishes_the_fixture_title_updated(
    published: PublishedEvents, monkeypatch: pytest.MonkeyPatch
) -> None:
    entry = event_of("title_updated")
    monkeypatch.setattr(AgentService, "generate_title", title_from_fixture)
    request = ChatStreamRequest(
        device_ids=frozenset(),
        prompt="Name this chat",
        system_prompt="",
        custom_instructions=None,
        chat_data={
            "id": entry["chat_id"],
            "user_id": str(uuid4()),
            "title": "New chat",
            "workspace_id": str(uuid4()),
            "sandbox_id": "sandbox-testuser",
            "sandbox_provider": "host",
        },
        model_id="sonnet",
        permission_mode="default",
        session_id=None,
        assistant_message_id=str(uuid4()),
        thinking_mode=None,
        attachments=None,
    )

    async with cache_connection() as cache:
        runtime = ChatStreamRuntime(
            request=request, session_factory=SessionLocal, cache=cache
        )
        await runtime._generate_title()

    assert published.raw == [json.dumps(entry)]


def test_fixture_covers_every_chat_event_kind() -> None:
    assert {entry["kind"] for entry in CHAT_EVENTS} == EVENT_TYPES.keys()
