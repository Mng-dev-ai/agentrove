from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from functools import partial
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from claude_agent_sdk import ClaudeSDKClient, CLIConnectionError, CLIJSONDecodeError
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.constants import (
    REDIS_KEY_CHAT_CONTEXT_USAGE,
    REDIS_KEY_CHAT_STREAM_LIVE,
    SANDBOX_HOME_DIR,
)
from app.services.sandbox_providers import SandboxProviderType
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User, UserSettings
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME, build_system_prompt_for_chat
from app.services.claude_agent import (
    SDK_PERMISSION_MODE_MAP,
    ClaudeAgentService,
    SessionParams,
    StreamResult,
)
from app.services.claude_session_registry import session_registry
from app.services.db import SessionFactoryType
from app.services.provider import ProviderService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.exceptions import ClaudeAgentException
from app.services.message import MessageService
from app.services.queue import QueueService
from app.services.streaming.types import (
    ChatStreamRequest,
    StreamEnvelope,
    StreamEvent,
    StreamSnapshotAccumulator,
)
from app.services.transports import SandboxTransport
from app.services.user import UserService
from app.utils.cache import CacheError, CacheStore, cache_connection

logger = logging.getLogger(__name__)
settings = get_settings()

TRANSPORT_FATAL_TYPES = (
    CLIConnectionError,
    CLIJSONDecodeError,
    ConnectionError,
    OSError,
)

SNAPSHOT_EVENT_KINDS = frozenset(
    {
        "assistant_text",
        "assistant_thinking",
        "tool_started",
        "tool_completed",
        "tool_failed",
        "prompt_suggestions",
        "system",
        "permission_request",
    }
)


class SessionUpdateCallback:
    def __init__(
        self,
        chat_id: str,
        assistant_message_id: str | None,
        session_factory: SessionFactoryType,
        session_container: dict[str, Any],
        worktree: bool = False,
    ) -> None:
        self.chat_id = chat_id
        self.assistant_message_id = assistant_message_id
        self.session_factory = session_factory
        self.session_container = session_container
        self._worktree = worktree
        self._pending_task: asyncio.Task[None] | None = None

    def __call__(self, new_session_id: str, cwd: str | None = None) -> None:
        self.session_container["session_id"] = new_session_id
        task = asyncio.create_task(self._update_session_init(new_session_id, cwd))
        self._pending_task = task
        task.add_done_callback(self._on_task_done)

    def _on_task_done(self, task: asyncio.Task[None]) -> None:
        if self._pending_task is task:
            self._pending_task = None
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            logger.error("Session init update task failed: %s", exc)

    async def _update_session_init(self, session_id: str, cwd: str | None) -> None:
        try:
            async with self.session_factory() as db:
                chat_uuid = UUID(self.chat_id)
                chat_query = select(Chat).filter(Chat.id == chat_uuid)
                chat_result = await db.execute(chat_query)
                chat_record = chat_result.scalar_one_or_none()
                if chat_record:
                    chat_record.session_id = session_id
                    if self._worktree and cwd:
                        chat_record.worktree_cwd = cwd
                    db.add(chat_record)

                if self.assistant_message_id:
                    message_uuid = UUID(self.assistant_message_id)
                    message_query = select(Message).filter(Message.id == message_uuid)
                    message_result = await db.execute(message_query)
                    message = message_result.scalar_one_or_none()
                    if message:
                        message.session_id = session_id
                        db.add(message)

                await db.commit()
        except (SQLAlchemyError, ValueError) as exc:
            logger.error("Failed to update session init: %s", exc)


class ChatStreamRuntime:
    _background_task_chat_ids: dict[asyncio.Task[str], str] = {}

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
        self.session_container: dict[str, Any] = {"session_id": request.session_id}
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

        self.transport: SandboxTransport | None = None
        self.client: ClaudeSDKClient | None = None
        self.cache: CacheStore | None = None
        self._cancel_event: asyncio.Event | None = None
        self._cancelled: bool = False
        self._send_now_pending: bool = False

    async def run(
        self,
        ai_service: ClaudeAgentService,
        stream_result: StreamResult,
        stream: AsyncIterator[StreamEvent],
    ) -> str:
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
            await self._consume_stream(ai_service, stream_result, stream)

            if self._cancelled:
                return await self._complete_stream(
                    stream_result, MessageStreamStatus.INTERRUPTED
                )

            if self.last_seq <= start_seq:
                raise ClaudeAgentException("Stream completed without any events")

            return await self._complete_stream(
                stream_result, MessageStreamStatus.COMPLETED
            )

        except Exception as exc:
            logger.error("Error in stream processing: %s", exc)
            await self.emit_event(
                "error",
                {"error": str(exc)},
                apply_snapshot=False,
            )
            await self._save_final_snapshot(stream_result, MessageStreamStatus.FAILED)
            raise

    async def _consume_stream(
        self,
        ai_service: ClaudeAgentService,
        stream_result: StreamResult,
        stream: AsyncIterator[StreamEvent],
    ) -> None:
        stream_iter = aiter(stream)
        last_usage: dict[str, Any] | None = None
        try:
            while True:
                event = await self._next_or_cancel(stream_iter)
                if event is None:
                    self._send_now_pending = False
                    break

                if self._send_now_pending and self._is_assistant_turn_start(event):
                    self._send_now_pending = False
                    if await self._write_send_now(ai_service):
                        continue

                kind = str(event.get("type") or "system")
                payload = {k: v for k, v in event.items() if k != "type"}
                await self.emit_event(kind, payload)
                await self._flush_snapshot(force=False)

                if not self._send_now_pending and self._is_send_now_eligible(event):
                    self._send_now_pending = True

                current_usage = stream_result.usage
                if current_usage is not None and current_usage is not last_usage:
                    last_usage = current_usage
                    await self._emit_context_usage(stream_result)
        except asyncio.CancelledError:
            if not (self._cancel_event and self._cancel_event.is_set()):
                raise
            self._cancelled = True
            self._send_now_pending = False

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
            self._event_buffer.append((kind, payload, audit))
            self.snapshot.add_event(kind, payload)
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
        if not self.cache or not events:
            return
        channel = REDIS_KEY_CHAT_STREAM_LIVE.format(chat_id=self.chat_id)
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
    ) -> None:
        if not self.assistant_message_id:
            return
        await self._flush_event_buffer()
        await self.message_service.update_message_snapshot(
            UUID(self.assistant_message_id),
            content_text=self.snapshot.content_text,
            content_render=self.snapshot.to_render(),
            last_seq=self.last_seq,
            active_stream_id=None,
            stream_status=stream_status,
            total_cost_usd=stream_result.total_cost_usd,
        )

    async def _complete_stream(
        self,
        stream_result: StreamResult,
        status: MessageStreamStatus,
    ) -> str:
        await self._save_final_snapshot(stream_result, status)
        final_content = self.snapshot.content_text

        if status != MessageStreamStatus.COMPLETED and self.cache:
            try:
                queue_service = QueueService(self.cache)
                await queue_service.clear_send_now(self.chat_id)
            except CacheError as exc:
                logger.debug("Failed to clear send-now flag: %s", exc)

        if status == MessageStreamStatus.COMPLETED:
            title_task = asyncio.create_task(self._generate_title())
            title_task.add_done_callback(ChatStreamRuntime._on_title_task_done)
            queue_processed = await self._process_next_queued()
            if not queue_processed:
                await self._emit_context_usage(stream_result)
                await self.emit_event(
                    "complete",
                    {"status": "completed"},
                    apply_snapshot=False,
                )
        else:
            await self._emit_context_usage(stream_result)
            terminal_kind = (
                "cancelled" if status == MessageStreamStatus.INTERRUPTED else "complete"
            )
            await self.emit_event(
                terminal_kind,
                {"status": status.value},
                apply_snapshot=False,
            )

        return final_content

    @staticmethod
    def _is_send_now_eligible(event: StreamEvent) -> bool:
        if event.get("type") != "tool_completed":
            return False
        tool = event.get("tool", {})
        if tool.get("parent_id"):
            return False
        return True

    @staticmethod
    def _is_assistant_turn_start(event: StreamEvent) -> bool:
        event_type = event.get("type")
        if event_type in ("assistant_text", "assistant_thinking"):
            return True
        if event_type == "tool_started":
            tool = event.get("tool", {})
            return not tool.get("parent_id")
        return False

    async def _write_send_now(self, ai_service: ClaudeAgentService) -> bool:
        if not self.cache or not self.transport:
            return False

        queue_service = QueueService(self.cache)
        queued_msg = await queue_service.pop_send_now_message(self.chat_id)
        if not queued_msg:
            return False

        try:
            await self._flush_event_buffer()

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

            if self.client:
                queued_model = queued_msg.get("model_id")
                if queued_model:
                    resolved_model = queued_model.split(":", 1)[-1]
                    if resolved_model != self.model_id:
                        await self.client.set_model(resolved_model)
                        self.model_id = resolved_model
                queued_permission = queued_msg.get("permission_mode")
                if queued_permission:
                    sdk_permission = SDK_PERMISSION_MODE_MAP.get(
                        queued_permission, "acceptEdits"
                    )
                    await self.client.set_permission_mode(sdk_permission)

            prompt = ai_service.prepare_user_prompt(
                queued_msg["content"],
                self.custom_instructions,
                queued_msg.get("attachments"),
            )
            injection = {
                "type": "user",
                "message": {"role": "user", "content": prompt},
                "parent_tool_use_id": None,
                "session_id": self.session_container.get("session_id"),
            }
            await self.transport.write(json.dumps(injection) + "\n")

            await self.message_service.update_message_snapshot(
                UUID(self.assistant_message_id),
                content_text=self.snapshot.content_text,
                content_render=self.snapshot.to_render(),
                last_seq=self.last_seq,
                active_stream_id=None,
                stream_status=MessageStreamStatus.COMPLETED,
            )

            await self.emit_event(
                "queue_processing",
                {
                    "queued_message_id": queued_msg["id"],
                    "user_message_id": str(user_message.id),
                    "assistant_message_id": str(assistant_message.id),
                    "content": queued_msg["content"],
                    "model_id": queued_msg["model_id"],
                    "attachments": MessageService.serialize_attachments(
                        queued_msg, user_message
                    ),
                    "send_now": True,
                },
                apply_snapshot=False,
            )

            self.assistant_message_id = str(assistant_message.id)
            self.stream_id = uuid4()
            self.snapshot = StreamSnapshotAccumulator()
            self.pending_since_flush = 0
            self.last_flush_at = time.monotonic()
            self._event_buffer = []
            self.last_seq = 0

            start_seq = await self.emit_event(
                "stream_started",
                {"status": "started"},
                apply_snapshot=False,
            )
            await self.message_service.update_message_snapshot(
                UUID(self.assistant_message_id),
                content_text="",
                content_render=self.snapshot.to_render(),
                last_seq=start_seq,
                active_stream_id=self.stream_id,
            )
        except Exception as exc:
            logger.error("Failed to process send-now message: %s", exc)
            try:
                await queue_service.requeue_message(self.chat_id, queued_msg)
            except Exception as requeue_exc:
                logger.error("Failed to re-queue message: %s", requeue_exc)
            return False

        logger.info(
            "Send-now message %s written for chat %s",
            queued_msg["id"],
            self.chat_id,
        )
        return True

    async def _process_next_queued(self) -> bool:
        next_msg: dict[str, Any] | None = None
        try:
            async with cache_connection() as cache:
                queue_service = QueueService(cache)
                next_msg = await queue_service.pop_send_now_message(self.chat_id)
                if not next_msg:
                    next_msg = await queue_service.pop_next_message(self.chat_id)
        except CacheError as exc:
            logger.error(
                "Failed to read queued messages for chat %s: %s", self.chat_id, exc
            )
            return False

        if not next_msg:
            return False

        try:
            user_message = await self.message_service.create_message(
                UUID(self.chat_id),
                next_msg["content"],
                MessageRole.USER,
                attachments=next_msg.get("attachments"),
            )
            assistant_message = await self.message_service.create_message(
                UUID(self.chat_id),
                "",
                MessageRole.ASSISTANT,
                model_id=next_msg["model_id"],
                stream_status=MessageStreamStatus.IN_PROGRESS,
            )

            await self.emit_event(
                "queue_processing",
                {
                    "queued_message_id": next_msg["id"],
                    "user_message_id": str(user_message.id),
                    "assistant_message_id": str(assistant_message.id),
                    "content": next_msg["content"],
                    "model_id": next_msg["model_id"],
                    "attachments": MessageService.serialize_attachments(
                        next_msg, user_message
                    ),
                },
                apply_snapshot=False,
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

    async def _requeue_next_message(self, queued_msg: dict[str, Any]) -> None:
        try:
            async with cache_connection() as cache:
                queue_service = QueueService(cache)
                await queue_service.requeue_message(self.chat_id, queued_msg)
        except Exception as requeue_exc:
            logger.error("Failed to re-queue message: %s", requeue_exc)

    async def _emit_context_usage(self, stream_result: StreamResult) -> None:
        usage = stream_result.usage
        if not usage or not self.cache:
            return

        token_usage = (
            usage.get("input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
        )
        if token_usage <= 0:
            return

        context_window = self.context_window or settings.CONTEXT_WINDOW_TOKENS
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
                result = await db.execute(select(Chat).filter(Chat.id == self.chat.id))
                chat = result.scalar_one_or_none()
                if chat:
                    chat.context_token_usage = token_usage
                    db.add(chat)
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

        ai_service = ClaudeAgentService(session_factory=self.session_factory)
        user = User(id=self.chat.user_id)
        title = await ai_service.generate_title(self.prompt, user)
        if not title:
            return
        title = title[:255]

        async with self.session_factory() as db:
            await db.execute(
                update(Chat).where(Chat.id == self.chat.id).values(title=title)
            )
            await db.commit()

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
    def _on_background_task_done(cls, task_id: str, task: asyncio.Task[str]) -> None:
        try:
            if task.cancelled():
                return
            try:
                error = task.exception()
            except Exception:
                logger.exception(
                    "Failed to inspect in-process chat task %s result", task_id
                )
                return
            if error:
                logger.error(
                    "In-process chat task %s failed: %s",
                    task_id,
                    error,
                    exc_info=error,
                )
        finally:
            cls._background_task_chat_ids.pop(task, None)

    @classmethod
    def start_background_chat(
        cls,
        request: ChatStreamRequest,
    ) -> str:
        resolved_task_id = str(uuid4())
        chat_id = str(request.chat_data["id"])
        background_task = asyncio.create_task(
            cls._bootstrap_and_execute(
                request=request,
            )
        )
        cls._background_task_chat_ids[background_task] = chat_id
        background_task.add_done_callback(
            partial(cls._on_background_task_done, resolved_task_id)
        )
        return resolved_task_id

    @classmethod
    def is_chat_streaming(cls, chat_id: str) -> bool:
        return any(
            cid == chat_id
            for task, cid in cls._background_task_chat_ids.items()
            if not task.done()
        )

    @staticmethod
    def _build_queued_stream_request(
        *,
        chat: Chat,
        queued_msg: dict[str, Any],
        user_settings: UserSettings,
        assistant_message_id: str,
    ) -> ChatStreamRequest:
        selected_persona_name = queued_msg.get(
            "selected_persona_name", DEFAULT_PERSONA_NAME
        )
        system_prompt = build_system_prompt_for_chat(
            user_settings,
            selected_persona_name=selected_persona_name,
        )
        context_window = ProviderService().get_model_context_window(
            user_settings, queued_msg["model_id"]
        )
        return ChatStreamRequest(
            prompt=queued_msg["content"],
            system_prompt=system_prompt,
            custom_instructions=user_settings.custom_instructions,
            chat_data={
                "id": str(chat.id),
                "user_id": str(chat.user_id),
                "title": chat.title,
                "workspace_id": str(chat.workspace_id),
                "sandbox_id": chat.sandbox_id or "",
                "workspace_path": chat.workspace_path or "",
                "sandbox_provider": chat.sandbox_provider,
                "session_id": chat.session_id,
            },
            permission_mode=queued_msg.get("permission_mode", "auto"),
            model_id=queued_msg["model_id"],
            context_window=context_window,
            session_id=chat.session_id,
            assistant_message_id=assistant_message_id,
            thinking_mode=queued_msg.get("thinking_mode"),
            worktree=queued_msg.get("worktree", False),
            attachments=queued_msg.get("attachments"),
            selected_persona_name=selected_persona_name,
        )

    @classmethod
    async def process_send_now_idle(
        cls,
        chat_id: str,
        session_factory: SessionFactoryType,
    ) -> bool:
        if cls.is_chat_streaming(chat_id):
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
                    raise ClaudeAgentException(
                        f"Chat {chat_id} not found for idle send-now"
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
                content_text=message.content_text or "",
                content_render=message.content_render or {"events": []},
                last_seq=int(message.last_seq or 0),
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
        assistant_message_id: str | None,
        session_factory: SessionFactoryType,
        error_message: str,
    ) -> None:
        if not assistant_message_id:
            return
        try:
            message_service = MessageService(session_factory=session_factory)
            message = await message_service.get_message(UUID(assistant_message_id))
            if not message or message.stream_status != MessageStreamStatus.IN_PROGRESS:
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
                channel = REDIS_KEY_CHAT_STREAM_LIVE.format(chat_id=chat_id)
                envelope = StreamEnvelope.serialize(
                    chat_id=UUID(chat_id),
                    message_id=UUID(assistant_message_id),
                    stream_id=stream_id,
                    seq=error_seq,
                    kind="error",
                    payload=payload,
                )
                await cache.publish(channel, envelope)
            existing_render = message.content_render or {"events": []}
            render_events = list(existing_render.get("events", []))
            render_events.append(
                {"type": "assistant_text", "text": f"\n\nError: {error_message}"}
            )
            content_text = message.content_text or ""
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

            ai_service = ClaudeAgentService(session_factory=runtime.session_factory)
            user = User(id=runtime.chat.user_id)

            params: SessionParams = await ai_service.build_session_params(
                user=user,
                chat=runtime.chat,
                system_prompt=request.system_prompt,
                model_id=request.model_id,
                permission_mode=request.permission_mode,
                session_id=request.session_id,
                thinking_mode=request.thinking_mode,
                worktree=request.worktree,
                selected_persona_name=request.selected_persona_name,
            )

            # If this sandbox uses the anthropic-bridge (OpenRouter, OpenAI, Copilot),
            # make sure the bridge is still running — it dies when the container restarts.
            bridge_url = params.options.env.get("ANTHROPIC_BASE_URL", "")
            if "127.0.0.1" in bridge_url or "localhost" in bridge_url:
                sandbox_service = SandboxService(
                    SandboxProviderFactory.create_bound(
                        runtime.chat.sandbox_provider or SandboxProviderType.DOCKER.value,
                        sandbox_id=runtime.chat.sandbox_id or "",
                        workspace_path=runtime.chat.workspace_path,
                    )
                )
                await sandbox_service.ensure_bridge_running(
                    sandbox_id=runtime.chat.sandbox_id or "",
                    copilot_token=params.options.env.get("GITHUB_COPILOT_TOKEN"),
                    openrouter_api_key=params.options.env.get("OPENROUTER_API_KEY"),
                )

            session = await session_registry.get_or_create(
                chat_id=runtime.chat_id,
                options=params.options,
                transport_factory=params.transport_factory,
            )

            session_callback = SessionUpdateCallback(
                chat_id=runtime.chat_id,
                assistant_message_id=request.assistant_message_id,
                session_factory=runtime.session_factory,
                session_container=runtime.session_container,
                worktree=request.worktree,
            )

            session.cancel_event.clear()
            if session_registry.consume_pending_cancel(runtime.chat_id):
                session.cancel_event.set()
            runtime._cancel_event = session.cancel_event
            session.active_generation_task = asyncio.current_task()
            runtime.transport = session.transport
            runtime.client = session.client
            stream: AsyncIterator[StreamEvent] | None = None
            try:
                if params.options.model:
                    await session.client.set_model(params.options.model)
                if params.options.permission_mode:
                    await session.client.set_permission_mode(
                        params.options.permission_mode
                    )
                stream_result = StreamResult()
                attachment_base_dir = SANDBOX_HOME_DIR
                if runtime.chat.sandbox_provider == SandboxProviderType.HOST:
                    # Files are written to the sandbox home dir
                    # (/home/user/ → {host_base}/{sandbox_id}/), so
                    # point Claude at the real host path, not the
                    # workspace path.
                    host_base = (
                        Path(settings.get_host_sandbox_base_dir())
                        .expanduser()
                        .resolve()
                    )
                    sid = runtime.chat.sandbox_id
                    assert sid is not None
                    attachment_base_dir = str(host_base / sid)
                stream = ai_service.stream_response(
                    client=session.client,
                    prompt=request.prompt,
                    custom_instructions=request.custom_instructions,
                    session_id=request.session_id,
                    result=stream_result,
                    session_callback=session_callback,
                    attachments=request.attachments,
                    attachment_base_dir=attachment_base_dir,
                )
                return await runtime.run(ai_service, stream_result, stream)
            except (
                ClaudeAgentException,
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
                if stream is not None and hasattr(stream, "aclose"):
                    await stream.aclose()
                if runtime._cancelled:
                    try:
                        async with asyncio.timeout(5.0):
                            async for _ in session.client.receive_response():
                                pass
                    except Exception:
                        pass
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
            logger.error(
                "Chat bootstrap failed for %s: %s", chat_id, exc, exc_info=True
            )
            await cls.emit_bootstrap_error(
                chat_id=chat_id,
                assistant_message_id=request.assistant_message_id,
                session_factory=session_factory,
                error_message=str(exc),
            )
            raise
        finally:
            session_registry.consume_pending_cancel(chat_id)
