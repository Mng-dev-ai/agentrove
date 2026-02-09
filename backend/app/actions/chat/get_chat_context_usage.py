import json
import logging
from uuid import UUID

from redis.exceptions import RedisError

from app.constants import REDIS_KEY_CHAT_CONTEXT_USAGE
from app.core.config import get_settings
from app.models.db_models import User
from app.models.schemas import ContextUsage
from app.services.chat import ChatService
from app.utils.redis import redis_connection

logger = logging.getLogger(__name__)
settings = get_settings()


class GetChatContextUsageAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, chat_id: UUID, current_user: User) -> ContextUsage:
        chat = await self._chat_service.get_chat(chat_id, current_user)

        try:
            async with redis_connection() as redis:
                cache_key = REDIS_KEY_CHAT_CONTEXT_USAGE.format(chat_id=str(chat_id))
                cached = await redis.get(cache_key)
                if cached:
                    data = json.loads(cached)
                    return ContextUsage(
                        tokens_used=data.get("tokens_used", 0),
                        context_window=data.get(
                            "context_window", settings.CONTEXT_WINDOW_TOKENS
                        ),
                        percentage=data.get("percentage", 0.0),
                    )
        except (RedisError, json.JSONDecodeError, KeyError) as exc:
            logger.warning("Failed to get context usage from cache: %s", exc)

        tokens_used = chat.context_token_usage or 0
        context_window = settings.CONTEXT_WINDOW_TOKENS
        percentage = 0.0
        if context_window > 0:
            percentage = min((tokens_used / context_window) * 100, 100.0)

        return ContextUsage(
            tokens_used=tokens_used,
            context_window=context_window,
            percentage=percentage,
        )
