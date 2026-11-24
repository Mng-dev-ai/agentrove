from __future__ import annotations

import logging
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.constants import REDIS_KEY_USER_STREAMS_LIVE
from app.models.db_models.chat import Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.services.db import SessionFactoryType
from app.services.message import MessageService
from app.services.streaming.types import (
    SNAPSHOT_EVENT_KINDS,
    StreamEnvelope,
    StreamSnapshotAccumulator,
)
from app.utils.cache import CacheError, cache_connection

logger = logging.getLogger(__name__)

EVENT_REPLAY_PAGE_SIZE = 500


class DeadStreamRecovery:
    @classmethod
    async def reconcile_orphaned_messages(
        cls, session_factory: SessionFactoryType
    ) -> None:
        # In-progress messages from a previous process can never complete.
        try:
            async with session_factory() as db:
                result = await db.execute(
                    select(Message.id).where(
                        Message.stream_status == MessageStreamStatus.IN_PROGRESS,
                        Message.role == MessageRole.ASSISTANT,
                        Message.deleted_at.is_(None),
                    )
                )
                orphan_ids = list(result.scalars().all())
        except SQLAlchemyError:
            logger.exception("Failed to scan for orphaned in-progress messages")
            return

        for message_id in orphan_ids:
            await cls.finalize_dead_stream(
                assistant_message_id=str(message_id),
                session_factory=session_factory,
                stream_status=MessageStreamStatus.INTERRUPTED,
                record_activity=False,
            )
        if orphan_ids:
            logger.info(
                "Reconciled %d orphaned in-progress message(s) from previous run",
                len(orphan_ids),
            )

    @staticmethod
    async def finalize_dead_stream(
        *,
        assistant_message_id: str | None,
        session_factory: SessionFactoryType,
        stream_status: MessageStreamStatus,
        user_id: str | None = None,
        error_message: str | None = None,
        # False for reconciliation: cleanup is not duration or unseen activity.
        record_activity: bool = True,
    ) -> None:
        if not assistant_message_id:
            return

        try:
            message_uuid = UUID(assistant_message_id)
        except ValueError:
            return

        try:
            message_service = MessageService(session_factory=session_factory)
            message = await message_service.get_message(message_uuid)
            if not message:
                return
            snapshot, last_seq = await DeadStreamRecovery._replay_past_checkpoint(
                message_service, message
            )
            content_text = snapshot.content_text
            content_render = snapshot.to_render()
            if error_message is not None:
                content_render["events"].append(
                    StreamSnapshotAccumulator.error_event(error_message)
                )
                if not content_text:
                    content_text = error_message
            winning_snapshot = await message_service.update_message_snapshot(
                message_uuid,
                content_text=content_text,
                content_render=content_render,
                last_seq=last_seq,
                active_stream_id=None,
                stream_status=stream_status,
                record_activity=record_activity,
            )
            if winning_snapshot is None:
                return
            status, duration_ms = winning_snapshot
            # After the snapshot prune, so the terminal event survives for clients;
            # ChatStreamRuntime's live path keeps the same order.
            await DeadStreamRecovery._emit_terminal_for_dead_stream(
                message_service=message_service,
                chat_id=message.chat_id,
                message_id=message_uuid,
                stream_id=message.active_stream_id or uuid4(),
                stream_status=status,
                duration_ms=duration_ms,
                user_id=user_id,
                error_message=error_message,
                record_activity=record_activity,
            )
        except Exception:
            logger.exception(
                "Failed to finalize assistant message %s as %s",
                assistant_message_id,
                stream_status.value,
            )

    @staticmethod
    async def _replay_past_checkpoint(
        message_service: MessageService, message: Message
    ) -> tuple[StreamSnapshotAccumulator, int]:
        # Checkpoints lag the event log; fold committed events past the
        # checkpoint into the render before the terminal update prunes them.
        snapshot = StreamSnapshotAccumulator.from_render(
            message.content_render.get("events", [])
        )
        last_seq = message.last_seq
        while True:
            page = await message_service.get_message_events_after_seq(
                message.id, last_seq, limit=EVENT_REPLAY_PAGE_SIZE
            )
            for event in page:
                if event.event_type in SNAPSHOT_EVENT_KINDS:
                    snapshot.add_event(event.event_type, event.render_payload)
                last_seq = event.seq
            if len(page) < EVENT_REPLAY_PAGE_SIZE:
                return snapshot, last_seq

    @staticmethod
    async def _emit_terminal_for_dead_stream(
        *,
        message_service: MessageService,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        stream_status: MessageStreamStatus,
        duration_ms: int | None,
        user_id: str | None,
        error_message: str | None = None,
        record_activity: bool = True,
    ) -> None:
        kind, payload = StreamEnvelope.terminal_event_payload(
            stream_status, duration_ms, error_message
        )
        seq = await message_service.append_event_with_next_seq(
            chat_id=chat_id,
            message_id=message_id,
            stream_id=stream_id,
            event_type=kind,
            render_payload=payload,
            audit_payload={"payload": payload},
            record_activity=record_activity,
        )
        if seq is None or not user_id:
            return
        try:
            async with cache_connection() as cache:
                channel = REDIS_KEY_USER_STREAMS_LIVE.format(user_id=user_id)
                await cache.publish(
                    channel,
                    StreamEnvelope.serialize(
                        chat_id=chat_id,
                        message_id=message_id,
                        stream_id=stream_id,
                        seq=seq,
                        kind=kind,
                        payload=payload,
                    ),
                )
        except CacheError as exc:
            logger.warning(
                "Failed to publish terminal event for chat %s: %s", chat_id, exc
            )
