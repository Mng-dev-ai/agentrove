import json
import time

from app.constants import RATE_LIMITS_FALLBACK_TTL_SECONDS, REDIS_KEY_USER_RATE_LIMITS
from app.models.types import RateLimits
from app.utils.cache import CacheStore


def _unexpired(rate_limits: RateLimits, now: float) -> RateLimits:
    return RateLimits(
        windows={
            name: window
            for name, window in rate_limits["windows"].items()
            if window["resets_at"] is None or window["resets_at"] > now
        },
        is_using_overage=rate_limits["is_using_overage"],
    )


async def load_rate_limits(cache: CacheStore, user_id: str) -> RateLimits:
    cached = await cache.get(REDIS_KEY_USER_RATE_LIMITS.format(user_id=user_id))
    if not cached:
        return RateLimits(windows={}, is_using_overage=False)
    stored: RateLimits = json.loads(cached)
    return _unexpired(stored, time.time())


async def merge_rate_limits(
    cache: CacheStore, user_id: str, update: RateLimits
) -> None:
    current = await load_rate_limits(cache, user_id)
    now = time.time()
    merged = _unexpired(
        RateLimits(
            windows={**current["windows"], **update["windows"]},
            is_using_overage=update["is_using_overage"],
        ),
        now,
    )
    ttl = max(
        (
            RATE_LIMITS_FALLBACK_TTL_SECONDS
            if window["resets_at"] is None
            else int(window["resets_at"] - now) + 1
            for window in merged["windows"].values()
        ),
        default=RATE_LIMITS_FALLBACK_TTL_SECONDS,
    )
    await cache.setex(
        REDIS_KEY_USER_RATE_LIMITS.format(user_id=user_id), ttl, json.dumps(merged)
    )
