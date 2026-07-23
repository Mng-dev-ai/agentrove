from __future__ import annotations

import asyncio
import json
import logging
import time
from copy import deepcopy
from collections.abc import AsyncIterator
from functools import partial
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.constants import (
    MODELS,
    REDIS_KEY_CHAT_CONTEXT_USAGE,
    REDIS_KEY_USER_STREAMS_LIVE,
)
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User, UserSettings
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.acp.session import AcpSession, AcpSessionConfig
from app.services.agent import (
    AgentService,
    StreamResult,
)
from app.services.session_registry import session_registry
from app.services.db import SessionFactoryType
from app.services.exceptions import AgentException
from app.services.message import MessageService
from app.services.queue import QueueService
from app.services.streaming.types import (
    PROMPT_SUGGESTIONS_RE,
    ChatStreamRequest,
    StreamEnvelope,
    StreamEvent,
    StreamSnapshotAccumulator,
)
from app.services.user import UserService
from app.utils.cache import CacheError, CacheStore, cache_connection

logger = logging.getLogger(__name__)
settings = get_settings()

TRANSPORT_FATAL_TYPES = (
    ConnectionError,
    OSError,
)

# Steering acceptance is a fast control-plane call (adapters reply on acceptance,
# not on LLM completion). Bound it so a hung adapter can't hold the send-now claim
# and the per-chat steering guard forever; on timeout the generic failure path
# restores the claim and falls back to the legacy cancel flow.
STEER_ACCEPT_TIMEOUT_SECONDS = 15.0

# Snapshot-contributing events (text/tools/etc.) — batched; control events persist immediately.
SNAPSHOT_EVENT_KINDS = frozenset(
    {
        "assistant_text",
        "assistant_thinking",
        "tool_started",
        "tool_completed",
        "tool_failed",
        "prompt_suggestions",
        "system",
        "plan",
    }
)


class ChatStreamRuntime:
    # Background stream tasks by asyncio.Task — track chats, await shutdown, block duplicates.
    _background_task_chat_ids: dict[asyncio.Task[str], str] = {}
    _active_runtimes: dict[str, ChatStreamRuntime] = {}
    # Per-process like the runtime/session registries it protects.
    _steering_chats: set[str] = set()

    def __init__(
        self,
        *,
        request: ChatStreamRequest,
        session_factory: SessionFactoryType,
    ) -> None:
        chat = Chat.from_dict(request.chat_data)
        self.chat = chat
        self.chat_id = str(chat.id)
        self.stream_id = uuid4()
        self.session_id: str | None = request.session_id
        self.assistant_message_id = request.assistant_message_id
        self.model_id = request.model_id
        self.context_window = request.context_window
        self.prompt = request.prompt
        self._is_new_chat = request.session_id is None
        self.custom_instructions = request.custom_instructions
        self.session_factory = session_factory

        self.snapshot = StreamSnapshotAccumulator()
        self.last_seq: int = 0
        self.pending_since_flush: int = 0
        self.last_flush_at: float = time.monotonic()
        self.message_service = MessageService(session_factory=session_factory)
        self._event_buffer: list[tuple[str, dict[str, Any], dict[str, Any] | None]] = []

        self.cache: CacheStore | None = None
        self._cancel_event: asyncio.Event | None = None
        self._cancelled: bool = False
        self._bg_tasks: set[asyncio.Task[None]] = set()
        self._last_emitted_tokens: int = 0
        self._last_emitted_context_window: int = 0
        self._stream: AsyncIterator[StreamEvent] | None = None
        self._stream_result: StreamResult = StreamResult()
        self._start_seq = 0
        self._acp_session: AcpSession | None = None

    async def run(
        self,
        stream_result: StreamResult,
        stream: AsyncIterator[StreamEvent],
    ) -> str:
        self._stream = stream
        self._stream_result = stream_result
        # Titling only needs the user's prompt, so it starts alongside the turn
        # instead of after it — the sidebar shows a real title while streaming.
        title_task = asyncio.create_task(self._generate_title())
        self._bg_tasks.add(title_task)
        title_task.add_done_callback(self._bg_tasks.discard)
        title_task.add_done_callback(ChatStreamRuntime._on_title_task_done)
        try:
            await self._start_message_stream()
            await self._consume_stream(stream)
            if self._acp_session is not None:
                self._stream_result.total_cost_usd = (
                    self._acp_session.handler.total_cost_usd
                )
                self._stream_result.usage = self._acp_session.handler.usage
            await self._emit_prompt_suggestions()

            if self._cancelled:
                return await self._complete_stream(
                    self._stream_result, MessageStreamStatus.INTERRUPTED
                )

            # Buffered events may not have flushed yet (debounce) — a fast turn
            # can finish with last_seq still at start_seq, so check the buffer
            # too before declaring the stream empty.
            if self.last_seq <= self._start_seq and not self._event_buffer:
                # Cancel/send-now may have arrived after the last event was
                # consumed but before _consume_stream returned — the stream
                # ended naturally (via StopAsyncIteration) so CancelledError
                # never fired. Treat as interrupted rather than erroring.
                if self._cancel_event and self._cancel_event.is_set():
                    return await self._complete_stream(
                        self._stream_result, MessageStreamStatus.INTERRUPTED
                    )
                raise AgentException("Stream completed without any events")

            return await self._complete_stream(
                self._stream_result, MessageStreamStatus.COMPLETED
            )

        except Exception as exc:
            logger.error("Error in stream processing: %s", exc)
            await self.emit_event(
                "error",
                {"error": str(exc)},
                apply_snapshot=False,
            )
            await self._save_final_snapshot(
                self._stream_result, MessageStreamStatus.FAILED
            )
            raise

    async def _consume_stream(
        self,
        stream: AsyncIterator[StreamEvent],
    ) -> None:
        stream_iter = aiter(stream)
        try:
            while True:
                event = await self._next_or_cancel(stream_iter)
                if event is None:
                    break

                event_dict: dict[str, Any] = dict(event)
                kind = str(event_dict.get("type") or "system")
                payload: dict[str, Any] = {
                    k: v for k, v in event_dict.items() if k != "type"
                }

                if kind == "_steer_rotation":
                    data = payload.get("data")
                    queued_msg = (
                        data.get("queued_msg") if isinstance(data, dict) else None
                    )
                    if isinstance(queued_msg, dict):
                        await self._rotate_for_steer(queued_msg)
                    continue

                if kind == "system":
                    session_data: dict[str, Any] = payload.get("data") or {}
                    if session_data.get("session_id"):
                        task = asyncio.create_task(
                            self._handle_session_update(session_data)
                        )
                        self._bg_tasks.add(task)
                        task.add_done_callback(self._bg_tasks.discard)
                        task.add_done_callback(self._on_session_update_done)

                if kind == "usage":
                    usage_data = payload.get("data")
                    self._stream_result.usage = (
                        usage_data if isinstance(usage_data, dict) else None
                    )
                    await self._emit_context_usage(self._stream_result)
                else:
                    await self.emit_event(kind, payload)
                    await self._flush_snapshot(force=False)
        except asyncio.CancelledError:
            if not (self._cancel_event and self._cancel_event.is_set()):
                raise
            self._cancelled = True

    async def _rotate_for_steer(self, queued_msg: dict[str, Any]) -> None:
        materialized = await self._create_queued_handoff(queued_msg)
        if materialized is None:
            await self._requeue_next_message(queued_msg, mark_send_now=True)
            await session_registry.cancel_generation(self.chat_id)
            return
        user_message, assistant_message, checkpoint_id = materialized

        assert self._acp_session is not None
        handler = self._acp_session.handler
        if handler.has_pending_permissions:
            handler.cancel_pending_permissions()
        for event in handler.rotate_active_tools():
            event_dict = dict(event)
            kind = str(event_dict.pop("type", "tool_failed"))
            await self.emit_event(kind, event_dict)
            await self._flush_snapshot(force=False)

        duration_ms = await self._save_final_snapshot(
            self._stream_result, MessageStreamStatus.INTERRUPTED
        )
        await self._emit_queue_processing(
            queued_msg=queued_msg,
            user_message=user_message,
            assistant_message=assistant_message,
            checkpoint_id=checkpoint_id,
            prior_duration_ms=duration_ms,
        )
        logger.info(
            "Rotated live stream for steered message %s on chat %s "
            "(old assistant %s interrupted, continuing into %s)",
            queued_msg.get("id"),
            self.chat_id,
            self.assistant_message_id,
            assistant_message.id,
        )
        await self._start_rotated_stream(
            assistant_message_id=str(assistant_message.id),
            model_id=queued_msg["model_id"],
        )

    async def _emit_prompt_suggestions(self) -> None:
        raw = "".join(self.snapshot.text_parts)
        match = PROMPT_SUGGESTIONS_RE.search(raw)
        if not match:
            return
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, list):
                suggestions = [
                    s.strip() for s in parsed if isinstance(s, str) and s.strip()
                ]
                if suggestions:
                    await self.emit_event(
                        "prompt_suggestions", {"suggestions": suggestions}
                    )
        except json.JSONDecodeError:
            logger.warning("Failed to parse prompt suggestions JSON")

    @staticmethod
    def _cancel_task_if_running(
        task: asyncio.Task[Any] | None, fut: asyncio.Future[Any]
    ) -> None:
        if fut.cancelled():
            return
        if task and not task.done():
            task.cancel()

    async def _next_or_cancel(
        self, stream_iter: AsyncIterator[StreamEvent]
    ) -> StreamEvent | None:
        if not self._cancel_event:
            try:
                return await anext(stream_iter)
            except StopAsyncIteration:
                return None

        if self._cancel_event.is_set():
            self._cancelled = True
            return None

        current_task = asyncio.current_task()
        cancel_waiter = asyncio.ensure_future(self._cancel_event.wait())
        cancel_waiter.add_done_callback(
            partial(self._cancel_task_if_running, current_task)
        )
        try:
            return await anext(stream_iter)
        except StopAsyncIteration:
            return None
        except asyncio.CancelledError:
            if self._cancel_event.is_set():
                self._cancelled = True
                return None
            raise
        finally:
            cancel_waiter.cancel()

    async def emit_event(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        apply_snapshot: bool = True,
    ) -> int:
        if not self.assistant_message_id:
            return 0

        audit = {"payload": StreamEnvelope.sanitize_payload(payload)}
        if apply_snapshot and kind in SNAPSHOT_EVENT_KINDS:
            # ACP tool payloads are updated in place as progress arrives, so
            # buffered history needs its own copy or earlier events get rewritten
            # to the latest title/status before we flush them.
            frozen_payload = deepcopy(payload)
            self._event_buffer.append((kind, frozen_payload, audit))
            self.snapshot.add_event(kind, frozen_payload)
            self.pending_since_flush += 1
            return 0

        await self._flush_event_buffer()
        seq = await self.message_service.append_event_with_next_seq(
            chat_id=self.chat.id,
            message_id=UUID(self.assistant_message_id),
            stream_id=self.stream_id,
            event_type=kind,
            render_payload=payload,
            audit_payload=audit,
        )
        self.last_seq = seq
        await self._publish_to_redis([self._serialize_envelope(seq, kind, payload)])
        return seq

    async def _flush_event_buffer(self) -> None:
        if not self._event_buffer or not self.assistant_message_id:
            return
        batch = self._event_buffer
        seq = await self.message_service.append_events_batch(
            chat_id=self.chat.id,
            message_id=UUID(self.assistant_message_id),
            stream_id=self.stream_id,
            events=batch,
        )
        self._event_buffer = []
        self.last_seq = seq

        start_seq = seq - len(batch) + 1
        redis_events = [
            self._serialize_envelope(start_seq + i, kind, payload)
            for i, (kind, payload, _audit) in enumerate(batch)
        ]
        await self._publish_to_redis(redis_events)

    def _serialize_envelope(self, seq: int, kind: str, payload: dict[str, Any]) -> str:
        return StreamEnvelope.serialize(
            chat_id=self.chat.id,
            message_id=UUID(self.assistant_message_id),
            stream_id=self.stream_id,
            seq=seq,
            kind=kind,
            payload=payload,
        )

    async def _publish_to_redis(self, events: list[str]) -> None:
        # Envelopes carry chatId, so all of a user's streams share one channel —
        # the multiplexed SSE feed subscribes once and routes client-side.
        if not self.cache or not events:
            return
        channel = REDIS_KEY_USER_STREAMS_LIVE.format(user_id=self.chat.user_id)
        for raw in events:
            try:
                await self.cache.publish(channel, raw)
            except CacheError as exc:
                logger.warning(
                    "Failed to publish event for chat %s: %s",
                    self.chat_id,
                    exc,
                )

    async def _flush_snapshot(self, *, force: bool) -> None:
        # Debounce DB writes (max every 200ms or 24 events) for SSE catch-up freshness.
        if not self.assistant_message_id:
            return
        if not force:
            elapsed_ms = (time.monotonic() - self.last_flush_at) * 1000
            if self.pending_since_flush == 0:
                return
            if elapsed_ms < 200 and self.pending_since_flush < 24:
                return

        await self._flush_event_buffer()
        await self.message_service.update_message_snapshot(
            UUID(self.assistant_message_id),
            content_text=self.snapshot.content_text,
            content_render=self.snapshot.to_render(),
            last_seq=self.last_seq,
            active_stream_id=self.stream_id,
        )
        self.pending_since_flush = 0
        self.last_flush_at = time.monotonic()

    async def _save_final_snapshot(
        self,
        stream_result: StreamResult,
        stream_status: MessageStreamStatus,
    ) -> int | None:
        # Persist duration so the terminal event can carry it without a refetch.
        if not self.assistant_message_id:
            return None
        await self._flush_event_buffer()
        message = await self.message_service.update_message_snapshot(
            UUID(self.assistant_message_id),
            content_text=self.snapshot.content_text,
            content_render=self.snapshot.to_render(),
            last_seq=self.last_seq,
            active_stream_id=None,
            stream_status=stream_status,
            total_cost_usd=stream_result.total_cost_usd,
        )
        return message.duration_ms if message else None

    async def _complete_stream(
        self,
        stream_result: StreamResult,
        status: MessageStreamStatus,
    ) -> str:
        duration_ms = await self._save_final_snapshot(stream_result, status)
        final_content = self.snapshot.content_text

        if status == MessageStreamStatus.COMPLETED:
            # If there's a queued follow-up message, start it immediately in this
            # same background task chain — the "complete" event is deferred until
            # the entire queue is drained so the client stays in streaming mode.
            queue_processed = await self._process_next_queued(
                prior_duration_ms=duration_ms
            )
            if not queue_processed:
                await self._emit_context_usage(stream_result)
                await self.emit_event(
                    "complete",
                    {"status": "completed", "duration_ms": duration_ms},
                    apply_snapshot=False,
                )
        elif status == MessageStreamStatus.INTERRUPTED:
            # Close generator first so the old prompt_task finishes before the new prompt shares the handler.
            await self._close_stream()
            if await self._process_next_queued(
                send_now_only=True, prior_duration_ms=duration_ms
            ):
                session_registry.consume_pending_cancel(self.chat_id)
                return final_content
            await self._emit_context_usage(stream_result)
            await self.emit_event(
                "cancelled",
                {"status": status.value, "duration_ms": duration_ms},
                apply_snapshot=False,
            )
        else:
            await self._emit_context_usage(stream_result)
            await self.emit_event(
                "complete",
                {"status": status.value, "duration_ms": duration_ms},
                apply_snapshot=False,
            )

        return final_content

    async def _close_stream(self) -> None:
        stream = self._stream
        if stream is not None and hasattr(stream, "aclose"):
            self._stream = None
            await stream.aclose()

    async def _handle_session_update(self, payload: dict[str, Any]) -> None:
        new_session_id = payload.get("session_id")
        if not new_session_id:
            return
        if new_session_id == self.session_id:
            return
        self.session_id = new_session_id
        agent_kind = MODELS[self.model_id].agent_kind
        self.chat.session_id = new_session_id
        self.chat.session_agent_kind = agent_kind.value
        try:
            async with self.session_factory() as db:
                chat_uuid = UUID(self.chat_id)
                # Pin updated_at — session bookkeeping isn't unseen activity and
                # this task is fire-and-forget, so an onupdate bump could land
                # after the read stamp and falsely re-flag the chat unread.
                await db.execute(
                    update(Chat)
                    .where(Chat.id == chat_uuid)
                    .values(
                        session_id=new_session_id,
                        session_agent_kind=agent_kind.value,
                        updated_at=Chat.updated_at,
                    )
                )
                await db.commit()
        except (SQLAlchemyError, ValueError) as exc:
            logger.error("Failed to persist session update: %s", exc)

    @staticmethod
    def _on_session_update_done(task: asyncio.Task[None]) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            logger.error("Session update task failed: %s", exc)

    async def _process_next_queued(
        self,
        *,
        send_now_only: bool = False,
        prior_duration_ms: int | None = None,
    ) -> bool:
        next_msg: dict[str, Any] | None = None
        try:
            async with cache_connection() as cache:
                queue_service = QueueService(cache)
                next_msg = await queue_service.pop_send_now_message(self.chat_id)
                if not next_msg and not send_now_only:
                    next_msg = await queue_service.pop_next_message(self.chat_id)
        except CacheError as exc:
            logger.error(
                "Failed to read queued messages for chat %s: %s", self.chat_id, exc
            )
            return False

        if not next_msg:
            return False

        materialized = await self._create_queued_handoff(next_msg)
        if materialized is None:
            await self._requeue_next_message(next_msg)
            return False
        user_message, assistant_message, checkpoint_id = materialized

        try:
            await self._emit_queue_processing(
                queued_msg=next_msg,
                user_message=user_message,
                assistant_message=assistant_message,
                checkpoint_id=checkpoint_id,
                prior_duration_ms=prior_duration_ms,
            )
            user_service = UserService(session_factory=self.session_factory)
            user_settings = await user_service.get_user_settings(
                self.chat.user_id, db=None
            )
            ChatStreamRuntime.start_background_chat(
                self._build_queued_stream_request(
                    chat=self.chat,
                    queued_msg=next_msg,
                    user_settings=user_settings,
                    assistant_message_id=str(assistant_message.id),
                    session_id_override=self.session_id,
                )
            )
        except Exception as exc:
            logger.error("Failed to process queued message: %s", exc)
            await self._requeue_next_message(next_msg)
            return False

        logger.info(
            "Queued message %s for chat %s has been processed",
            next_msg["id"],
            self.chat_id,
        )
        return True

    async def _create_queued_handoff(
        self,
        queued_msg: dict[str, Any],
    ) -> tuple[Message, Message, UUID | None] | None:
        try:
            user_message = await self.message_service.create_message(
                UUID(self.chat_id),
                queued_msg["content"],
                MessageRole.USER,
                attachments=queued_msg.get("attachments"),
            )
            assistant_message = await self.message_service.create_message(
                UUID(self.chat_id),
                "",
                MessageRole.ASSISTANT,
                model_id=queued_msg["model_id"],
                stream_status=MessageStreamStatus.IN_PROGRESS,
            )
            # Avoid circular import with chat.py.
            from app.services.chat import ChatService

            checkpoint_id = await ChatService.create_checkpoint_for_message(
                self.chat,
                assistant_message.id,
                self.session_factory,
                queued_msg["worktree"],
            )
            return user_message, assistant_message, checkpoint_id
        except Exception as exc:
            logger.error("Failed to materialize queued message: %s", exc)
            return None

    async def _emit_queue_processing(
        self,
        *,
        queued_msg: dict[str, Any],
        user_message: Message,
        assistant_message: Message,
        checkpoint_id: UUID | None,
        prior_duration_ms: int | None,
    ) -> None:
        await self.emit_event(
            "queue_processing",
            {
                "queued_message_id": queued_msg["id"],
                "user_message_id": str(user_message.id),
                "assistant_message_id": str(assistant_message.id),
                "checkpoint_id": str(checkpoint_id) if checkpoint_id else None,
                "content": queued_msg["content"],
                "model_id": queued_msg["model_id"],
                "attachments": MessageService.serialize_attachments(
                    queued_msg, user_message
                ),
                # The prior turn's terminal event is suppressed during a queue
                # handoff, so ship its persisted duration here for the rollup.
                "prior_duration_ms": prior_duration_ms,
            },
            apply_snapshot=False,
        )

    async def _start_message_stream(self) -> None:
        self._start_seq = await self.emit_event(
            "stream_started",
            {"status": "started"},
            apply_snapshot=False,
        )
        if self.assistant_message_id:
            await self.message_service.update_message_snapshot(
                UUID(self.assistant_message_id),
                content_text="",
                content_render=self.snapshot.to_render(),
                last_seq=self._start_seq,
                active_stream_id=self.stream_id,
            )
        # Emit worktree_cwd up front so mid-turn actions target the worktree.
        if self.chat.worktree_cwd:
            await self.emit_event(
                "system",
                {"data": {"worktree_cwd": self.chat.worktree_cwd}},
            )

    async def _start_rotated_stream(
        self, *, assistant_message_id: str, model_id: str
    ) -> None:
        self.assistant_message_id = assistant_message_id
        self.model_id = model_id
        self.context_window = MODELS[model_id].context_window
        self.stream_id = uuid4()
        self.snapshot = StreamSnapshotAccumulator()
        self.last_seq = 0
        self.pending_since_flush = 0
        self.last_flush_at = time.monotonic()
        self._event_buffer = []
        self._stream_result = StreamResult()
        self._last_emitted_tokens = 0
        self._last_emitted_context_window = 0

        await self._start_message_stream()

    async def _requeue_next_message(
        self, queued_msg: dict[str, Any], *, mark_send_now: bool = False
    ) -> None:
        try:
            async with cache_connection() as cache:
                queue_service = QueueService(cache)
                if mark_send_now:
                    await queue_service.restore_send_now(self.chat_id, queued_msg)
                else:
                    await queue_service.requeue_message(self.chat_id, queued_msg)
        except Exception as requeue_exc:
            logger.error("Failed to re-queue message: %s", requeue_exc)

    async def _emit_context_usage(self, stream_result: StreamResult) -> None:
        usage = stream_result.usage
        if not usage or not self.cache:
            return

        token_usage: int = usage["input_tokens"]
        context_window: int = usage.get("context_window") or self.context_window or 0
        if token_usage <= 0 or (
            token_usage == self._last_emitted_tokens
            and context_window == self._last_emitted_context_window
        ):
            return
        self._last_emitted_tokens = token_usage
        self._last_emitted_context_window = context_window
        percentage = (
            min((token_usage / context_window) * 100, 100.0)
            if context_window > 0
            else 0.0
        )
        context_data: dict[str, Any] = {
            "tokens_used": token_usage,
            "context_window": context_window,
            "percentage": percentage,
        }

        try:
            async with self.session_factory() as db:
                # Pin updated_at — usage accounting isn't unseen activity, and on
                # local cancel this write lands after the client's read stamp,
                # so an onupdate bump would falsely re-flag the chat unread.
                await db.execute(
                    update(Chat)
                    .where(Chat.id == self.chat.id)
                    .values(
                        context_token_usage=token_usage,
                        updated_at=Chat.updated_at,
                    )
                )
                await db.commit()

            await self.cache.setex(
                REDIS_KEY_CHAT_CONTEXT_USAGE.format(chat_id=self.chat_id),
                settings.CONTEXT_USAGE_CACHE_TTL_SECONDS,
                json.dumps(context_data),
            )

            if self.assistant_message_id:
                await self.emit_event(
                    "system",
                    {"context_usage": context_data, "chat_id": self.chat_id},
                    apply_snapshot=False,
                )
        except (SQLAlchemyError, CacheError) as exc:
            logger.debug(
                "Context usage update failed for chat %s: %s", self.chat_id, exc
            )

    async def _generate_title(self) -> None:
        if not self.prompt or not self._is_new_chat:
            return

        ai_service = AgentService(session_factory=self.session_factory)
        user = User(id=self.chat.user_id)
        title = await ai_service.generate_title(self.prompt, user, chat=self.chat)
        if not title:
            return
        title = title[:255]

        async with self.session_factory() as db:
            # Pin updated_at — this task races past stream completion, and the
            # onupdate bump would re-flag a just-watched chat unread; a backfilled
            # title isn't unseen activity.
            await db.execute(
                update(Chat)
                .where(Chat.id == self.chat.id)
                .values(title=title, updated_at=Chat.updated_at)
            )
            await db.commit()

        # Avoid circular import with chat.py.
        from app.services.chat import ChatService

        # Push the title to open sessions so the sidebar/tab update mid-stream
        # instead of waiting for the completion refetch.
        await ChatService.publish_user_chat_event(
            self.chat.user_id,
            {"kind": "title_updated", "chat_id": self.chat_id, "title": title},
        )

    @staticmethod
    def _on_title_task_done(task: asyncio.Task[None]) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            logger.error("Background title generation failed: %s", exc)

    @classmethod
    async def stop_background_chats(cls) -> None:
        if not cls._background_task_chat_ids:
            return

        timeout = max(settings.BACKGROUND_CHAT_SHUTDOWN_TIMEOUT_SECONDS, 0.0)
        running_tasks = [
            task for task in cls._background_task_chat_ids if not task.done()
        ]

        if not running_tasks:
            return

        logger.info(
            "Waiting for %s background chat task(s) to finish",
            len(running_tasks),
        )

        _, pending = await asyncio.wait(running_tasks, timeout=timeout)

        if pending:
            logger.warning(
                "Cancelled %s background chat task(s) after %.1fs shutdown timeout",
                len(pending),
                timeout,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        cls._prune_done_tasks()

    @classmethod
    def _prune_done_tasks(cls) -> None:
        finished_tasks = [
            task for task in list(cls._background_task_chat_ids) if task.done()
        ]
        for task in finished_tasks:
            cls._background_task_chat_ids.pop(task, None)

    @staticmethod
    def _is_transport_fatal(exc: BaseException) -> bool:
        # Walk the exception chain to decide if the session's transport is broken
        # (ConnectionError, OSError) vs. a recoverable application-level error.
        # Transport-fatal errors trigger session teardown so the next request
        # creates a fresh connection instead of reusing a dead one.
        current: BaseException | None = exc
        while current is not None:
            if isinstance(current, asyncio.CancelledError):
                return False
            if isinstance(current, TRANSPORT_FATAL_TYPES):
                return True
            current = current.__cause__ or current.__context__
        return False

    @classmethod
    def has_active_chat(cls, chat_id: str) -> bool:
        cls._prune_done_tasks()
        return chat_id in cls._background_task_chat_ids.values()

    @classmethod
    async def try_steer_send_now(
        cls,
        *,
        chat_id: str,
        queued_message_id: str,
        queue_service: QueueService,
        session_factory: SessionFactoryType,
    ) -> bool:
        if chat_id in cls._steering_chats:
            logger.info("Steering already in flight for chat %s", chat_id)
            return True
        cls._steering_chats.add(chat_id)
        try:
            logger.info(
                "Steer attempt for chat %s (send-now message %s)",
                chat_id,
                queued_message_id,
            )
            runtime = cls._active_runtimes.get(chat_id)
            session = session_registry.get(chat_id)
            skip_reason: str | None = None
            if runtime is None:
                skip_reason = "no active runtime in this process"
            elif session is None:
                skip_reason = "no registered ACP session"
            elif runtime._acp_session is not session.acp_session:
                skip_reason = "runtime is bound to a different ACP session"
            elif not session.acp_session.is_alive():
                skip_reason = "ACP agent process is not alive"
            elif not session.acp_session.steering_supported:
                skip_reason = "adapter did not advertise steering support"
            elif session.acp_session.handler.has_pending_permissions:
                skip_reason = "a permission prompt is pending"
            if skip_reason is not None:
                logger.info(
                    "Steering skipped for chat %s: %s — using legacy send-now",
                    chat_id,
                    skip_reason,
                )
                return False

            queued_msg = await queue_service.get_message_by_id(
                chat_id, queued_message_id
            )
            if not queued_msg:
                logger.info(
                    "Send-now message %s for chat %s was already claimed or deleted",
                    queued_message_id,
                    chat_id,
                )
                return True
            if queued_msg["model_id"] != runtime.model_id:
                logger.info(
                    "Steering skipped for chat %s: queued model %s != running model %s"
                    " — using legacy send-now",
                    chat_id,
                    queued_msg["model_id"],
                    runtime.model_id,
                )
                return False

            user_service = UserService(session_factory=session_factory)
            user_settings = await user_service.get_user_settings(
                runtime.chat.user_id, db=None
            )
            queued_request = cls._build_queued_stream_request(
                chat=runtime.chat,
                queued_msg=queued_msg,
                user_settings=user_settings,
                assistant_message_id="",
                session_id_override=runtime.session_id,
            )
            ai_service = AgentService(session_factory=session_factory)
            config = await ai_service.build_session_config(
                user=User(id=runtime.chat.user_id),
                chat=runtime.chat,
                model_id=queued_request.model_id,
                permission_mode=queued_request.permission_mode,
                session_id=queued_request.session_id,
                thinking_mode=queued_request.thinking_mode,
                system_prompt=queued_request.system_prompt,
                worktree=queued_request.worktree,
                selected_persona_name=queued_request.selected_persona_name,
                fast_mode=queued_request.fast_mode,
            )
            fingerprint_matches = (
                session_registry.compute_fingerprint(config) == session.fingerprint
            )
            if (
                not fingerprint_matches
                or config.permission_mode != session.current_mode
                or config.fast_mode != session.current_fast_mode
            ):
                logger.info(
                    "Steering skipped for chat %s: settings differ from running turn "
                    "(fingerprint_match=%s, mode %r vs %r, fast_mode %s vs %s, "
                    "model %s, effort %r) — using legacy send-now",
                    chat_id,
                    fingerprint_matches,
                    config.permission_mode,
                    session.current_mode,
                    config.fast_mode,
                    session.current_fast_mode,
                    config.model,
                    config.reasoning_effort,
                )
                return False

            claimed_msg = await queue_service.pop_message_by_id(
                chat_id, queued_message_id
            )
            if claimed_msg is None:
                logger.info(
                    "Send-now message %s for chat %s was concurrently claimed or deleted",
                    queued_message_id,
                    chat_id,
                )
                return True

            content = AgentService.prepare_user_prompt(
                claimed_msg["content"], queued_request.custom_instructions
            )
            try:
                async with asyncio.timeout(STEER_ACCEPT_TIMEOUT_SECONDS):
                    outcome = await session.acp_session.steer(
                        content,
                        attachments=claimed_msg.get("attachments"),
                        agent_kind=config.agent_kind,
                    )
            except asyncio.CancelledError:
                await queue_service.restore_send_now(chat_id, claimed_msg)
                raise
            except Exception:
                logger.warning(
                    "ACP steering failed for chat %s", chat_id, exc_info=True
                )
                await queue_service.restore_send_now(chat_id, claimed_msg)
                return False

            if outcome == "injected":
                current_runtime = cls._active_runtimes.get(chat_id)
                # Events already queued stay old. The response precedes steered output
                # on the wire, leaving only one task-switch window for pre-steer tail
                # output; ACP provides no stronger boundary marker.
                delivered = (
                    current_runtime is runtime
                    and session.acp_session.handler.enqueue_steer_rotation(claimed_msg)
                )
                if delivered:
                    logger.info(
                        "Steered send-now message %s into live ACP turn for chat %s",
                        queued_message_id,
                        chat_id,
                    )
                    return True
                logger.warning(
                    "ACP steer rotation could not be delivered for chat %s", chat_id
                )
                await queue_service.restore_send_now(chat_id, claimed_msg)
                await session.acp_session.cancel()
                return False

            if outcome == "startedNewTurn":
                await queue_service.restore_send_now(chat_id, claimed_msg)
                await session.acp_session.cancel()
                return False

            logger.warning(
                "ACP steering returned %s for chat %s; using cancel fallback",
                outcome,
                chat_id,
            )
            await queue_service.restore_send_now(chat_id, claimed_msg)
            return False
        finally:
            cls._steering_chats.discard(chat_id)

    @classmethod
    def active_chat_ids(cls) -> set[str]:
        cls._prune_done_tasks()
        return set(cls._background_task_chat_ids.values())

    @classmethod
    def _on_background_task_done(cls, chat_id: str, task: asyncio.Task[str]) -> None:
        try:
            if task.cancelled():
                return
            try:
                error = task.exception()
            except Exception:
                logger.exception(
                    "Failed to inspect in-process chat task result for chat %s",
                    chat_id,
                )
                return
            if error:
                logger.error(
                    "In-process chat task for chat %s failed: %s",
                    chat_id,
                    error,
                    exc_info=error,
                )
        finally:
            cls._background_task_chat_ids.pop(task, None)

    @classmethod
    def start_background_chat(
        cls,
        request: ChatStreamRequest,
    ) -> None:
        chat_id = str(request.chat_data["id"])
        background_task = asyncio.create_task(
            cls._bootstrap_and_execute(
                request=request,
            )
        )
        cls._background_task_chat_ids[background_task] = chat_id
        background_task.add_done_callback(
            partial(cls._on_background_task_done, chat_id)
        )

    @staticmethod
    def _build_queued_stream_request(
        *,
        chat: Chat,
        queued_msg: dict[str, Any],
        user_settings: UserSettings,
        assistant_message_id: str,
        session_id_override: str | None = None,
    ) -> ChatStreamRequest:
        # Queue items come from QueueService.add_message, so all behavioral
        # fields must already exist here.
        selected_persona_name = queued_msg["selected_persona_name"]
        model = MODELS[queued_msg["model_id"]]
        system_prompt = build_system_prompt_for_chat(
            user_settings,
            agent_kind=model.agent_kind,
            selected_persona_name=selected_persona_name,
        )
        context_window = model.context_window
        resolved_session_id = session_id_override or chat.session_id
        return ChatStreamRequest(
            prompt=queued_msg["content"],
            system_prompt=system_prompt,
            custom_instructions=user_settings.custom_instructions,
            chat_data={
                "id": str(chat.id),
                "user_id": str(chat.user_id),
                "title": chat.title,
                "workspace_id": str(chat.workspace_id),
                "sandbox_id": chat.sandbox_id,
                "workspace_path": chat.workspace_path,
                "sandbox_provider": chat.sandbox_provider,
                "session_id": resolved_session_id,
                "session_agent_kind": chat.session_agent_kind,
                "worktree_cwd": chat.worktree_cwd,
            },
            permission_mode=queued_msg["permission_mode"],
            model_id=queued_msg["model_id"],
            context_window=context_window,
            session_id=resolved_session_id,
            assistant_message_id=assistant_message_id,
            thinking_mode=queued_msg["thinking_mode"],
            worktree=queued_msg["worktree"],
            # Older queue entries predate fast_mode.
            fast_mode=queued_msg.get("fast_mode", False),
            attachments=queued_msg["attachments"],
            selected_persona_name=selected_persona_name,
        )

    @classmethod
    async def process_send_now_idle(
        cls,
        chat_id: str,
        session_factory: SessionFactoryType,
    ) -> bool:
        if cls.has_active_chat(chat_id):
            return False

        async with cache_connection() as cache:
            queue_service = QueueService(cache)
            queued_msg = await queue_service.pop_send_now_message(chat_id)
            if not queued_msg:
                return False

        try:
            message_service = MessageService(session_factory=session_factory)
            await message_service.create_message(
                UUID(chat_id),
                queued_msg["content"],
                MessageRole.USER,
                attachments=queued_msg.get("attachments"),
            )
            assistant_message = await message_service.create_message(
                UUID(chat_id),
                "",
                MessageRole.ASSISTANT,
                model_id=queued_msg["model_id"],
                stream_status=MessageStreamStatus.IN_PROGRESS,
            )

            async with session_factory() as db:
                result = await db.execute(
                    select(Chat)
                    .options(selectinload(Chat.workspace))
                    .filter(Chat.id == UUID(chat_id))
                )
                chat = result.scalar_one_or_none()
                if not chat:
                    raise AgentException(f"Chat {chat_id} not found for idle send-now")

            # Avoid circular import with chat.py.
            from app.services.chat import ChatService

            await ChatService.create_checkpoint_for_message(
                chat,
                assistant_message.id,
                session_factory,
                queued_msg["worktree"],
            )

            user_service = UserService(session_factory=session_factory)
            user_settings = await user_service.get_user_settings(chat.user_id, db=None)
            cls.start_background_chat(
                cls._build_queued_stream_request(
                    chat=chat,
                    queued_msg=queued_msg,
                    user_settings=user_settings,
                    assistant_message_id=str(assistant_message.id),
                )
            )

            logger.info(
                "Idle send-now: message %s started for chat %s",
                queued_msg["id"],
                chat_id,
            )
            return True

        except Exception:
            await cls._requeue_idle_message(chat_id=chat_id, queued_msg=queued_msg)
            raise

    @staticmethod
    async def _requeue_idle_message(chat_id: str, queued_msg: dict[str, Any]) -> None:
        try:
            async with cache_connection() as cache:
                queue_service = QueueService(cache)
                await queue_service.requeue_message(chat_id, queued_msg)
                logger.info(
                    "Re-queued message %s after idle send-now failure",
                    queued_msg["id"],
                )
        except Exception as requeue_exc:
            logger.error("Failed to re-queue message: %s", requeue_exc)

    @staticmethod
    async def mark_message_failed(
        *,
        assistant_message_id: str | None,
        session_factory: SessionFactoryType,
        stream_status: MessageStreamStatus,
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
            if not message or message.stream_status != MessageStreamStatus.IN_PROGRESS:
                return
            await message_service.update_message_snapshot(
                message_uuid,
                content_text=message.content_text,
                content_render=message.content_render,
                last_seq=message.last_seq,
                active_stream_id=None,
                stream_status=stream_status,
            )
        except Exception:
            logger.exception(
                "Failed to update assistant message %s to %s after bootstrap failure",
                assistant_message_id,
                stream_status.value,
            )

    @staticmethod
    async def emit_bootstrap_error(
        *,
        chat_id: str,
        user_id: str,
        assistant_message_id: str | None,
        session_factory: SessionFactoryType,
        error_message: str,
    ) -> None:
        if not assistant_message_id:
            return
        try:
            message_service = MessageService(session_factory=session_factory)
            message = await message_service.get_message(UUID(assistant_message_id))
            if not message:
                return
            stream_id = uuid4()
            payload = {"error": error_message}
            error_seq = await message_service.append_event_with_next_seq(
                chat_id=UUID(chat_id),
                message_id=UUID(assistant_message_id),
                stream_id=stream_id,
                event_type="error",
                render_payload=payload,
                audit_payload={"payload": payload},
            )
            async with cache_connection() as cache:
                channel = REDIS_KEY_USER_STREAMS_LIVE.format(user_id=user_id)
                envelope = StreamEnvelope.serialize(
                    chat_id=UUID(chat_id),
                    message_id=UUID(assistant_message_id),
                    stream_id=stream_id,
                    seq=error_seq,
                    kind="error",
                    payload=payload,
                )
                await cache.publish(channel, envelope)
            existing_render = message.content_render
            render_events = list(existing_render.get("events", []))
            render_events.append(
                {"type": "assistant_text", "text": f"\n\nError: {error_message}"}
            )
            content_text = message.content_text
            if not content_text:
                content_text = error_message
            await message_service.update_message_snapshot(
                UUID(assistant_message_id),
                content_text=content_text,
                content_render={**existing_render, "events": render_events},
                last_seq=error_seq,
                active_stream_id=None,
                stream_status=MessageStreamStatus.FAILED,
            )
        except Exception as inner_exc:
            logger.error(
                "Failed to emit bootstrap error for chat %s: %s",
                chat_id,
                inner_exc,
            )
            await ChatStreamRuntime.mark_message_failed(
                assistant_message_id=assistant_message_id,
                session_factory=session_factory,
                stream_status=MessageStreamStatus.FAILED,
            )

    @classmethod
    async def execute_chat(
        cls,
        *,
        request: ChatStreamRequest,
        session_factory: SessionFactoryType,
    ) -> str:
        runtime = cls(
            request=request,
            session_factory=session_factory,
        )
        async with cache_connection() as cache:
            runtime.cache = cache

            ai_service = AgentService(session_factory=runtime.session_factory)
            user = User(id=runtime.chat.user_id)

            config: AcpSessionConfig = await ai_service.build_session_config(
                user=user,
                chat=runtime.chat,
                model_id=request.model_id,
                permission_mode=request.permission_mode,
                session_id=request.session_id,
                thinking_mode=request.thinking_mode,
                system_prompt=request.system_prompt,
                worktree=request.worktree,
                selected_persona_name=request.selected_persona_name,
                fast_mode=request.fast_mode,
            )

            session, _ = await session_registry.get_or_create(
                chat_id=runtime.chat_id,
                config=config,
            )
            await runtime._handle_session_update(
                {"session_id": session.acp_session.acp_session_id}
            )

            session.cancel_event.clear()
            if session_registry.consume_pending_cancel(runtime.chat_id):
                session.cancel_event.set()
            runtime._cancel_event = session.cancel_event
            runtime._acp_session = session.acp_session
            cls._active_runtimes[runtime.chat_id] = runtime
            session.active_generation_task = asyncio.current_task()
            stream: AsyncIterator[StreamEvent] | None = None
            try:
                session_updates: list[Any] = []
                if config.model and config.model != session.current_model:
                    session_updates.append(
                        session.acp_session.set_model(
                            config.model, config.reasoning_effort
                        )
                    )
                if (
                    config.permission_mode
                    and config.permission_mode != session.current_mode
                ):
                    session_updates.append(
                        session.acp_session.set_mode(config.permission_mode)
                    )
                if config.fast_mode != session.current_fast_mode:
                    session_updates.append(
                        session.acp_session.set_fast_mode(config.fast_mode)
                    )
                if session_updates:
                    await asyncio.gather(*session_updates)
                if config.model:
                    session.current_model = config.model
                if config.permission_mode:
                    session.current_mode = config.permission_mode
                session.current_fast_mode = config.fast_mode

                stream_result = StreamResult()
                stream = ai_service.stream_response(
                    session=session.acp_session,
                    prompt=request.prompt,
                    custom_instructions=request.custom_instructions,
                    result=stream_result,
                    agent_kind=config.agent_kind,
                    attachments=request.attachments,
                )
                return await runtime.run(stream_result, stream)
            except (
                AgentException,
                asyncio.CancelledError,
            ) as exc:
                if cls._is_transport_fatal(exc):
                    session.active_generation_task = None
                    await session_registry.terminate(runtime.chat_id)
                raise
            except Exception:
                session.active_generation_task = None
                await session_registry.terminate(runtime.chat_id)
                raise
            finally:
                if cls._active_runtimes.get(runtime.chat_id) is runtime:
                    cls._active_runtimes.pop(runtime.chat_id, None)
                await runtime._close_stream()
                session.active_generation_task = None
                session.last_used_at = time.monotonic()

    @classmethod
    async def _bootstrap_and_execute(
        cls,
        *,
        request: ChatStreamRequest,
    ) -> str:
        session_factory = SessionLocal
        chat_id = str(request.chat_data["id"])
        try:
            return await cls.execute_chat(
                request=request,
                session_factory=session_factory,
            )
        except asyncio.CancelledError:
            await cls.mark_message_failed(
                assistant_message_id=request.assistant_message_id,
                session_factory=session_factory,
                stream_status=MessageStreamStatus.INTERRUPTED,
            )
            raise
        except Exception as exc:
            error_data = getattr(exc, "data", None)
            error_code = getattr(exc, "code", None)
            logger.error(
                "Chat bootstrap failed for %s: %s (code=%s, data=%s)",
                chat_id,
                exc,
                error_code,
                error_data,
                exc_info=True,
            )
            await cls.emit_bootstrap_error(
                chat_id=chat_id,
                user_id=str(request.chat_data["user_id"]),
                assistant_message_id=request.assistant_message_id,
                session_factory=session_factory,
                error_message=str(exc),
            )
            raise
        finally:
            session_registry.consume_pending_cancel(chat_id)
