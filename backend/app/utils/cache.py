import asyncio
import logging
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Protocol, cast

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

_RedisError: type[Exception]
try:
    from redis.exceptions import RedisError as _RedisError
except ModuleNotFoundError:
    _RedisError = OSError

CacheError = _RedisError


class CachePubSub(Protocol):
    async def subscribe(self, channel: str) -> None: ...
    async def unsubscribe(self, channel: str) -> None: ...
    async def get_message(
        self, ignore_subscribe_messages: bool = False, timeout: float = 1.0
    ) -> dict[str, Any] | None: ...
    async def close(self) -> None: ...


class CacheStore(Protocol):
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ex: int | None = None) -> None: ...
    async def setex(self, key: str, ttl: int, value: str) -> None: ...
    async def delete(self, *keys: str) -> int: ...
    async def publish(self, channel: str, message: str) -> int: ...
    def pubsub(self) -> CachePubSub: ...
    async def ping(self) -> bool: ...
    async def close(self) -> None: ...


class MemoryPubSub:
    def __init__(self, store: "MemoryStore") -> None:
        self._store = store
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def subscribe(self, channel: str) -> None:
        self._store.add_subscriber(channel, self)

    async def unsubscribe(self, channel: str) -> None:
        self._store.remove_subscriber(channel, self)

    async def get_message(
        self, ignore_subscribe_messages: bool = False, timeout: float = 1.0
    ) -> dict[str, Any] | None:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    def put_nowait(self, message: dict[str, Any]) -> None:
        self._queue.put_nowait(message)

    async def close(self) -> None:
        pass


# Desktop stand-in for Redis; TTL via asyncio.TimerHandle (no background sweep).
class MemoryStore:
    _instance: "MemoryStore | None" = None

    @classmethod
    def get_instance(cls) -> "MemoryStore":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self) -> None:
        self._data: dict[str, str] = {}
        self._expiry: dict[str, float] = {}
        self._subscribers: dict[str, list[MemoryPubSub]] = defaultdict(list)
        self._timers: dict[str, asyncio.TimerHandle] = {}

    def _evict_if_expired(self, key: str) -> bool:
        if key in self._expiry and time.monotonic() >= self._expiry[key]:
            self._remove_key(key)
            return True
        return False

    def _remove_key(self, key: str) -> None:
        self._data.pop(key, None)
        self._expiry.pop(key, None)
        timer = self._timers.pop(key, None)
        if timer is not None:
            timer.cancel()

    async def get(self, key: str) -> str | None:
        if self._evict_if_expired(key):
            return None
        return self._data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._data[key] = value
        if ex is not None:
            self._set_expiry(key, ex)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self._data[key] = value
        self._set_expiry(key, ttl)

    def _set_expiry(self, key: str, ttl: int) -> None:
        self._expiry[key] = time.monotonic() + ttl
        old_timer = self._timers.pop(key, None)
        if old_timer is not None:
            old_timer.cancel()
        loop = asyncio.get_running_loop()
        self._timers[key] = loop.call_later(ttl, self._remove_key, key)

    async def delete(self, *keys: str) -> int:
        count = 0
        for key in keys:
            if key in self._data:
                count += 1
            self._remove_key(key)
        return count

    async def publish(self, channel: str, message: str) -> int:
        subscribers = self._subscribers.get(channel, [])
        for sub in subscribers:
            sub.put_nowait({"type": "message", "channel": channel, "data": message})
        return len(subscribers)

    def pubsub(self) -> MemoryPubSub:
        return MemoryPubSub(self)

    def add_subscriber(self, channel: str, sub: MemoryPubSub) -> None:
        self._subscribers[channel].append(sub)

    def remove_subscriber(self, channel: str, sub: MemoryPubSub) -> None:
        subs = self._subscribers.get(channel, [])
        if sub in subs:
            subs.remove(sub)

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        for timer in self._timers.values():
            timer.cancel()
        self._timers.clear()
        self._data.clear()
        self._expiry.clear()
        self._subscribers.clear()


@asynccontextmanager
async def cache_connection() -> AsyncIterator[CacheStore]:
    if settings.DESKTOP_MODE:
        yield MemoryStore.get_instance()
        return
    try:
        import redis.asyncio as redis_asyncio
    except ModuleNotFoundError:
        raise CacheError("Redis client is not available")

    store = cast(
        CacheStore,
        redis_asyncio.Redis.from_url(settings.REDIS_URL, decode_responses=True),
    )
    try:
        yield store
    finally:
        try:
            await store.close()
        except CacheError as e:
            logger.warning("Error closing Redis connection: %s", e)


@asynccontextmanager
async def cache_pubsub(store: CacheStore, channel: str) -> AsyncIterator[CachePubSub]:
    pubsub = store.pubsub()
    await pubsub.subscribe(channel)
    try:
        yield pubsub
    finally:
        try:
            await pubsub.unsubscribe(channel)
        except CacheError as e:
            logger.warning("Error unsubscribing from channel %s: %s", channel, e)
        try:
            await pubsub.close()
        except CacheError as e:
            logger.warning("Error closing pubsub: %s", e)
