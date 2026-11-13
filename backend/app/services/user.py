from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import REDIS_KEY_USER_SETTINGS
from app.core.config import get_settings
from app.models.db_models.user import UserSettings

from app.models.schemas.settings import UserSettingsResponse
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import UserException
from app.utils.cache import CacheStore

settings = get_settings()


class UserService(BaseDbService[UserSettings]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)

    async def invalidate_settings_cache(self, cache: CacheStore, user_id: UUID) -> None:
        cache_key = REDIS_KEY_USER_SETTINGS.format(user_id=user_id)
        await cache.delete(cache_key)

    async def get_user_settings(
        self,
        user_id: UUID,
        db: AsyncSession | None = None,
    ) -> UserSettings:
        stmt = select(UserSettings).where(UserSettings.user_id == user_id)

        user_settings: UserSettings | None
        if db is None:
            async with self.session_factory() as session:
                result = await session.execute(stmt)
                user_settings = result.scalar_one_or_none()
        else:
            result = await db.execute(stmt)
            user_settings = result.scalar_one_or_none()

        if not user_settings:
            raise UserException("User settings not found")

        return user_settings

    async def get_user_settings_response(
        self,
        user_id: UUID,
        db: AsyncSession | None = None,
        cache: CacheStore | None = None,
    ) -> UserSettingsResponse:
        cache_key = REDIS_KEY_USER_SETTINGS.format(user_id=user_id)
        if cache:
            cached = await cache.get(cache_key)
            if cached:
                cached_response: UserSettingsResponse = (
                    UserSettingsResponse.model_validate_json(cached)
                )
                return cached_response

        user_settings = await self.get_user_settings(user_id=user_id, db=db)
        response: UserSettingsResponse = UserSettingsResponse.model_validate(
            user_settings
        )

        if cache:
            await cache.setex(
                cache_key,
                settings.USER_SETTINGS_CACHE_TTL_SECONDS,
                response.model_dump_json(),
            )

        return response

    async def update_user_settings(
        self,
        user_id: UUID,
        settings_update: dict[str, Any],
        db: AsyncSession,
        expected_version: int | None = None,
    ) -> bool:
        if not await db.scalar(
            select(UserSettings.id).where(UserSettings.user_id == user_id)
        ):
            raise UserException("User settings not found")

        stmt = (
            update(UserSettings)
            .where(UserSettings.user_id == user_id)
            .values(
                **settings_update,
                settings_version=UserSettings.settings_version + 1,
            )
        )
        if expected_version is not None:
            stmt = stmt.where(UserSettings.settings_version == expected_version)
        result = await db.execute(stmt)
        await db.commit()
        return bool(result.rowcount)
