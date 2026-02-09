from uuid import UUID

from app.models.schemas import AIModelResponse
from app.services.provider import ProviderService
from app.services.user import UserService
from app.utils.redis import redis_connection


class ListModelsAction:
    def __init__(
        self,
        provider_service: ProviderService,
        user_service: UserService,
    ) -> None:
        self._provider_service = provider_service
        self._user_service = user_service

    async def execute(self, user_id: UUID) -> list[AIModelResponse]:
        async with redis_connection() as redis:
            user_settings = await self._user_service.get_user_settings(user_id, redis=redis)
            models = self._provider_service.get_all_models(user_settings)
            return [AIModelResponse(**model) for model in models]
