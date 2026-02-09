from uuid import UUID

from redis.exceptions import RedisError

from app.models.db_models import User
from app.models.schemas import QueuedMessage
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode
from app.services.queue import QueueService
from app.utils.redis import redis_connection


class GetQueueAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, chat_id: UUID, current_user: User) -> QueuedMessage | None:
        await self._chat_service.get_chat(chat_id, current_user)

        try:
            async with redis_connection() as redis:
                queue_service = QueueService(redis)
                return await queue_service.get_message(str(chat_id))
        except RedisError as exc:
            raise ChatException(
                "Service temporarily unavailable",
                error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                status_code=503,
            ) from exc
