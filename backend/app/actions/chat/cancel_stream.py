import logging
from uuid import UUID

from redis.exceptions import RedisError

from app.constants import (
    REDIS_KEY_CHAT_CANCEL,
    REDIS_KEY_CHAT_REVOKED,
    REDIS_KEY_CHAT_TASK,
)
from app.core.config import get_settings
from app.models.db_models import User
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode
from app.utils.redis import redis_connection

logger = logging.getLogger(__name__)
settings = get_settings()


class CancelStreamAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, chat_id: UUID, current_user: User) -> None:
        await self._chat_service.get_chat(chat_id, current_user)

        try:
            async with redis_connection() as redis:
                task_key = REDIS_KEY_CHAT_TASK.format(chat_id=chat_id)
                task_id = await redis.get(task_key)

                if not task_id:
                    return

                try:
                    await redis.setex(
                        REDIS_KEY_CHAT_REVOKED.format(chat_id=chat_id),
                        settings.CHAT_REVOKED_KEY_TTL_SECONDS,
                        "1",
                    )
                    await redis.publish(
                        REDIS_KEY_CHAT_CANCEL.format(chat_id=chat_id), "cancel"
                    )
                except RedisError as exc:
                    logger.error(
                        "Failed to stop chat stream %s: %s",
                        chat_id,
                        exc,
                        exc_info=True,
                    )

        except RedisError as exc:
            logger.error(
                "Redis error stopping chat stream %s: %s",
                chat_id,
                exc,
                exc_info=True,
            )
            raise ChatException(
                "Service temporarily unavailable",
                error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                status_code=503,
            ) from exc
