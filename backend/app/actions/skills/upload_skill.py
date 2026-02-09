from typing import cast
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import UserSettings
from app.models.types import CustomSkillDict
from app.services.exceptions import SkillException, UserException
from app.services.skill import SkillService
from app.services.user import UserService


class UploadSkillAction:
    def __init__(self, skill_service: SkillService, user_service: UserService) -> None:
        self._skill_service = skill_service
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        file: UploadFile,
        db: AsyncSession,
    ) -> CustomSkillDict:
        try:
            user_settings = cast(
                UserSettings,
                await self._user_service.get_user_settings(user_id, db=db, for_update=True),
            )
        except UserException as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        current_skills: list[CustomSkillDict] = user_settings.custom_skills or []

        try:
            skill_data = await self._skill_service.upload(str(user_id), file, current_skills)
        except SkillException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        current_skills.append(skill_data)
        user_settings.custom_skills = current_skills
        flag_modified(user_settings, "custom_skills")

        try:
            await self._user_service.commit_settings_and_invalidate_cache(user_settings, db, user_id)
        except Exception as exc:
            await self._skill_service.delete(str(user_id), skill_data["name"])
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save skill metadata",
            ) from exc

        return skill_data
