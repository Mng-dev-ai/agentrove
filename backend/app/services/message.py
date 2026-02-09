import logging
import json
from datetime import datetime, timezone
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import select, delete, update, or_, and_, func, insert
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import (
    Message,
    Chat,
    MessageAttachment,
    MessageEvent,
    MessageRole,
    MessageStreamStatus,
)
from app.models.schemas import CursorPaginatedMessages
from app.models.types import MessageAttachmentDict
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import MessageException, ErrorCode
from app.utils.attachment_urls import build_attachment_preview_url
from app.utils.cursor import encode_cursor, decode_cursor, InvalidCursorError

logger = logging.getLogger(__name__)


class MessageService(BaseDbService[Message]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)

    @staticmethod
    def _extract_user_text_content(content: str) -> str:
        stripped = content.strip()
        if not stripped:
            return ""
        if not (stripped.startswith("[") or stripped.startswith("{")):
            return content

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return content

        if isinstance(parsed, list):
            items = parsed
        elif isinstance(parsed, dict):
            items = [parsed]
        else:
            return content

        parts: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("type") or "").lower() != "user_text":
                continue
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)

        return "".join(parts) if parts else content

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
        async with self.session_factory() as db:
            is_assistant = role == MessageRole.ASSISTANT
            content_text = ""
            content_render: dict[str, Any] = {"events": [], "segments": []}
            if not is_assistant:
                content_text = self._extract_user_text_content(content)
                if content_text:
                    content_render = {
                        "events": [{"type": "user_text", "text": content_text}],
                        "segments": [],
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

                    attachment.file_url = build_attachment_preview_url(attachment.id)

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
        async with self.session_factory() as db:
            now = datetime.now(timezone.utc)
            values: dict[str, Any] = {
                "content_text": content_text,
                "content_render": content_render,
                "last_seq": func.greatest(Message.last_seq, last_seq),
                "active_stream_id": active_stream_id,
                "updated_at": now,
            }
            if stream_status is not None:
                values["stream_status"] = stream_status
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

    async def claim_stream_cancellation(
        self,
        *,
        message_id: UUID,
        stream_id: UUID,
    ) -> bool:
        async with self.session_factory() as db:
            now = datetime.now(timezone.utc)
            result = await db.execute(
                update(Message)
                .where(
                    Message.id == message_id,
                    Message.active_stream_id == stream_id,
                    Message.stream_status == MessageStreamStatus.IN_PROGRESS,
                )
                .values(
                    stream_status=MessageStreamStatus.INTERRUPTED,
                    updated_at=now,
                )
                .returning(Message.id)
            )
            claimed = result.scalar_one_or_none() is not None
            await db.commit()
            return claimed

    async def get_chat_messages(
        self, chat_id: UUID, cursor: str | None = None, limit: int = 20
    ) -> CursorPaginatedMessages:
        async with self.session_factory() as db:
            query = (
                select(Message)
                .options(selectinload(Message.attachments))
                .filter(Message.chat_id == chat_id, Message.deleted_at.is_(None))
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(limit + 1)
            )

            if cursor:
                try:
                    ts, mid = decode_cursor(cursor)
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
            rows = list(result.scalars().all())

            has_more = len(rows) > limit
            items = rows[:limit]

            next_cursor = None
            if has_more and items:
                last = items[-1]
                next_cursor = encode_cursor(last.created_at, last.id)

            return CursorPaginatedMessages(
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

    async def append_events(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return

        now = datetime.now(timezone.utc)
        rows: list[dict[str, Any]] = []
        for event in events:
            rows.append(
                {
                    "id": uuid4(),
                    "chat_id": event["chat_id"],
                    "message_id": event["message_id"],
                    "stream_id": event["stream_id"],
                    "seq": event["seq"],
                    "event_type": event["event_type"],
                    "render_payload": event["render_payload"],
                    "audit_payload": event.get("audit_payload"),
                    "created_at": now,
                    "updated_at": now,
                }
            )

        async with self.session_factory() as db:
            await db.execute(insert(MessageEvent), rows)
            await db.commit()

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

    async def get_latest_stream_event(
        self,
        *,
        chat_id: UUID,
        stream_id: UUID,
    ) -> MessageEvent | None:
        async with self.session_factory() as db:
            query = (
                select(MessageEvent)
                .where(
                    MessageEvent.chat_id == chat_id,
                    MessageEvent.stream_id == stream_id,
                )
                .order_by(MessageEvent.seq.desc())
                .limit(1)
            )
            result = await db.execute(query)
            return cast(MessageEvent | None, result.scalar_one_or_none())

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

    async def delete_messages_after(self, chat_id: UUID, message: Message) -> int:
        async with self.session_factory() as db:
            delete_stmt = delete(Message).filter(
                Message.chat_id == chat_id, Message.created_at > message.created_at
            )
            result = await db.execute(delete_stmt)
            await db.commit()
            return int(getattr(result, "rowcount", 0))

    async def get_attachment(
        self, attachment_id: UUID, db: AsyncSession
    ) -> MessageAttachment | None:
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

    async def get_messages_up_to(
        self, chat_id: UUID, message_id: UUID
    ) -> list[Message]:
        async with self.session_factory() as db:
            target_query = select(Message).filter(
                Message.id == message_id,
                Message.chat_id == chat_id,
                Message.deleted_at.is_(None),
            )
            target_result = await db.execute(target_query)
            target_message = target_result.scalar_one_or_none()

            if target_message is None:
                raise MessageException(
                    "Message not found in this chat",
                    error_code=ErrorCode.MESSAGE_NOT_FOUND,
                    details={"message_id": str(message_id), "chat_id": str(chat_id)},
                    status_code=404,
                )

            # Use (created_at, id) for stable cutoff to handle same-timestamp messages
            query = (
                select(Message)
                .options(selectinload(Message.attachments))
                .filter(
                    Message.chat_id == chat_id,
                    Message.deleted_at.is_(None),
                    or_(
                        Message.created_at < target_message.created_at,
                        and_(
                            Message.created_at == target_message.created_at,
                            Message.id <= target_message.id,
                        ),
                    ),
                )
                .order_by(Message.created_at.asc(), Message.id.asc())
            )
            result = await db.execute(query)
            return list(result.scalars().all())
