import logging
from datetime import datetime, timezone
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import and_, case, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.db_models.chat import (
    Chat,
    ChatCheckpoint,
    Message,
    MessageAttachment,
    MessageEvent,
)
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.schemas.chat import Message as MessageSchema
from app.models.schemas.pagination import CursorPaginatedResponse
from app.models.types import MessageAttachmentDict
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ErrorCode, MessageException
from app.utils.attachment_urls import AttachmentURL
from app.utils.cursor import Cursor, InvalidCursorError

logger = logging.getLogger(__name__)


class MessageService(BaseDbService[Message]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)

    @staticmethod
    def serialize_attachments(
        queued_msg: dict[str, Any],
        user_message: Message,
    ) -> list[dict[str, Any]] | None:
        if not queued_msg.get("attachments") or not user_message.attachments:
            return None

        return [
            {
                "id": str(att.id),
                "message_id": str(att.message_id),
                "file_url": att.file_url,
                "file_type": att.file_type,
                "filename": att.filename,
                "created_at": att.created_at.isoformat(),
            }
            for att in user_message.attachments
        ]

    async def create_message(
        self,
        chat_id: UUID,
        content: str,
        role: MessageRole,
        attachments: list[MessageAttachmentDict] | None = None,
        model_id: str | None = None,
        session_id: str | None = None,
        stream_status: MessageStreamStatus | None = None,
    ) -> Message:
        # Assistant messages start empty and get populated by the streaming
        # pipeline via update_message_snapshot; user messages go in whole.
        async with self.session_factory() as db:
            if role == MessageRole.ASSISTANT:
                content_text = ""
                content_render: dict[str, Any] = {"events": []}
            else:
                content_text = content
                content_render = {
                    "events": [{"type": "user_text", "text": content}],
                }

            message_kwargs: dict[str, Any] = {
                "chat_id": chat_id,
                "content_text": content_text,
                "content_render": content_render,
                "last_seq": 0,
                "active_stream_id": None,
                "role": role,
                "model_id": model_id,
                "session_id": session_id,
            }
            if stream_status is not None:
                message_kwargs["stream_status"] = stream_status

            message = Message(**message_kwargs)
            db.add(message)
            await db.commit()
            await db.refresh(message)

            if attachments:
                for attachment_data in attachments:
                    attachment = MessageAttachment(
                        message_id=message.id,
                        file_url=attachment_data["file_url"],
                        file_path=attachment_data.get("file_path"),
                        file_type=attachment_data["file_type"],
                        filename=attachment_data.get("filename"),
                    )
                    db.add(attachment)
                    await db.flush()

                    attachment.file_url = AttachmentURL.build_preview_url(attachment.id)

                await db.commit()
                await db.refresh(message, ["attachments"])

            return message

    async def get_message(self, message_id: UUID) -> Message | None:
        async with self.session_factory() as db:
            query = (
                select(Message)
                .options(selectinload(Message.attachments))
                .filter(Message.id == message_id)
            )
            result = await db.execute(query)
            return cast(Message | None, result.scalar_one_or_none())

    async def update_message_snapshot(
        self,
        message_id: UUID,
        *,
        content_text: str,
        content_render: dict[str, Any],
        last_seq: int,
        active_stream_id: UUID | None,
        stream_status: MessageStreamStatus | None = None,
        total_cost_usd: float | None = None,
    ) -> Message | None:
        # Periodic snapshot write so reconnecting clients can hydrate without
        # replaying every event. Returns None if the row was soft-deleted mid-stream.
        async with self.session_factory() as db:
            now = datetime.now(timezone.utc)
            values: dict[str, Any] = {
                "content_text": content_text,
                "content_render": content_render,
                # Monotonic guard: never regress last_seq if a late-arriving
                # flush races with a newer one (can happen during cancellation).
                "last_seq": case(
                    (Message.last_seq > last_seq, Message.last_seq),
                    else_=last_seq,
                ),
                "active_stream_id": active_stream_id,
                "updated_at": now,
            }
            if stream_status is not None:
                values["stream_status"] = stream_status
                # Record total run time once, at the terminal snapshot. created_at
                # marks run start — the empty assistant row is inserted before
                # streaming begins.
                if stream_status != MessageStreamStatus.IN_PROGRESS:
                    created_at = await db.scalar(
                        select(Message.created_at).where(Message.id == message_id)
                    )
                    if created_at is not None:
                        values["duration_ms"] = int(
                            (now - created_at).total_seconds() * 1000
                        )
            if total_cost_usd is not None:
                values["total_cost_usd"] = total_cost_usd

            stmt = update(Message).where(Message.id == message_id).values(**values)
            result = await db.execute(stmt)
            if int(getattr(result, "rowcount", 0)) == 0:
                return None

            await db.commit()

            query = select(Message).filter(Message.id == message_id)
            refreshed = await db.execute(query)
            message = refreshed.scalar_one_or_none()
            return cast(Message | None, message)

    async def append_event_with_next_seq(
        self,
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        event_type: str,
        render_payload: dict[str, Any],
        audit_payload: dict[str, Any] | None,
    ) -> int:
        # Allocate a gapless chat-scoped seq atomically via UPDATE...RETURNING;
        # clients use it as the SSE id for catch-up on reconnect.
        async with self.session_factory() as db:
            seq_result = await db.execute(
                update(Chat)
                .where(Chat.id == chat_id)
                .values(last_event_seq=Chat.last_event_seq + 1)
                .returning(Chat.last_event_seq)
            )
            next_seq = seq_result.scalar_one_or_none()
            if next_seq is None:
                raise MessageException(
                    "Chat not found",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )
            next_seq = int(next_seq)

            now = datetime.now(timezone.utc)
            await db.execute(
                insert(MessageEvent).values(
                    id=uuid4(),
                    chat_id=chat_id,
                    message_id=message_id,
                    stream_id=stream_id,
                    seq=next_seq,
                    event_type=event_type,
                    render_payload=render_payload,
                    audit_payload=audit_payload,
                    created_at=now,
                    updated_at=now,
                )
            )

            await db.commit()
            return next_seq

    async def append_events_batch(
        self,
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        events: list[tuple[str, dict[str, Any], dict[str, Any] | None]],
    ) -> int:
        # Bulk variant: one UPDATE bumps Chat.last_event_seq by N and the
        # contiguous range is assigned to the inserts — cuts write amplification
        # during chunky agent output bursts.
        if not events:
            return 0

        count = len(events)
        async with self.session_factory() as db:
            seq_result = await db.execute(
                update(Chat)
                .where(Chat.id == chat_id)
                .values(last_event_seq=Chat.last_event_seq + count)
                .returning(Chat.last_event_seq)
            )
            end_seq = seq_result.scalar_one_or_none()
            if end_seq is None:
                raise MessageException(
                    "Chat not found",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )
            end_seq = int(end_seq)
            start_seq = end_seq - count + 1

            now = datetime.now(timezone.utc)
            rows = [
                {
                    "id": uuid4(),
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "stream_id": stream_id,
                    "seq": start_seq + i,
                    "event_type": event_type,
                    "render_payload": render_payload,
                    "audit_payload": audit_payload,
                    "created_at": now,
                    "updated_at": now,
                }
                for i, (event_type, render_payload, audit_payload) in enumerate(events)
            ]
            await db.execute(insert(MessageEvent), rows)
            await db.commit()
            return end_seq

    async def get_chat_messages(
        self, chat_id: UUID, cursor: str | None = None, limit: int = 20
    ) -> CursorPaginatedResponse[MessageSchema]:
        # (created_at, id) tiebreak matters — user + empty-assistant pairs
        # created in the same tick share a timestamp.
        async with self.session_factory() as db:
            query = (
                select(Message, ChatCheckpoint.id)
                .outerjoin(
                    ChatCheckpoint,
                    ChatCheckpoint.assistant_message_id == Message.id,
                )
                .options(selectinload(Message.attachments))
                .filter(Message.chat_id == chat_id, Message.deleted_at.is_(None))
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(limit + 1)
            )

            if cursor:
                try:
                    ts, mid = Cursor.decode(cursor)
                except InvalidCursorError:
                    raise MessageException(
                        "Invalid pagination cursor",
                        error_code=ErrorCode.VALIDATION_ERROR,
                        status_code=400,
                    )
                query = query.filter(
                    or_(
                        Message.created_at < ts,
                        and_(Message.created_at == ts, Message.id < mid),
                    )
                )

            result = await db.execute(query)
            rows = list(result.all())

            has_more = len(rows) > limit
            items = []
            for message, checkpoint_id in rows[:limit]:
                message.checkpoint_id = checkpoint_id
                items.append(message)

            next_cursor = None
            if has_more and items:
                last = items[-1]
                next_cursor = Cursor.encode(last.created_at, last.id)

            return CursorPaginatedResponse[MessageSchema](
                items=items,
                next_cursor=next_cursor,
                has_more=has_more,
            )

    async def get_latest_assistant_message(self, chat_id: UUID) -> Message | None:
        async with self.session_factory() as db:
            query = (
                select(Message)
                .filter(
                    Message.chat_id == chat_id,
                    Message.role == MessageRole.ASSISTANT,
                    Message.deleted_at.is_(None),
                )
                .order_by(Message.created_at.desc())
                .limit(1)
            )
            result = await db.execute(query)
            return cast(Message | None, result.scalar_one_or_none())

    async def get_chat_events_after_seq(
        self,
        chat_id: UUID,
        after_seq: int,
        limit: int = 500,
    ) -> list[MessageEvent]:
        async with self.session_factory() as db:
            query = (
                select(MessageEvent)
                .where(MessageEvent.chat_id == chat_id, MessageEvent.seq > after_seq)
                .order_by(MessageEvent.seq.asc())
                .limit(limit)
            )
            result = await db.execute(query)
            return list(result.scalars().all())

    async def get_message_events_after_seq(
        self,
        message_id: UUID,
        after_seq: int,
        limit: int = 500,
    ) -> list[MessageEvent]:
        async with self.session_factory() as db:
            query = (
                select(MessageEvent)
                .where(
                    MessageEvent.message_id == message_id, MessageEvent.seq > after_seq
                )
                .order_by(MessageEvent.seq.asc())
                .limit(limit)
            )
            result = await db.execute(query)
            return list(result.scalars().all())

    async def get_attachment(
        self, attachment_id: UUID, db: AsyncSession
    ) -> MessageAttachment | None:
        # Takes an explicit session so AttachmentService can share the
        # request-scoped one. Eager-loads message.chat for the ownership check.
        result = await db.execute(
            select(MessageAttachment)
            .options(selectinload(MessageAttachment.message).selectinload(Message.chat))
            .where(MessageAttachment.id == attachment_id)
        )
        return cast(MessageAttachment | None, result.scalar_one_or_none())

    async def soft_delete_message(self, message_id: UUID) -> bool:
        async with self.session_factory() as db:
            now = datetime.now(timezone.utc)
            stmt = (
                update(Message)
                .where(Message.id == message_id, Message.deleted_at.is_(None))
                .values(deleted_at=now)
            )
            result = await db.execute(stmt)
            await db.commit()
            return int(getattr(result, "rowcount", 0)) > 0
