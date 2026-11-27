import json
import logging
from typing import Any, Literal, TypedDict
from uuid import UUID

from app.constants import REDIS_KEY_USER_CHATS_LIVE
from app.models.db_models.chat import Message
from app.utils.cache import CacheError, cache_connection

logger = logging.getLogger(__name__)


class ChatCreatedEvent(TypedDict):
    kind: Literal["chat_created"]
    chat: dict[str, Any]


class StreamStartedEvent(TypedDict):
    kind: Literal["stream_started"]
    chat_id: str
    parent_chat_id: str | None
    message_id: str
    user_message_id: str
    content: str
    app_notice: bool
    attachments: list[dict[str, Any]] | None
    model_id: str
    thinking_mode: str | None
    permission_mode: str
    selected_persona_name: str
    checkpoint_id: str | None


class TitleUpdatedEvent(TypedDict):
    kind: Literal["title_updated"]
    chat_id: str
    title: str


class ChannelCreatedEvent(TypedDict):
    kind: Literal["channel_created"]
    channel_id: str
    parent_chat_id: str | None


class ChannelRenamedEvent(TypedDict):
    kind: Literal["channel_renamed"]
    channel_id: str
    name: str


ChatEvent = (
    ChatCreatedEvent
    | StreamStartedEvent
    | TitleUpdatedEvent
    | ChannelCreatedEvent
    | ChannelRenamedEvent
)


class ChatEventPublisher:
    @staticmethod
    async def publish(user_id: UUID, event: ChatEvent) -> None:
        # Best-effort broadcast on the user's live channel — a missed event only
        # delays the sidebar/tab update until the next normal refetch.
        try:
            async with cache_connection() as cache:
                await cache.publish(
                    REDIS_KEY_USER_CHATS_LIVE.format(user_id=user_id),
                    json.dumps(event),
                )
        except CacheError:
            logger.warning("Failed to publish %s user chat event", event["kind"])

    @classmethod
    async def publish_stream_started(
        cls,
        user_id: UUID,
        user_message: Message,
        assistant_message: Message,
        checkpoint_id: UUID | None,
        *,
        content: str,
        app_notice: bool,
        attachments: list[dict[str, Any]] | None,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
        selected_persona_name: str,
        parent_chat_id: UUID | None,
    ) -> None:
        await cls.publish(
            user_id,
            {
                "kind": "stream_started",
                "chat_id": str(user_message.chat_id),
                "parent_chat_id": str(parent_chat_id) if parent_chat_id else None,
                "message_id": str(assistant_message.id),
                "user_message_id": str(user_message.id),
                "content": content,
                "app_notice": app_notice,
                "attachments": attachments,
                "model_id": model_id,
                "thinking_mode": thinking_mode,
                "permission_mode": permission_mode,
                "selected_persona_name": selected_persona_name,
                "checkpoint_id": str(checkpoint_id) if checkpoint_id else None,
            },
        )
