import json
import logging
from uuid import UUID

from redis.exceptions import RedisError

from app.constants import REDIS_KEY_PERMISSION_RESPONSE
from app.models.db_models import User
from app.models.schemas import PermissionRespondResponse
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode
from app.services.permission_manager import PermissionManager
from app.utils.redis import redis_connection

logger = logging.getLogger(__name__)


class RespondPermissionAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        chat_id: UUID,
        request_id: str,
        approved: bool,
        alternative_instruction: str | None,
        user_answers: str | None,
        current_user: User,
    ) -> PermissionRespondResponse:
        await self._chat_service.get_chat(chat_id, current_user)

        parsed_answers = None
        if user_answers:
            try:
                parsed_answers = json.loads(user_answers)
            except json.JSONDecodeError as exc:
                logger.error("Invalid JSON in user_answers: %s", exc)
                raise ChatException(
                    "Invalid JSON format for user_answers",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                ) from exc
            if not isinstance(parsed_answers, dict):
                raise ChatException(
                    "user_answers must be a JSON object",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )

        try:
            async with redis_connection() as redis:
                permission_manager = PermissionManager(redis)
                success = await permission_manager.respond_to_permission(
                    request_id,
                    approved,
                    alternative_instruction,
                    parsed_answers,
                )

                if not success:
                    try:
                        expired_response = json.dumps(
                            {
                                "approved": False,
                                "alternative_instruction": "Permission request expired. Please try again.",
                            }
                        )
                        channel = REDIS_KEY_PERMISSION_RESPONSE.format(
                            request_id=request_id
                        )
                        await redis.publish(channel, expired_response)
                    except Exception as exc:
                        logger.warning("Failed to publish expired message: %s", exc)

                    raise ChatException(
                        "Permission request not found or expired",
                        error_code=ErrorCode.VALIDATION_ERROR,
                        status_code=404,
                    )

                return PermissionRespondResponse(success=True)

        except RedisError as exc:
            logger.error(
                "Redis error responding to permission %s: %s",
                request_id,
                exc,
                exc_info=True,
            )
            raise ChatException(
                "Service temporarily unavailable",
                error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                status_code=503,
            ) from exc
