from typing import cast
from uuid import UUID

from redis.exceptions import RedisError

from app.models.db_models import User
from app.models.schemas import QueuedMessage
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode
from app.services.queue import QueueService
from app.utils.redis import redis_connection


class UpdateQueuedMessageAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        chat_id: UUID,
        content: str,
        current_user: User,
    ) -> QueuedMessage:
        await self._chat_service.get_chat(chat_id, current_user)

        try:
            async with redis_connection() as redis:
                queue_service = QueueService(redis)
                result = await queue_service.update_message(str(chat_id), content)
                if result is None:
                    raise ChatException(
                        "No queued message found",
                        error_code=ErrorCode.MESSAGE_NOT_FOUND,
                        status_code=404,
                    )
                return cast(QueuedMessage, result)
        except RedisError as exc:
            raise ChatException(
                "Service temporarily unavailable",
                error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                status_code=503,
            ) from exc
