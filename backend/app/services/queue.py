import json
from datetime import datetime, timezone
from typing import Any, cast
from uuid import UUID, uuid4

from app.constants import (
    QUEUE_MESSAGE_TTL_SECONDS,
    REDIS_KEY_CHAT_QUEUE,
    REDIS_KEY_CHAT_QUEUE_SEND_NOW,
)
from app.models.schemas.queue import QueueAddResponse, QueuedMessage
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME

from app.utils.cache import CacheStore


class QueueService:
    def __init__(self, cache: CacheStore):
        self.cache = cache

    def _queue_key(self, chat_id: str) -> str:
        return REDIS_KEY_CHAT_QUEUE.format(chat_id=chat_id)

    async def _read_queue(self, key: str) -> list[dict[str, Any]]:
        raw = await self.cache.get(key)
        if not raw:
            return []
        return cast(list[dict[str, Any]], json.loads(raw))

    async def _write_queue(self, key: str, queue: list[dict[str, Any]]) -> None:
        if not queue:
            await self.cache.delete(key)
        else:
            await self.cache.set(key, json.dumps(queue), ex=QUEUE_MESSAGE_TTL_SECONDS)

    async def add_message(
        self,
        chat_id: str,
        content: str,
        model_id: str,
        permission_mode: str = "bypassPermissions",
        thinking_mode: str | None = None,
        worktree: bool = False,
        selected_persona_name: str = DEFAULT_PERSONA_NAME,
        attachments: list[dict[str, Any]] | None = None,
    ) -> QueueAddResponse:
        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)

        message_id = uuid4()
        queued_at = datetime.now(timezone.utc)
        message_data: dict[str, Any] = {
            "id": str(message_id),
            "content": content,
            "model_id": model_id,
            "permission_mode": permission_mode,
            "thinking_mode": thinking_mode,
            "worktree": worktree,
            "selected_persona_name": selected_persona_name,
            "queued_at": queued_at.isoformat(),
            "attachments": attachments,
        }

        queue.append(message_data)
        await self._write_queue(key, queue)

        return QueueAddResponse(id=message_id, queued_at=queued_at)

    @staticmethod
    def _to_queued_message(item: dict[str, Any]) -> QueuedMessage:
        return QueuedMessage(
            id=UUID(item["id"]),
            content=item["content"],
            model_id=item["model_id"],
            # Queue items are backend-owned payloads, so missing keys indicate
            # corrupted internal state and should fail instead of changing behavior.
            permission_mode=item["permission_mode"],
            thinking_mode=item["thinking_mode"],
            worktree=item["worktree"],
            selected_persona_name=item["selected_persona_name"],
            queued_at=datetime.fromisoformat(item["queued_at"]),
            attachments=item["attachments"],
        )

    async def get_queue(self, chat_id: str) -> list[QueuedMessage]:
        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)
        return [self._to_queued_message(item) for item in queue]

    async def update_message(
        self, chat_id: str, message_id: str, content: str
    ) -> QueuedMessage | None:
        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)

        for item in queue:
            if item["id"] == message_id:
                item["content"] = content
                await self._write_queue(key, queue)
                return self._to_queued_message(item)

        return None

    async def delete_message(self, chat_id: str, message_id: str) -> bool:
        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)
        original_len = len(queue)
        queue = [item for item in queue if item["id"] != message_id]

        if len(queue) == original_len:
            return False

        await self._write_queue(key, queue)
        return True

    async def clear_queue(self, chat_id: str) -> None:
        key = self._queue_key(chat_id)
        await self.cache.delete(key)

    async def pop_next_message(self, chat_id: str) -> dict[str, Any] | None:
        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)

        if not queue:
            return None

        next_msg = queue[0]
        await self._write_queue(key, queue[1:])
        return next_msg

    async def mark_send_now(self, chat_id: str, message_id: str) -> bool:
        # Flag a queued message for immediate processing — the runtime checks this
        # key to skip the normal queue order and process this message next.
        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)
        if not any(item["id"] == message_id for item in queue):
            return False

        send_now_key = REDIS_KEY_CHAT_QUEUE_SEND_NOW.format(chat_id=chat_id)
        await self.cache.set(send_now_key, message_id, ex=QUEUE_MESSAGE_TTL_SECONDS)
        return True

    async def pop_send_now_message(self, chat_id: str) -> dict[str, Any] | None:
        send_now_key = REDIS_KEY_CHAT_QUEUE_SEND_NOW.format(chat_id=chat_id)
        message_id = await self.cache.get(send_now_key)
        if not message_id:
            return None

        await self.cache.delete(send_now_key)

        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)
        target = None
        remaining = []
        for item in queue:
            if item["id"] == message_id and target is None:
                target = item
            else:
                remaining.append(item)

        if target is None:
            return None

        await self._write_queue(key, remaining)
        return target

    async def requeue_message(self, chat_id: str, message_data: dict[str, Any]) -> None:
        # Re-insert at the front so it's retried next — used when processing fails
        # and the message shouldn't be lost.
        key = self._queue_key(chat_id)
        queue = await self._read_queue(key)
        queue.insert(0, message_data)
        await self._write_queue(key, queue)

    async def clear_send_now(self, chat_id: str) -> None:
        send_now_key = REDIS_KEY_CHAT_QUEUE_SEND_NOW.format(chat_id=chat_id)
        await self.cache.delete(send_now_key)
