from __future__ import annotations

import logging
import time
from copy import deepcopy
from typing import Any
from uuid import UUID

from app.constants import REDIS_KEY_USER_STREAMS_LIVE
from app.models.db_models.enums import MessageStreamStatus
from app.services.agent import StreamResult
from app.services.message import MessageService
from app.services.streaming.types import (
    SNAPSHOT_EVENT_KINDS,
    StreamEnvelope,
    StreamSnapshotAccumulator,
)
from app.utils.cache import CacheError, CacheStore

logger = logging.getLogger(__name__)

SNAPSHOT_CHECKPOINT_INTERVAL_SECONDS = 2.0


class StreamEventLog:
    def __init__(
        self,
        *,
        message_service: MessageService,
        chat_id: UUID,
        assistant_message_id: str | None,
        stream_id: UUID,
        publish_user_id: str | None,
    ) -> None:
        self.message_service = message_service
        self.chat_id = chat_id
        self.assistant_message_id = assistant_message_id
        self.stream_id = stream_id
        self.publish_user_id = publish_user_id
        self.cache: CacheStore | None = None

        self.snapshot = StreamSnapshotAccumulator()
        self.last_seq: int = 0
        self.pending_since_flush: int = 0
        self.last_flush_at: float = time.monotonic()
        self.last_checkpoint_at: float = self.last_flush_at
        self.event_buffer: list[tuple[str, dict[str, Any], dict[str, Any] | None]] = []

    async def append(
        self, kind: str, payload: dict[str, Any], *, apply_snapshot: bool
    ) -> int | None:
        audit = {"payload": StreamEnvelope.sanitize_payload(payload)}
        if apply_snapshot and kind in SNAPSHOT_EVENT_KINDS:
            # ACP tool payloads are updated in place as progress arrives, so
            # buffered history needs its own copy or earlier events get rewritten
            # to the latest title/status before we flush them.
            frozen_payload = deepcopy(payload)
            self.event_buffer.append((kind, frozen_payload, audit))
            self.snapshot.add_event(kind, frozen_payload)
            self.pending_since_flush += 1
            return None

        await self.flush_event_buffer()
        seq = await self.message_service.append_event_with_next_seq(
            chat_id=self.chat_id,
            message_id=UUID(self.assistant_message_id),
            stream_id=self.stream_id,
            event_type=kind,
            render_payload=payload,
            audit_payload=audit,
        )
        if seq is None:
            return None
        self.last_seq = seq
        return seq

    async def flush_event_buffer(self) -> None:
        if not self.event_buffer or not self.assistant_message_id:
            return
        batch = self.event_buffer
        seq = await self.message_service.append_events_batch(
            chat_id=self.chat_id,
            message_id=UUID(self.assistant_message_id),
            stream_id=self.stream_id,
            events=batch,
        )
        self.event_buffer = []
        self.last_seq = seq

        start_seq = seq - len(batch) + 1
        redis_events = [
            self.serialize_envelope(start_seq + i, kind, payload)
            for i, (kind, payload, _audit) in enumerate(batch)
        ]
        await self.publish_to_redis(redis_events)

    def serialize_envelope(self, seq: int, kind: str, payload: dict[str, Any]) -> str:
        return StreamEnvelope.serialize(
            chat_id=self.chat_id,
            message_id=UUID(self.assistant_message_id),
            stream_id=self.stream_id,
            seq=seq,
            kind=kind,
            payload=payload,
        )

    async def publish_to_redis(self, events: list[str]) -> None:
        # Envelopes carry chatId, so all of a user's streams share one channel —
        # the multiplexed SSE feed subscribes once and routes client-side.
        if self.publish_user_id is None or not self.cache or not events:
            return
        channel = REDIS_KEY_USER_STREAMS_LIVE.format(user_id=self.publish_user_id)
        for raw in events:
            try:
                await self.cache.publish(channel, raw)
            except CacheError as exc:
                logger.warning(
                    "Failed to publish event for chat %s: %s",
                    self.chat_id,
                    exc,
                )

    async def flush_snapshot(self) -> None:
        # Events publish every 200ms or 24 events. The full-render checkpoint is
        # rarer: catch-up replays message_events past its last_seq, and
        # DeadStreamRecovery.finalize_dead_stream folds those in before pruning.
        if not self.assistant_message_id or self.pending_since_flush == 0:
            return
        now = time.monotonic()
        if (now - self.last_flush_at) * 1000 < 200 and self.pending_since_flush < 24:
            return

        await self.flush_event_buffer()
        self.pending_since_flush = 0
        self.last_flush_at = now
        if now - self.last_checkpoint_at < SNAPSHOT_CHECKPOINT_INTERVAL_SECONDS:
            return
        await self.message_service.update_message_snapshot(
            UUID(self.assistant_message_id),
            content_text=self.snapshot.content_text,
            content_render=self.snapshot.to_render(),
            last_seq=self.last_seq,
            active_stream_id=self.stream_id,
        )
        self.last_checkpoint_at = now

    async def save_final_snapshot(
        self,
        stream_result: StreamResult,
        stream_status: MessageStreamStatus,
        session_id: str | None,
    ) -> tuple[MessageStreamStatus, int | None] | None:
        # Persist duration so the terminal event can carry it without a refetch.
        if not self.assistant_message_id:
            return None
        await self.flush_event_buffer()
        return await self.message_service.update_message_snapshot(
            UUID(self.assistant_message_id),
            content_text=self.snapshot.content_text,
            content_render=self.snapshot.to_render(),
            last_seq=self.last_seq,
            active_stream_id=None,
            stream_status=stream_status,
            total_cost_usd=stream_result.total_cost_usd,
            session_id=session_id,
        )
