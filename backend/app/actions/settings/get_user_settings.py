import logging
from uuid import UUID

from app.models.schemas import UserSettingsResponse
from app.services.user import UserService
from app.utils.redis import redis_connection

logger = logging.getLogger(__name__)


class GetUserSettingsAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(self, user_id: UUID) -> UserSettingsResponse:
        logger.info("[GET_SETTINGS] Fetching settings for user %s", user_id)
        async with redis_connection() as redis:
            settings_record = await self._user_service.get_user_settings(user_id, redis=redis)
            response = UserSettingsResponse.model_validate(settings_record)
            agent_names = [a.name for a in (response.custom_agents or [])]
            logger.info("[GET_SETTINGS] Returning agents: %s", agent_names)
            return response
