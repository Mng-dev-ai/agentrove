from typing import cast
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import UserSettings
from app.models.types import CustomAgentDict
from app.services.agent import AgentService
from app.services.exceptions import AgentException, UserException
from app.services.user import UserService


class UploadAgentAction:
    def __init__(self, agent_service: AgentService, user_service: UserService) -> None:
        self._agent_service = agent_service
        self._user_service = user_service

    async def execute(
        self, user_id: UUID, file: UploadFile, db: AsyncSession
    ) -> CustomAgentDict:
        try:
            user_settings = cast(
                UserSettings,
                await self._user_service.get_user_settings(
                    user_id, db=db, for_update=True
                ),
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        current_agents: list[CustomAgentDict] = user_settings.custom_agents or []

        try:
            agent_data = await self._agent_service.upload(
                str(user_id), file, current_agents
            )
        except AgentException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

        current_agents.append(agent_data)
        user_settings.custom_agents = current_agents
        flag_modified(user_settings, "custom_agents")

        try:
            await self._user_service.commit_settings_and_invalidate_cache(
                user_settings, db, user_id
            )
        except Exception as exc:
            await self._agent_service.delete(str(user_id), str(agent_data["name"]))
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save agent metadata",
            ) from exc

        return agent_data
