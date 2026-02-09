import asyncio
import json
import logging
import math
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, cast
from uuid import UUID, uuid4

from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import selectinload

from app.constants import (
    REDIS_KEY_CHAT_CANCEL,
    REDIS_KEY_CHAT_REVOKED,
    REDIS_KEY_CHAT_STREAM_LIVE,
    REDIS_KEY_CHAT_TASK,
    STREAM_STATUS_CANCELLED,
)
from app.models.db_models import StreamEventKind
from app.core.config import get_settings
from app.models.db_models import (
    Chat,
    Message,
    MessageAttachment,
    MessageEvent,
    MessageRole,
    MessageStreamStatus,
    User,
    UserSettings,
)
from app.models.schemas import (
    ChatUpdate,
    CursorPaginatedMessages,
    PaginatedChats,
    PaginationParams,
    ProviderType,
)
from app.models.types import MessageAttachmentDict
from app.services.db import BaseDbService, SessionFactoryType
from app.services.provider import ProviderService
from app.services.claude_agent import ClaudeAgentService
from app.services.exceptions import ChatException, ErrorCode
from app.services.message import MessageService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import (
    LocalDockerProvider,
    SandboxProviderType,
    create_docker_config,
)
from app.services.storage import StorageService
from app.services.user import UserService
from app.tasks.chat import process_chat

if TYPE_CHECKING:
    from celery.result import AsyncResult
    from redis.asyncio import Redis
    from redis.asyncio.client import PubSub
from app.utils.redis import redis_connection, redis_pubsub
from app.utils.attachment_urls import build_attachment_preview_url
from app.utils.validators import APIKeyValidationError, validate_model_api_keys

settings = get_settings()
logger = logging.getLogger(__name__)

CHAT_TITLE_MAX_LENGTH = 50
TERMINAL_STREAM_EVENT_TYPES = {"cancelled", "complete", "error"}


class ChatService(BaseDbService[Chat]):
    def __init__(
        self,
        storage_service: StorageService,
        sandbox_service: SandboxService,
        ai_service: ClaudeAgentService,
        user_service: UserService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self.sandbox_service = sandbox_service
        self.ai_service = ai_service
        self.storage_service = storage_service
        self.user_service = user_service
        self.message_service = MessageService(session_factory=self._session_factory)
        self._provider_service = ProviderService()

    @property
    def session_factory(self) -> SessionFactoryType:
        return self._session_factory

    @session_factory.setter
    def session_factory(self, value: SessionFactoryType) -> None:
        self._session_factory = value
        self.message_service.session_factory = value

    async def get_user_chats(
        self, user: User, pagination: PaginationParams | None = None
    ) -> PaginatedChats:
        if pagination is None:
            pagination = PaginationParams()

        async with self.session_factory() as db:
            count_query = select(func.count(Chat.id)).filter(
                Chat.user_id == user.id, Chat.deleted_at.is_(None)
            )
            count_result = await db.execute(count_query)
            total = count_result.scalar()

            offset = (pagination.page - 1) * pagination.per_page

            query = (
                select(Chat)
                .filter(Chat.user_id == user.id, Chat.deleted_at.is_(None))
                .order_by(Chat.pinned_at.desc().nulls_last(), Chat.updated_at.desc())
                .offset(offset)
                .limit(pagination.per_page)
            )
            result = await db.execute(query)
            chats = result.scalars().all()

            return PaginatedChats(
                items=chats,
                page=pagination.page,
                per_page=pagination.per_page,
                total=total,
                pages=math.ceil(total / pagination.per_page) if total > 0 else 0,
            )

    async def update_chat(
        self, chat_id: UUID, chat_update: ChatUpdate, user: User
    ) -> Chat:
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat).filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to update it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            if chat_update.title is not None:
                chat.title = self.truncate_title(chat_update.title)

            if chat_update.pinned is not None:
                chat.pinned_at = (
                    datetime.now(timezone.utc) if chat_update.pinned else None
                )

            chat.updated_at = datetime.now(timezone.utc)
            await db.commit()

            return chat

    async def get_chat(self, chat_id: UUID, user: User) -> Chat:
        async with self.session_factory() as db:
            query = (
                select(Chat)
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
                .options(
                    selectinload(
                        Chat.messages.and_(Message.deleted_at.is_(None))
                    ).selectinload(Message.attachments)
                )
            )
            result = await db.execute(query)
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to access it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            return chat

    async def delete_chat(self, chat_id: UUID, user: User) -> None:
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat).filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to delete it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            now = datetime.now(timezone.utc)
            chat.deleted_at = now

            messages_update = (
                update(Message)
                .where(Message.chat_id == chat_id, Message.deleted_at.is_(None))
                .values(deleted_at=now)
            )
            await db.execute(messages_update)

            await db.commit()

            if chat.sandbox_id:
                asyncio.create_task(
                    self.sandbox_service.delete_sandbox(chat.sandbox_id)
                )

    async def get_chat_sandbox_id(self, chat_id: UUID, user: User) -> str | None:
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat)
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
                .with_only_columns(Chat.sandbox_id)
            )
            row = result.one_or_none()

            if not row:
                raise ChatException(
                    "Chat not found or you don't have permission to access sandbox",
                    error_code=ErrorCode.CHAT_ACCESS_DENIED,
                    details={"chat_id": str(chat_id)},
                    status_code=403,
                )

            sandbox_id_value: str | None = row[0]
            return sandbox_id_value

    async def delete_all_chats(self, user: User) -> int:
        async with self.session_factory() as db:
            sandbox_query = select(Chat.sandbox_id).filter(
                Chat.user_id == user.id,
                Chat.sandbox_id.isnot(None),
                Chat.deleted_at.is_(None),
            )
            result = await db.execute(sandbox_query)
            sandbox_ids = [row[0] for row in result.fetchall()]

            now = datetime.now(timezone.utc)

            chats_update = (
                update(Chat)
                .where(Chat.user_id == user.id, Chat.deleted_at.is_(None))
                .values(deleted_at=now)
            )
            await db.execute(chats_update)

            messages_update = (
                update(Message)
                .where(
                    Message.chat_id.in_(
                        select(Chat.id).filter(Chat.user_id == user.id)
                    ),
                    Message.deleted_at.is_(None),
                )
                .values(deleted_at=now)
            )
            await db.execute(messages_update)

            await db.commit()

            for sandbox_id in sandbox_ids:
                asyncio.create_task(self.sandbox_service.delete_sandbox(sandbox_id))

            return len(sandbox_ids)

    async def get_chat_messages(
        self, chat_id: UUID, user: User, cursor: str | None = None, limit: int = 20
    ) -> CursorPaginatedMessages:
        has_access = await self._verify_chat_access(chat_id, user.id)
        if not has_access:
            raise ChatException(
                "Chat not found or you don't have permission to access messages",
                error_code=ErrorCode.CHAT_ACCESS_DENIED,
                details={"chat_id": str(chat_id)},
                status_code=403,
            )

        asyncio.create_task(self._resume_sandbox(chat_id, user))

        return await self.message_service.get_chat_messages(chat_id, cursor, limit)

    async def _monitor_stream_cancellation(
        self, chat_id: UUID, cancel_event: asyncio.Event, redis: "Redis[str]"
    ) -> None:
        try:
            async with redis_pubsub(
                redis, REDIS_KEY_CHAT_CANCEL.format(chat_id=chat_id)
            ) as pubsub:
                while True:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    )
                    if message and message.get("type") == "message":
                        logger.info("Stream cancellation received for chat %s", chat_id)
                        cancel_event.set()
                        break
        except asyncio.CancelledError:
            logger.debug("Cancellation monitor task cancelled for chat %s", chat_id)
            raise
        except Exception as exc:
            logger.error(
                "Error monitoring cancellation for chat %s: %s",
                chat_id,
                exc,
                exc_info=True,
            )

    async def _replay_stream_backlog(
        self,
        chat_id: UUID,
        after_seq: int,
    ) -> AsyncIterator[dict[str, Any]]:
        page_size = 5000
        cursor = after_seq

        while True:
            backlog = await self.message_service.get_chat_events_after_seq(
                chat_id=chat_id,
                after_seq=cursor,
                limit=page_size,
            )
            if not backlog:
                return

            for event in backlog:
                envelope = {
                    "chatId": str(event.chat_id),
                    "messageId": str(event.message_id),
                    "streamId": str(event.stream_id),
                    "seq": event.seq,
                    "kind": event.event_type,
                    "payload": event.render_payload,
                    "ts": event.created_at.isoformat() if event.created_at else None,
                }
                yield {
                    "id": str(event.seq),
                    "event": StreamEventKind.STREAM.value,
                    "data": json.dumps(envelope, ensure_ascii=False),
                }

            next_cursor = int(backlog[-1].seq)
            if next_cursor <= cursor:
                logger.warning(
                    "Non-increasing backlog seq for chat %s (cursor=%s, next=%s)",
                    chat_id,
                    cursor,
                    next_cursor,
                )
                return
            cursor = next_cursor

            if len(backlog) < page_size:
                return

    async def _resolve_active_cancel_targets(
        self,
        *,
        chat_id: UUID,
        fallback_stream_id: UUID | None,
        fallback_message_id: UUID | None,
    ) -> tuple[UUID | None, UUID | None]:
        try:
            latest_assistant_message = (
                await self.message_service.get_latest_assistant_message(chat_id)
            )
            if (
                latest_assistant_message
                and latest_assistant_message.stream_status
                == MessageStreamStatus.IN_PROGRESS
                and latest_assistant_message.active_stream_id
            ):
                return (
                    latest_assistant_message.active_stream_id,
                    latest_assistant_message.id,
                )
        except Exception as exc:
            logger.debug(
                "Failed to resolve active stream for cancellation in chat %s: %s",
                chat_id,
                exc,
            )
        return fallback_stream_id, fallback_message_id

    @staticmethod
    def _to_stream_sse_event(event: MessageEvent) -> dict[str, Any]:
        return ChatService._build_stream_sse_event(
            chat_id=event.chat_id,
            message_id=event.message_id,
            stream_id=event.stream_id,
            seq=int(event.seq),
            kind=event.event_type,
            payload=event.render_payload,
            ts=event.created_at.isoformat() if event.created_at else None,
        )

    @staticmethod
    def _build_stream_sse_event(
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        seq: int,
        kind: str,
        payload: dict[str, Any],
        ts: str | None = None,
    ) -> dict[str, Any]:
        envelope = {
            "chatId": str(chat_id),
            "messageId": str(message_id),
            "streamId": str(stream_id),
            "seq": seq,
            "kind": kind,
            "payload": payload,
            "ts": ts or datetime.now(timezone.utc).isoformat(),
        }
        return {
            "id": str(seq),
            "event": StreamEventKind.STREAM.value,
            "data": json.dumps(envelope, ensure_ascii=False),
        }

    async def _wait_for_stream_terminal_event(
        self,
        *,
        chat_id: UUID,
        stream_id: UUID,
        attempts: int = 20,
        delay_seconds: float = 0.05,
    ) -> MessageEvent | None:
        for attempt in range(attempts):
            latest_event = await self.message_service.get_latest_stream_event(
                chat_id=chat_id,
                stream_id=stream_id,
            )
            if latest_event and latest_event.event_type in {
                "cancelled",
                "complete",
                "error",
            }:
                return latest_event
            if attempt < attempts - 1:
                await asyncio.sleep(delay_seconds)
        return None

    async def _drain_events_until_terminal(
        self,
        *,
        chat_id: UUID,
        after_seq: int,
        attempts: int = 20,
        delay_seconds: float = 0.05,
    ) -> tuple[list[dict[str, Any]], int, bool]:
        cursor = after_seq
        drained_events: list[dict[str, Any]] = []

        for attempt in range(attempts):
            live_events = await self.message_service.get_chat_events_after_seq(
                chat_id=chat_id,
                after_seq=cursor,
                limit=5000,
            )
            if live_events:
                found_terminal = False
                for event in live_events:
                    drained_events.append(self._to_stream_sse_event(event))
                    cursor = max(cursor, int(event.seq))
                    if event.event_type in TERMINAL_STREAM_EVENT_TYPES:
                        found_terminal = True
                if found_terminal:
                    return drained_events, cursor, True

            if attempt < attempts - 1:
                await asyncio.sleep(delay_seconds)

        return drained_events, cursor, False

    async def _build_forced_cancelled_stream_event(
        self,
        *,
        chat_id: UUID,
        stream_id: UUID | None,
        message_id: UUID | None,
        fallback_seq: int,
    ) -> dict[str, Any] | None:
        if message_id is None:
            latest_assistant = await self.message_service.get_latest_assistant_message(
                chat_id
            )
            if latest_assistant is None:
                return None
            message_id = latest_assistant.id

        resolved_stream_id = stream_id or uuid4()
        payload = {"status": STREAM_STATUS_CANCELLED}

        try:
            cancelled_seq = await self.message_service.append_event_with_next_seq(
                chat_id=chat_id,
                message_id=message_id,
                stream_id=resolved_stream_id,
                event_type="cancelled",
                render_payload=payload,
                audit_payload={"payload": payload},
            )
        except Exception as exc:
            logger.warning(
                "Failed to persist forced cancelled event for chat %s: %s",
                chat_id,
                exc,
            )
            cancelled_seq = max(int(fallback_seq), 0) + 1

        return self._build_stream_sse_event(
            chat_id=chat_id,
            message_id=message_id,
            stream_id=resolved_stream_id,
            seq=cancelled_seq,
            kind="cancelled",
            payload=payload,
        )

    async def _build_stream_error_event(
        self,
        *,
        chat_id: UUID,
        message_id: UUID | None,
        stream_id: UUID | None,
        fallback_seq: int,
        error_message: str,
    ) -> dict[str, Any]:
        payload = {"error": error_message}
        resolved_message_id = message_id
        resolved_stream_id = stream_id

        if resolved_message_id is None:
            latest_assistant = await self.message_service.get_latest_assistant_message(
                chat_id
            )
            if latest_assistant is not None:
                resolved_message_id = latest_assistant.id
                if resolved_stream_id is None:
                    resolved_stream_id = latest_assistant.active_stream_id

        if resolved_message_id is None:
            synthetic_message_id = uuid4()
            synthetic_stream_id = resolved_stream_id or uuid4()
            synthetic_seq = max(int(fallback_seq), 0) + 1
            return self._build_stream_sse_event(
                chat_id=chat_id,
                message_id=synthetic_message_id,
                stream_id=synthetic_stream_id,
                seq=synthetic_seq,
                kind="error",
                payload=payload,
            )

        if resolved_stream_id is None:
            resolved_stream_id = uuid4()

        try:
            error_seq = await self.message_service.append_event_with_next_seq(
                chat_id=chat_id,
                message_id=resolved_message_id,
                stream_id=resolved_stream_id,
                event_type="error",
                render_payload=payload,
                audit_payload={"payload": payload},
            )
        except Exception as exc:
            logger.warning(
                "Failed to persist stream error event for chat %s: %s",
                chat_id,
                exc,
            )
            error_seq = max(int(fallback_seq), 0) + 1

        return self._build_stream_sse_event(
            chat_id=chat_id,
            message_id=resolved_message_id,
            stream_id=resolved_stream_id,
            seq=error_seq,
            kind="error",
            payload=payload,
        )

    async def _build_cancelled_stream_event(
        self,
        *,
        chat_id: UUID,
        stream_id: UUID | None,
        message_id: UUID | None,
    ) -> dict[str, Any] | None:
        if not stream_id or not message_id:
            return None

        payload = {"status": STREAM_STATUS_CANCELLED}
        claimed_cancellation = await self.message_service.claim_stream_cancellation(
            message_id=message_id,
            stream_id=stream_id,
        )

        if not claimed_cancellation:
            latest_terminal = await self._wait_for_stream_terminal_event(
                chat_id=chat_id,
                stream_id=stream_id,
            )
            return (
                self._to_stream_sse_event(latest_terminal)
                if latest_terminal is not None
                else None
            )

        try:
            cancelled_seq = await self.message_service.append_event_with_next_seq(
                chat_id=chat_id,
                message_id=message_id,
                stream_id=stream_id,
                event_type="cancelled",
                render_payload=payload,
                audit_payload={"payload": payload},
            )
        except Exception as exc:
            logger.warning(
                "Failed to persist cancelled stream event for chat %s: %s",
                chat_id,
                exc,
            )
            latest_terminal = await self._wait_for_stream_terminal_event(
                chat_id=chat_id,
                stream_id=stream_id,
            )
            return (
                self._to_stream_sse_event(latest_terminal)
                if latest_terminal is not None
                else None
            )

        return self._build_stream_sse_event(
            chat_id=chat_id,
            message_id=message_id,
            stream_id=stream_id,
            seq=cancelled_seq,
            kind="cancelled",
            payload=payload,
        )

    async def _stream_live_redis_events(
        self,
        redis: "Redis[str]",
        chat_id: UUID,
        last_seq: int,
        cancel_event: asyncio.Event,
        active_stream_id: UUID | None,
        active_message_id: UUID | None,
        live_pubsub: "PubSub",
    ) -> AsyncIterator[dict[str, Any]]:
        current_stream_id = active_stream_id
        current_message_id = active_message_id

        if (
            await redis.get(REDIS_KEY_CHAT_REVOKED.format(chat_id=chat_id))
            or cancel_event.is_set()
        ):
            logger.info("Stream already cancelled for chat %s", chat_id)
            stream_id, message_id = await self._resolve_active_cancel_targets(
                chat_id=chat_id,
                fallback_stream_id=current_stream_id,
                fallback_message_id=current_message_id,
            )
            cancelled_event = await self._build_cancelled_stream_event(
                chat_id=chat_id,
                stream_id=stream_id,
                message_id=message_id,
            )
            if cancelled_event:
                yield cancelled_event
                return

            (
                drained_events,
                last_seq,
                found_terminal,
            ) = await self._drain_events_until_terminal(
                chat_id=chat_id,
                after_seq=last_seq,
            )
            for drained_event in drained_events:
                yield drained_event
            if found_terminal:
                return

            forced_cancelled = await self._build_forced_cancelled_stream_event(
                chat_id=chat_id,
                stream_id=stream_id,
                message_id=message_id,
                fallback_seq=last_seq,
            )
            if forced_cancelled:
                yield forced_cancelled
            return

        while True:
            if cancel_event.is_set():
                logger.info("Stream cancelled for chat %s", chat_id)
                stream_id, message_id = await self._resolve_active_cancel_targets(
                    chat_id=chat_id,
                    fallback_stream_id=current_stream_id,
                    fallback_message_id=current_message_id,
                )
                cancelled_event = await self._build_cancelled_stream_event(
                    chat_id=chat_id,
                    stream_id=stream_id,
                    message_id=message_id,
                )
                if cancelled_event:
                    yield cancelled_event
                    return

                (
                    drained_events,
                    last_seq,
                    found_terminal,
                ) = await self._drain_events_until_terminal(
                    chat_id=chat_id,
                    after_seq=last_seq,
                )
                for drained_event in drained_events:
                    yield drained_event
                if found_terminal:
                    return

                forced_cancelled = await self._build_forced_cancelled_stream_event(
                    chat_id=chat_id,
                    stream_id=stream_id,
                    message_id=message_id,
                    fallback_seq=last_seq,
                )
                if forced_cancelled:
                    yield forced_cancelled
                return

            message = await live_pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if not message:
                continue
            if message.get("type") != "message":
                continue

            # Always read from persisted event log so delivery stays sequence-ordered
            # even when multiple producers publish out of order on Redis Pub/Sub.
            live_events = await self.message_service.get_chat_events_after_seq(
                chat_id=chat_id,
                after_seq=last_seq,
                limit=5000,
            )
            for event in live_events:
                current_stream_id = event.stream_id
                current_message_id = event.message_id
                yield self._to_stream_sse_event(event)
                last_seq = int(event.seq)

                if event.event_type in TERMINAL_STREAM_EVENT_TYPES:
                    return

    async def _get_active_stream_targets(
        self, chat_id: UUID
    ) -> tuple[UUID | None, UUID | None]:
        latest_assistant_message = (
            await self.message_service.get_latest_assistant_message(chat_id)
        )
        if (
            latest_assistant_message
            and latest_assistant_message.stream_status
            == MessageStreamStatus.IN_PROGRESS
        ):
            return (
                latest_assistant_message.active_stream_id,
                latest_assistant_message.id,
            )
        return None, None

    async def create_event_stream(
        self, chat_id: UUID, after_seq: int
    ) -> AsyncIterator[dict[str, Any]]:
        active_stream_id, active_message_id = await self._get_active_stream_targets(
            chat_id
        )
        last_seq = after_seq

        try:
            async with redis_connection() as redis:
                channel = REDIS_KEY_CHAT_STREAM_LIVE.format(chat_id=chat_id)
                async with redis_pubsub(redis, channel) as live_pubsub:
                    async for item in self._replay_stream_backlog(chat_id, after_seq):
                        yield item
                        try:
                            last_seq = int(item["id"])
                        except Exception:
                            pass
                        try:
                            envelope = json.loads(item.get("data", "{}"))
                        except Exception:
                            envelope = {}
                        if envelope.get("kind") in TERMINAL_STREAM_EVENT_TYPES:
                            return

                    cancel_event = asyncio.Event()
                    monitor_task = asyncio.create_task(
                        self._monitor_stream_cancellation(chat_id, cancel_event, redis)
                    )

                    try:
                        async for event in self._stream_live_redis_events(
                            redis,
                            chat_id,
                            last_seq,
                            cancel_event,
                            active_stream_id,
                            active_message_id,
                            live_pubsub,
                        ):
                            yield event
                            try:
                                event_seq = int(event.get("id", last_seq))
                                if event_seq > last_seq:
                                    last_seq = event_seq
                            except Exception:
                                pass
                            envelope = json.loads(event.get("data", "{}"))
                            if envelope.get("kind") in TERMINAL_STREAM_EVENT_TYPES:
                                return
                    finally:
                        monitor_task.cancel()
                        try:
                            await monitor_task
                        except asyncio.CancelledError:
                            pass

        except Exception as exc:
            logger.error(
                "Error in event stream for chat %s: %s", chat_id, exc, exc_info=True
            )
            yield await self._build_stream_error_event(
                chat_id=chat_id,
                message_id=active_message_id,
                stream_id=active_stream_id,
                fallback_seq=last_seq,
                error_message=str(exc),
            )

    async def restore_to_checkpoint(
        self, chat_id: UUID, message_id: UUID, current_user: User
    ) -> None:
        chat = await self.get_chat(chat_id, current_user)
        sandbox_id = chat.sandbox_id

        async with self.session_factory() as db:
            result = await db.execute(select(Message).filter(Message.id == message_id))
            message = result.scalar_one_or_none()

            if not message or message.chat_id != chat_id:
                raise ChatException(
                    "Message not found for this chat",
                    error_code=ErrorCode.MESSAGE_NOT_FOUND,
                    details={"message_id": str(message_id), "chat_id": str(chat_id)},
                    status_code=404,
                )

            if sandbox_id and message.checkpoint_id:
                await self.sandbox_service.restore_checkpoint(
                    sandbox_id, str(message.id)
                )

            await self.message_service.delete_messages_after(chat_id, message)

            update_stmt = (
                update(Chat)
                .where(Chat.id == chat_id)
                .values(session_id=message.session_id)
            )
            await db.execute(update_stmt)
            await db.commit()

    async def fork_chat(
        self, source_chat_id: UUID, message_id: UUID, user: User
    ) -> tuple[Chat, int]:
        source_chat = await self.get_chat(source_chat_id, user)

        if not source_chat.sandbox_id:
            raise ChatException(
                "Source chat has no sandbox",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        messages = await self.message_service.get_messages_up_to(
            source_chat_id, message_id
        )
        if not messages:
            raise ChatException(
                "No messages to fork",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        target_message = messages[-1]

        user_settings = cast(
            UserSettings, await self.user_service.get_user_settings(user.id)
        )

        sandbox_provider = user_settings.sandbox_provider
        if sandbox_provider != SandboxProviderType.DOCKER.value:
            raise ChatException(
                "Fork is only supported with Docker sandbox provider",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        provider = LocalDockerProvider(config=create_docker_config())
        fork_sandbox_service = SandboxService(provider)

        try:
            new_sandbox_id = await fork_sandbox_service.clone_sandbox(
                source_chat.sandbox_id,
                checkpoint_id=target_message.checkpoint_id,
            )

            try:
                await fork_sandbox_service.initialize_sandbox(
                    sandbox_id=new_sandbox_id,
                    custom_providers=user_settings.custom_providers,
                    is_fork=True,
                )

                async with self.session_factory() as db:
                    new_chat = Chat(
                        title=self.truncate_title(f"Fork of {source_chat.title}"),
                        user_id=user.id,
                        sandbox_id=new_sandbox_id,
                        sandbox_provider=SandboxProviderType.DOCKER.value,
                        session_id=target_message.session_id,
                    )
                    db.add(new_chat)
                    await db.flush()

                    new_messages: list[Message] = []
                    msg_to_attachments: list[
                        tuple[Message, list[MessageAttachment]]
                    ] = []
                    for msg in messages:
                        new_message = Message(
                            chat_id=new_chat.id,
                            content_text=msg.content_text,
                            content_render=msg.content_render,
                            last_seq=0,
                            active_stream_id=None,
                            role=msg.role,
                            model_id=msg.model_id,
                            session_id=msg.session_id,
                            checkpoint_id=msg.checkpoint_id,
                            stream_status=msg.stream_status,
                            total_cost_usd=msg.total_cost_usd,
                        )
                        new_messages.append(new_message)
                        msg_to_attachments.append((new_message, list(msg.attachments)))

                    db.add_all(new_messages)
                    await db.flush()

                    all_attachments: list[MessageAttachment] = []
                    for new_message, orig_attachments in msg_to_attachments:
                        for att in orig_attachments:
                            new_attachment = MessageAttachment(
                                message_id=new_message.id,
                                file_url="",
                                file_path=att.file_path,
                                file_type=att.file_type,
                                filename=att.filename,
                            )
                            all_attachments.append(new_attachment)

                    if all_attachments:
                        db.add_all(all_attachments)
                        await db.flush()
                        for att in all_attachments:
                            att.file_url = build_attachment_preview_url(att.id)

                    await db.commit()
                    await db.refresh(new_chat)

                return (new_chat, len(messages))

            except Exception:
                try:
                    await fork_sandbox_service.delete_sandbox(new_sandbox_id)
                except Exception:
                    pass
                raise
        finally:
            await provider.cleanup()

    async def _verify_chat_access(self, chat_id: UUID, user_id: UUID) -> bool:
        async with self.session_factory() as db:
            query = select(
                exists().where(
                    Chat.id == chat_id,
                    Chat.user_id == user_id,
                    Chat.deleted_at.is_(None),
                )
            )
            result = await db.execute(query)
            return bool(result.scalar())

    def truncate_title(self, title: str) -> str:
        if len(title) <= CHAT_TITLE_MAX_LENGTH:
            return title
        return title[:CHAT_TITLE_MAX_LENGTH] + "..."

    async def check_message_limit(self, user_id: UUID) -> None:
        can_continue = await self.user_service.check_message_limit(user_id)
        if not can_continue:
            raise ChatException(
                "Daily message limit exceeded. You have reached your daily message limit.",
                error_code=ErrorCode.CHAT_DAILY_LIMIT_EXCEEDED,
                details={"user_id": str(user_id)},
                status_code=429,
            )

    def validate_api_keys(self, user_settings: UserSettings, model_id: str) -> None:
        try:
            validate_model_api_keys(user_settings, model_id)
        except APIKeyValidationError as e:
            raise ChatException(
                str(e), error_code=ErrorCode.API_KEY_MISSING, status_code=400
            ) from e

    async def create_assistant_message(self, chat: Chat, model_id: str) -> Message:
        return await self.message_service.create_message(
            chat.id,
            "",
            MessageRole.ASSISTANT,
            model_id=model_id,
            stream_status=MessageStreamStatus.IN_PROGRESS,
        )

    async def enqueue_chat_task(
        self,
        *,
        prompt: str,
        system_prompt: str,
        custom_instructions: str | None,
        user: User,
        chat: Chat,
        permission_mode: str,
        model_id: str,
        session_id: str | None,
        assistant_message_id: str,
        thinking_mode: str | None,
        attachments: list[MessageAttachmentDict] | None,
        is_custom_prompt: bool = False,
    ) -> "AsyncResult[object]":
        return process_chat.delay(
            prompt=prompt,
            system_prompt=system_prompt,
            custom_instructions=custom_instructions,
            chat_data={
                "id": str(chat.id),
                "user_id": str(chat.user_id),
                "title": chat.title,
                "sandbox_id": chat.sandbox_id,
                "session_id": chat.session_id,
            },
            permission_mode=permission_mode,
            model_id=model_id,
            session_id=session_id,
            assistant_message_id=assistant_message_id,
            thinking_mode=thinking_mode,
            attachments=attachments,
            is_custom_prompt=is_custom_prompt,
        )

    async def store_active_task(self, chat_id: UUID, task_id: str) -> None:
        async with redis_connection() as redis:
            await redis.setex(
                REDIS_KEY_CHAT_TASK.format(chat_id=chat_id),
                settings.TASK_TTL_SECONDS,
                task_id,
            )

    async def _resume_sandbox(self, chat_id: UUID, user: User) -> None:
        try:
            sandbox_id = await self.get_chat_sandbox_id(chat_id, user)
            if sandbox_id:
                await self.sandbox_service.get_or_connect_sandbox(sandbox_id)
        except ChatException:
            pass
        except Exception as e:
            logger.warning("Failed to resume sandbox for chat %s: %s", chat_id, e)

    async def needs_session_cleaning(
        self, chat_id: UUID, new_model_id: str, user_id: UUID
    ) -> bool:
        user_settings = await self.user_service.get_user_settings(user_id)
        if not user_settings:
            return False

        new_provider, _ = self._provider_service.get_provider_for_model(
            user_settings, new_model_id
        )
        new_provider_type = new_provider.get("provider_type") if new_provider else None

        if new_provider_type != ProviderType.ANTHROPIC.value:
            return False

        last_message = await self.message_service.get_latest_assistant_message(chat_id)
        if not last_message or not last_message.model_id:
            return False

        prev_provider, _ = self._provider_service.get_provider_for_model(
            user_settings, last_message.model_id
        )
        prev_provider_type = (
            prev_provider.get("provider_type") if prev_provider else None
        )

        if prev_provider_type != ProviderType.ANTHROPIC.value:
            logger.info(
                "Session cleaning needed for chat %s: switching from %s to %s",
                chat_id,
                prev_provider_type,
                new_provider_type,
            )
            return True

        return False
