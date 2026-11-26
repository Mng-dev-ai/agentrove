import asyncio
import os
from collections.abc import AsyncIterator
from uuid import uuid4

import pytest

from app.utils import cache as cache_module
from app.utils.cache import CacheStore, MemoryStore, _open_cache_store, cache_pubsub

pytestmark = pytest.mark.anyio

DEADLINE_SECONDS = 5.0
POLL_SECONDS = 0.02
TTL_SECONDS = 1


@pytest.fixture(params=["memory", "redis"])
async def store(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[CacheStore]:
    if request.param == "memory":
        yield MemoryStore()
        return
    redis_url = os.environ.get("TEST_REDIS_URL")
    if redis_url is None:
        if os.environ.get("CI"):
            pytest.fail("TEST_REDIS_URL is not set: CI must run the Redis leg")
        pytest.skip("TEST_REDIS_URL is not set")
    monkeypatch.setattr(cache_module.settings, "DESKTOP_MODE", False)
    monkeypatch.setattr(cache_module.settings, "REDIS_URL", redis_url)
    async with _open_cache_store() as redis_store:
        yield redis_store


def unique(kind: str) -> str:
    return f"cache-contract:{kind}:{uuid4().hex}"


async def wait_until_gone(store: CacheStore, key: str) -> None:
    async with asyncio.timeout(DEADLINE_SECONDS):
        while await store.get(key) is not None:
            await asyncio.sleep(POLL_SECONDS)


# Redis applies SUBSCRIBE/UNSUBSCRIBE on its own connection, after the call returns.
async def publish_until_receivers(
    store: CacheStore, channel: str, message: str, receivers: int
) -> None:
    async with asyncio.timeout(DEADLINE_SECONDS):
        while await store.publish(channel, message) != receivers:
            await asyncio.sleep(POLL_SECONDS)


async def test_set_get_and_delete(store: CacheStore) -> None:
    first, second, missing = unique("key"), unique("key"), unique("key")
    assert await store.get(first) is None
    await store.set(first, "one")
    await store.set(second, "two")
    await store.set(first, "replaced")
    assert await store.get(first) == "replaced"
    assert await store.delete(first, second, missing) == 2
    assert await store.get(first) is None
    assert await store.get(second) is None


async def test_set_with_ttl_and_setex_expire(store: CacheStore) -> None:
    set_key, setex_key = unique("key"), unique("key")
    await store.set(set_key, "value", ex=TTL_SECONDS)
    await store.setex(setex_key, TTL_SECONDS, "value")
    assert await store.get(set_key) == "value"
    assert await store.get(setex_key) == "value"
    await wait_until_gone(store, set_key)
    await wait_until_gone(store, setex_key)


async def test_set_without_ttl_clears_the_ttl_of_an_expiring_key(
    store: CacheStore,
) -> None:
    key = unique("key")
    await store.set(key, "expiring", ex=TTL_SECONDS)
    await store.set(key, "kept")
    await asyncio.sleep(TTL_SECONDS + 0.5)
    assert await store.get(key) == "kept"
    await store.delete(key)


async def test_ping(store: CacheStore) -> None:
    assert await store.ping() is True


async def test_publish_reaches_a_subscriber_until_it_unsubscribes(
    store: CacheStore,
) -> None:
    channel = unique("channel")
    assert await store.publish(channel, "nobody listening") == 0
    async with cache_pubsub(store, channel) as pubsub:
        await publish_until_receivers(store, channel, "hello", 1)
        message = None
        async with asyncio.timeout(DEADLINE_SECONDS):
            while message is None:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=POLL_SECONDS
                )
    assert message["type"] == "message"
    assert message["channel"] == channel
    assert message["data"] == "hello"
    await publish_until_receivers(store, channel, "after unsubscribe", 0)


async def test_memory_store_drops_a_channel_when_its_last_subscriber_leaves() -> None:
    store = MemoryStore()
    async with cache_pubsub(store, "channel"):
        assert "channel" in store._subscribers
    assert "channel" not in store._subscribers
