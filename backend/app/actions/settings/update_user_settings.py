from uuid import UUID

from app.models.schemas import UserSettingsBase, UserSettingsResponse
from app.services.user import UserService
from app.utils.redis import redis_connection


class UpdateUserSettingsAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        settings_update: UserSettingsBase,
        db: object,
    ) -> UserSettingsResponse:
        update_data = settings_update.model_dump(exclude_unset=True)
        user_settings = await self._user_service.update_user_settings(
            user_id=user_id,
            settings_update=update_data,
            db=db,
        )
        async with redis_connection() as redis:
            await self._user_service.invalidate_settings_cache(redis, user_id)
        return UserSettingsResponse.model_validate(user_settings)
