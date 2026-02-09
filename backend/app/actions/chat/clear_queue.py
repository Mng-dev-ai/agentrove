from uuid import UUID

from redis.exceptions import RedisError

from app.models.db_models import User
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode
from app.services.queue import QueueService
from app.utils.redis import redis_connection


class ClearQueueAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, chat_id: UUID, current_user: User) -> None:
        await self._chat_service.get_chat(chat_id, current_user)

        try:
            async with redis_connection() as redis:
                queue_service = QueueService(redis)
                success = await queue_service.clear_queue(str(chat_id))
                if not success:
                    raise ChatException(
                        "No queued message found",
                        error_code=ErrorCode.MESSAGE_NOT_FOUND,
                        status_code=404,
                    )
        except RedisError as exc:
            raise ChatException(
                "Service temporarily unavailable",
                error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                status_code=503,
            ) from exc
