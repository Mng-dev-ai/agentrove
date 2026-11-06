import asyncio
import json
from datetime import datetime, timezone
from typing import Any, ClassVar, Generic, TypeVar, cast
from uuid import UUID, uuid4

from pydantic import BaseModel

from app.constants import (
    QUEUE_MESSAGE_TTL_SECONDS,
    REDIS_KEY_CHANNEL_QUEUE,
    REDIS_KEY_CHAT_QUEUE,
    REDIS_KEY_CHAT_QUEUE_SEND_NOW,
)
from app.models.schemas.queue import (
    QueueAddResponse,
    QueuedChannelMessage,
    QueuedMessage,
    QueuedMessageEdit,
)
from app.services.pairing import PairingService
from app.utils.cache import CacheStore

ItemT = TypeVar("ItemT", bound=BaseModel)


class BaseQueueService(Generic[ItemT]):
    key_template: ClassVar[str]
    item_type: type[ItemT]
    # Serializes per-queue read-modify-write; single uvicorn worker only
    # (entrypoint.sh). Locks are retained for the process lifetime.
    _locks: ClassVar[dict[str, asyncio.Lock]] = {}

    def __init__(self, cache: CacheStore):
        self.cache = cache

    def _lock(self, queue_id: str) -> asyncio.Lock:
        return self._locks.setdefault(self._queue_key(queue_id), asyncio.Lock())

    def _queue_key(self, queue_id: str) -> str:
        return self.key_template.format(queue_id=queue_id)

    async def _read_queue(self, key: str) -> list[dict[str, Any]]:
        raw = await self.cache.get(key)
        if not raw:
            return []
        return [
            {"device_ids": [], **item}
            for item in cast(list[dict[str, Any]], json.loads(raw))
        ]

    async def _write_queue(self, key: str, queue: list[dict[str, Any]]) -> None:
        if not queue:
            await self.cache.delete(key)
        else:
            await self.cache.set(key, json.dumps(queue), ex=QUEUE_MESSAGE_TTL_SECONDS)

    async def add_message(
        self,
        queue_id: str,
        message: BaseModel,
        attachments: list[dict[str, Any]] | None = None,
    ) -> QueueAddResponse:
        async with self._lock(queue_id):
            key = self._queue_key(queue_id)
            queue = await self._read_queue(key)

            message_id = uuid4()
            queued_at = datetime.now(timezone.utc)
            queue.append(
                {
                    **message.model_dump(mode="json"),
                    "id": str(message_id),
                    "queued_at": queued_at.isoformat(),
                    "attachments": attachments,
                }
            )
            await self._write_queue(key, queue)

            return QueueAddResponse(id=message_id, queued_at=queued_at)

    async def get_queue(self, queue_id: str) -> list[ItemT]:
        key = self._queue_key(queue_id)
        queue = await self._read_queue(key)
        return [self.item_type.model_validate(item) for item in queue]

    async def update_message(
        self, queue_id: str, message_id: str, update: QueuedMessageEdit
    ) -> ItemT | None:
        async with self._lock(queue_id):
            key = self._queue_key(queue_id)
            queue = await self._read_queue(key)

            for item in queue:
                if item["id"] == message_id:
                    device_ids = PairingService.edited_device_ids(
                        frozenset(map(UUID, item["device_ids"])),
                        update.device_ids,
                        bool(item["attachments"]) or item["content"] == update.content,
                    )
                    item["content"] = update.content
                    item["device_ids"] = sorted(map(str, device_ids))
                    await self._write_queue(key, queue)
                    updated: ItemT = self.item_type.model_validate(item)
                    return updated

            return None

    async def delete_message(
        self, queue_id: str, message_id: str
    ) -> dict[str, Any] | None:
        async with self._lock(queue_id):
            key = self._queue_key(queue_id)
            queue = await self._read_queue(key)
            removed = next((item for item in queue if item["id"] == message_id), None)
            if removed is None:
                return None

            await self._write_queue(
                key, [item for item in queue if item["id"] != message_id]
            )
            return removed

    async def clear_queue(self, queue_id: str) -> None:
        # Locked so a concurrent pop's _write_queue can't resurrect the key.
        async with self._lock(queue_id):
            key = self._queue_key(queue_id)
            await self.cache.delete(key)

    async def pop_next_message(self, queue_id: str) -> dict[str, Any] | None:
        async with self._lock(queue_id):
            key = self._queue_key(queue_id)
            queue = await self._read_queue(key)

            if not queue:
                return None

            next_msg = queue[0]
            await self._write_queue(key, queue[1:])
            return next_msg

    async def requeue_message(
        self, queue_id: str, message_data: dict[str, Any]
    ) -> None:
        # Front of queue so a failed process is retried next.
        async with self._lock(queue_id):
            key = self._queue_key(queue_id)
            queue = await self._read_queue(key)
            queue.insert(0, message_data)
            await self._write_queue(key, queue)


class QueueService(BaseQueueService[QueuedMessage]):
    key_template = REDIS_KEY_CHAT_QUEUE
    item_type = QueuedMessage

    async def mark_send_now(
        self, chat_id: str, message_id: str, device_ids: frozenset[UUID]
    ) -> bool:
        # Runtime checks this key to skip normal queue order.
        async with self._lock(chat_id):
            key = self._queue_key(chat_id)
            queue = await self._read_queue(key)
            item = next((item for item in queue if item["id"] == message_id), None)
            if item is None:
                return False
            if device_ids:
                item["device_ids"] = sorted(
                    {*item["device_ids"], *map(str, device_ids)}
                )
                await self._write_queue(key, queue)

            send_now_key = REDIS_KEY_CHAT_QUEUE_SEND_NOW.format(chat_id=chat_id)
            await self.cache.set(send_now_key, message_id, ex=QUEUE_MESSAGE_TTL_SECONDS)
            return True

    async def pop_send_now_message(self, chat_id: str) -> dict[str, Any] | None:
        async with self._lock(chat_id):
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


class ChannelQueueService(BaseQueueService[QueuedChannelMessage]):
    key_template = REDIS_KEY_CHANNEL_QUEUE
    item_type = QueuedChannelMessage
