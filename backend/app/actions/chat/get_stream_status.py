import logging
from typing import Any
from uuid import UUID

from celery.exceptions import NotRegistered
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError

from app.constants import REDIS_KEY_CHAT_REVOKED, REDIS_KEY_CHAT_TASK
from app.core.celery import celery_app
from app.models.db_models import MessageStreamStatus, User
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode
from app.utils.redis import redis_connection

logger = logging.getLogger(__name__)

INACTIVE_TASK_RESPONSE = {
    "has_active_task": False,
    "stream_id": None,
    "last_seq": 0,
}


class GetStreamStatusAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, chat_id: UUID, current_user: User) -> dict[str, Any]:
        await self._chat_service.get_chat(chat_id, current_user)

        try:
            latest_assistant_message = (
                await self._chat_service.message_service.get_latest_assistant_message(
                    chat_id
                )
            )

            task_key = REDIS_KEY_CHAT_TASK.format(chat_id=chat_id)
            revoked_key = REDIS_KEY_CHAT_REVOKED.format(chat_id=chat_id)

            if latest_assistant_message and latest_assistant_message.stream_status in {
                MessageStreamStatus.COMPLETED,
                MessageStreamStatus.FAILED,
                MessageStreamStatus.INTERRUPTED,
            }:
                async with redis_connection() as redis:
                    await redis.delete(task_key)
                return INACTIVE_TASK_RESPONSE.copy()

            async with redis_connection() as redis:
                task_id = await redis.get(task_key)

                if not task_id:
                    return INACTIVE_TASK_RESPONSE.copy()

                revoked = await redis.get(revoked_key)
                if revoked:
                    await redis.delete(task_key)
                    return INACTIVE_TASK_RESPONSE.copy()

                try:
                    task_result = celery_app.AsyncResult(task_id)
                    task_state = task_result.state
                except NotRegistered:
                    await redis.delete(task_key)
                    return INACTIVE_TASK_RESPONSE.copy()

                if task_state not in {"PENDING", "STARTED", "PROGRESS"}:
                    await redis.delete(task_key)
                    return INACTIVE_TASK_RESPONSE.copy()

                return {
                    "has_active_task": True,
                    "message_id": latest_assistant_message.id
                    if latest_assistant_message
                    else None,
                    "stream_id": latest_assistant_message.active_stream_id
                    if latest_assistant_message
                    else None,
                    "last_seq": latest_assistant_message.last_seq
                    if latest_assistant_message
                    else 0,
                }
        except RedisError as exc:
            logger.error(
                "Redis error checking chat status %s: %s",
                chat_id,
                exc,
                exc_info=True,
            )
            raise ChatException(
                "Service temporarily unavailable",
                error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                status_code=503,
            ) from exc
        except SQLAlchemyError as exc:
            logger.error(
                "Database error checking chat status %s: %s",
                chat_id,
                exc,
                exc_info=True,
            )
            raise ChatException(
                "Failed to check chat status",
                error_code=ErrorCode.UNKNOWN_ERROR,
                status_code=500,
            ) from exc
