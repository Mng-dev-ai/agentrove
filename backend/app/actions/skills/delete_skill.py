from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import DeleteResponseStatus
from app.models.schemas import SkillDeleteResponse
from app.services.exceptions import SkillException, UserException
from app.services.skill import SkillService
from app.services.user import UserService


class DeleteSkillAction:
    def __init__(self, skill_service: SkillService, user_service: UserService) -> None:
        self._skill_service = skill_service
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        skill_name: str,
        db: AsyncSession,
    ) -> SkillDeleteResponse:
        try:
            sanitized_name = self._skill_service.sanitize_name(skill_name)
            if sanitized_name != skill_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid skill name format",
                )
        except SkillException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        try:
            user_settings = await self._user_service.get_user_settings(user_id, db=db, for_update=True)
        except UserException as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        current_skills = user_settings.custom_skills or []
        skill_index = next((i for i, s in enumerate(current_skills) if s.get("name") == skill_name), None)

        if skill_index is None:
            return SkillDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

        await self._skill_service.delete(str(user_id), skill_name)

        current_skills.pop(skill_index)
        user_settings.custom_skills = current_skills
        flag_modified(user_settings, "custom_skills")

        if self._user_service.remove_installed_component(user_settings, f"skill:{skill_name}"):
            flag_modified(user_settings, "installed_plugins")

        await self._user_service.commit_settings_and_invalidate_cache(user_settings, db, user_id)

        return SkillDeleteResponse(status=DeleteResponseStatus.DELETED.value)
