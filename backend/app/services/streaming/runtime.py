from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager, suppress
from copy import deepcopy
from collections.abc import AsyncIterator, Awaitable, Callable
from functools import partial
from typing import Any, cast
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
from app.models.db_models.chat import Chat, ChatCheckpoint, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User, UserSettings
from app.models.types import MessageAttachmentDict
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.acp.session import AcpSessionConfig
from app.services.agent import (
    AgentService,
    StreamResult,
)
from app.services.session_registry import session_registry
from app.services.db import SessionFactoryType
from app.services.exceptions import AgentException, SandboxException
from app.services.git import GitService
from app.services.message import MessageService
from app.services.queue import QueueService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.base import SandboxProvider
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
    # Single-process state: turn gating and reconcile assume the one uvicorn
    # worker in entrypoint.sh. Scaling out needs Redis-side gating first.
    _background_task_chat_ids: dict[asyncio.Task[str], str] = {}
    # Reserved before the background task registers — closes the double-send
    # window. The event fires when the reservation is released.
    _starting_chat_ids: dict[str, asyncio.Event] = {}

    @classmethod
    @asynccontextmanager
    async def chat_start_slot(cls, chat_id: str) -> AsyncIterator[bool]:
        # One turn per chat — concurrent turns would share and corrupt the ACP
        # session. No awaits before the yield, so check-and-reserve is atomic.
        reserved = chat_id not in cls._starting_chat_ids and not cls.has_active_chat(
            chat_id
        )
        if reserved:
            cls._starting_chat_ids[chat_id] = asyncio.Event()
        try:
            yield reserved
        finally:
            if reserved:
                cls._starting_chat_ids.pop(chat_id).set()

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

    async def run(
        self,
        stream_result: StreamResult,
        stream: AsyncIterator[StreamEvent],
    ) -> str:
        self._stream = stream
        # Titling only needs the user's prompt, so it starts alongside the turn
        # instead of after it — the sidebar shows a real title while streaming.
        title_task = asyncio.create_task(self._generate_title())
        self._bg_tasks.add(title_task)
        title_task.add_done_callback(self._bg_tasks.discard)
        title_task.add_done_callback(ChatStreamRuntime._on_title_task_done)
        try:
            start_seq = await self.emit_event(
                "stream_started",
                {"status": "started"},
                apply_snapshot=False,
            )
            if self.assistant_message_id:
                await self.message_service.update_message_snapshot(
                    UUID(self.assistant_message_id),
                    content_text="",
                    content_render=self.snapshot.to_render(),
                    last_seq=start_seq,
                    active_stream_id=self.stream_id,
                )
            # Emit worktree_cwd up front so the frontend can patch the chat
            # cache mid-turn; without this, branch/diff/editor actions during
            # the turn would target the workspace root until end-of-stream
            # invalidation refetches the chat.
            if self.chat.worktree_cwd:
                await self.emit_event(
                    "system",
                    {"data": {"worktree_cwd": self.chat.worktree_cwd}},
                )
            await self._consume_stream(stream_result, stream)
            await self._emit_prompt_suggestions()

            if self._cancelled:
                return await self._complete_stream(
                    stream_result, MessageStreamStatus.INTERRUPTED
                )

            # Buffered events may not have flushed yet (debounce) — a fast turn
            # can finish with last_seq still at start_seq, so check the buffer
            # too before declaring the stream empty.
            if self.last_seq <= start_seq and not self._event_buffer:
                # Cancel/send-now may have arrived after the last event was
                # consumed but before _consume_stream returned — the stream
                # ended naturally (via StopAsyncIteration) so CancelledError
                # never fired. Treat as interrupted rather than erroring.
                if self._cancel_event and self._cancel_event.is_set():
                    return await self._complete_stream(
                        stream_result, MessageStreamStatus.INTERRUPTED
                    )
                raise AgentException("Stream completed without any events")

            return await self._complete_stream(
                stream_result, MessageStreamStatus.COMPLETED
            )

        except Exception as exc:
            logger.error("Error in stream processing: %s", exc)
            # Snapshot first — it prunes the event log — then the terminal
            # event so it survives replay.
            self.snapshot.add_error(str(exc))
            await self._save_final_snapshot(stream_result, MessageStreamStatus.FAILED)
            await self.emit_event(
                "error",
                {"error": str(exc)},
                apply_snapshot=False,
            )
            raise

    async def _consume_stream(
        self,
        stream_result: StreamResult,
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
                    stream_result.usage = (
                        usage_data if isinstance(usage_data, dict) else None
                    )
                    await self._emit_context_usage(stream_result)
                else:
                    await self.emit_event(kind, payload)
                    await self._flush_snapshot(force=False)
        except asyncio.CancelledError:
            if not (self._cancel_event and self._cancel_event.is_set()):
                raise
            self._cancelled = True

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
        self, *, send_now_only: bool = False, prior_duration_ms: int | None = None
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

        try:
            await self._start_queued_turn(
                chat=self.chat,
                queued_msg=next_msg,
                message_service=self.message_service,
                session_factory=self.session_factory,
                session_id_override=self.session_id,
                before_handoff=partial(
                    self._emit_queue_processing, next_msg, prior_duration_ms
                ),
            )
        except Exception as exc:
            logger.error("Failed to process queued message: %s", exc)
            await self._requeue_message_quietly(self.chat_id, next_msg)
            return False

        logger.info(
            "Queued message %s for chat %s has been processed",
            next_msg["id"],
            self.chat_id,
        )
        return True

    async def _emit_queue_processing(
        self,
        queued_msg: dict[str, Any],
        prior_duration_ms: int | None,
        user_message: Message,
        assistant_message: Message,
        checkpoint_id: UUID | None,
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
                # The terminal is suppressed during handoff — ship the duration here.
                "prior_duration_ms": prior_duration_ms,
            },
            apply_snapshot=False,
        )

    @staticmethod
    async def create_checkpoint_for_message(
        chat: Chat,
        assistant_message_id: UUID,
        session_factory: SessionFactoryType,
        worktree: bool,
        base_branch: str | None = None,
    ) -> UUID | None:
        # Best-effort: a non-git workspace must not block the agent run.
        sandbox_id = chat.sandbox_id
        if not sandbox_id:
            return None

        try:
            # Resolve the same cwd the agent turn runs in, so the checkpoint's
            # diff and restore target match where the agent actually edited.
            cwd = await AgentService(session_factory=session_factory).resolve_cwd(
                chat, worktree, base_branch
            )
            provider = SandboxProvider.create_provider(
                chat.sandbox_provider, workspace_path=chat.workspace_path
            )
            checkpoint = await GitService(SandboxService(provider)).create_checkpoint(
                sandbox_id, cwd
            )
            if checkpoint is None:
                return None

            async with session_factory() as db:
                checkpoint_row = ChatCheckpoint(
                    chat_id=chat.id,
                    assistant_message_id=assistant_message_id,
                    cwd=cwd,
                    base_head=checkpoint.base_head,
                    pre_run_diff=checkpoint.pre_run_diff,
                )
                db.add(checkpoint_row)
                await db.commit()
                await db.refresh(checkpoint_row)
                return cast(UUID, checkpoint_row.id)
        except (SandboxException, SQLAlchemyError, TimeoutError, ValueError) as exc:
            logger.warning(
                "Failed to create checkpoint for message %s: %s",
                assistant_message_id,
                exc,
            )
            return None

    @classmethod
    @asynccontextmanager
    async def turn_scaffold(
        cls,
        message_service: MessageService,
        chat: Chat,
        *,
        prompt: str,
        model_id: str,
        attachments: list[MessageAttachmentDict] | None,
        worktree: bool,
        base_branch: str | None,
        session_factory: SessionFactoryType,
    ) -> AsyncIterator[tuple[Message, Message, UUID | None]]:
        # A turn that fails to start leaves no rows behind.
        user_message = None
        assistant_message = None
        try:
            chat_uuid = UUID(str(chat.id))
            user_message = await message_service.create_message(
                chat_uuid,
                prompt,
                MessageRole.USER,
                attachments=attachments,
            )
            assistant_message = await message_service.create_message(
                chat_uuid,
                "",
                MessageRole.ASSISTANT,
                model_id=model_id,
                stream_status=MessageStreamStatus.IN_PROGRESS,
            )
            checkpoint_id = await cls.create_checkpoint_for_message(
                chat,
                assistant_message.id,
                session_factory,
                worktree,
                base_branch,
            )
            yield user_message, assistant_message, checkpoint_id
        except Exception as exc:
            logger.error("Turn failed to start for chat %s: %s", chat.id, exc)
            for message in (assistant_message, user_message):
                if message is not None:
                    await message_service.discard_message_quietly(message.id)
            raise

    @classmethod
    async def _start_queued_turn(
        cls,
        *,
        chat: Chat,
        queued_msg: dict[str, Any],
        message_service: MessageService,
        session_factory: SessionFactoryType,
        session_id_override: str | None = None,
        before_handoff: Callable[[Message, Message, UUID | None], Awaitable[None]]
        | None = None,
    ) -> None:
        if queued_msg["model_id"] not in MODELS:
            raise AgentException(
                f"Queued message has unknown model {queued_msg['model_id']}"
            )
        user_settings = await UserService(
            session_factory=session_factory
        ).get_user_settings(chat.user_id, db=None)
        async with cls.turn_scaffold(
            message_service,
            chat,
            prompt=queued_msg["content"],
            model_id=queued_msg["model_id"],
            attachments=queued_msg.get("attachments"),
            worktree=queued_msg["worktree"],
            base_branch=queued_msg.get("base_branch"),
            session_factory=session_factory,
        ) as (user_message, assistant_message, checkpoint_id):
            request = cls._build_queued_stream_request(
                chat=chat,
                queued_msg=queued_msg,
                user_settings=user_settings,
                assistant_message_id=str(assistant_message.id),
                session_id_override=session_id_override,
            )
            # The client repoints on this event — nothing fallible may follow it.
            if before_handoff is not None:
                await before_handoff(user_message, assistant_message, checkpoint_id)
            cls.start_background_chat(request)

    @staticmethod
    async def _requeue_message_quietly(
        chat_id: str, queued_msg: dict[str, Any]
    ) -> None:
        try:
            async with cache_connection() as cache:
                await QueueService(cache).requeue_message(chat_id, queued_msg)
                logger.info("Re-queued message %s after failed start", queued_msg["id"])
        except Exception as exc:
            logger.error("Failed to re-queue message: %s", exc)

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
    async def reconcile_orphaned_messages(
        cls, session_factory: SessionFactoryType
    ) -> None:
        # In-progress messages from a previous process can never complete.
        try:
            async with session_factory() as db:
                result = await db.execute(
                    select(Message.id).where(
                        Message.stream_status == MessageStreamStatus.IN_PROGRESS,
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
    def has_pending_start(cls, chat_id: str) -> bool:
        return chat_id in cls._starting_chat_ids

    @classmethod
    def _chat_tasks(cls, chat_id: str) -> set[asyncio.Task[str]]:
        return {
            task
            for task, task_chat_id in cls._background_task_chat_ids.items()
            if task_chat_id == chat_id and not task.done()
        }

    @classmethod
    async def cancel_chat_turn(cls, chat_id: str, timeout: float) -> None:
        # Hold the response until the cancelled turn unwinds (a resend would 409).
        # Capture first — the unwind can start a successor we must not wait on.
        reservation = cls._starting_chat_ids.get(chat_id)
        tasks = cls._chat_tasks(chat_id)
        # Idle chats must not cancel — a stray pending-cancel flag could kill the next turn.
        if reservation is None and not tasks:
            return
        await session_registry.cancel_generation(chat_id)
        if reservation is not None:
            # The reserved turn's task registers before the reservation frees.
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(reservation.wait(), timeout)
            tasks |= cls._chat_tasks(chat_id)
        tasks = {task for task in tasks if not task.done()}
        if not tasks:
            return
        # asyncio.wait leaves the tasks running on timeout.
        await asyncio.wait(tasks, timeout=timeout)

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
            base_branch=queued_msg.get("base_branch"),
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
        async with cls.chat_start_slot(chat_id) as reserved:
            if not reserved:
                return False

            async with cache_connection() as cache:
                queue_service = QueueService(cache)
                queued_msg = await queue_service.pop_send_now_message(chat_id)
                if not queued_msg:
                    return False

            try:
                async with session_factory() as db:
                    result = await db.execute(
                        select(Chat)
                        .options(selectinload(Chat.workspace))
                        .filter(Chat.id == UUID(chat_id))
                    )
                    chat = result.scalar_one_or_none()
                    if not chat:
                        raise AgentException(
                            f"Chat {chat_id} not found for idle send-now"
                        )

                await cls._start_queued_turn(
                    chat=chat,
                    queued_msg=queued_msg,
                    message_service=MessageService(session_factory=session_factory),
                    session_factory=session_factory,
                )

                logger.info(
                    "Idle send-now: message %s started for chat %s",
                    queued_msg["id"],
                    chat_id,
                )
                return True

            except Exception:
                await cls._requeue_message_quietly(chat_id, queued_msg)
                raise

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
            if not message or message.stream_status != MessageStreamStatus.IN_PROGRESS:
                return
            content_text = message.content_text
            content_render = message.content_render
            if error_message is not None:
                render_events = list(content_render.get("events", []))
                render_events.append(
                    StreamSnapshotAccumulator.error_event(error_message)
                )
                content_render = {**content_render, "events": render_events}
                if not content_text:
                    content_text = error_message
            updated = await message_service.update_message_snapshot(
                message_uuid,
                content_text=content_text,
                content_render=content_render,
                last_seq=message.last_seq,
                active_stream_id=None,
                stream_status=stream_status,
                record_activity=record_activity,
            )
            # After the snapshot prune, so the terminal event survives for clients.
            await ChatStreamRuntime._emit_terminal_for_dead_stream(
                message_service=message_service,
                chat_id=message.chat_id,
                message_id=message_uuid,
                stream_id=message.active_stream_id or uuid4(),
                stream_status=stream_status,
                duration_ms=updated.duration_ms if updated else None,
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
        if stream_status == MessageStreamStatus.INTERRUPTED:
            kind = "cancelled"
            payload: dict[str, Any] = {
                "status": stream_status.value,
                "duration_ms": duration_ms,
            }
        else:
            kind = "error"
            payload = {"error": error_message or "Stream ended unexpectedly"}
        seq = await message_service.append_event_with_next_seq(
            chat_id=chat_id,
            message_id=message_id,
            stream_id=stream_id,
            event_type=kind,
            render_payload=payload,
            audit_payload={"payload": payload},
            record_activity=record_activity,
        )
        if not user_id:
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
                base_branch=request.base_branch,
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
            await cls.finalize_dead_stream(
                assistant_message_id=request.assistant_message_id,
                session_factory=session_factory,
                stream_status=MessageStreamStatus.INTERRUPTED,
                user_id=str(request.chat_data["user_id"]),
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
            await cls.finalize_dead_stream(
                assistant_message_id=request.assistant_message_id,
                session_factory=session_factory,
                stream_status=MessageStreamStatus.FAILED,
                user_id=str(request.chat_data["user_id"]),
                error_message=str(exc),
            )
            raise
        finally:
            session_registry.consume_pending_cancel(chat_id)
