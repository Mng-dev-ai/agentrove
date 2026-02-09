from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import UserSettings
from app.models.types import CustomAgentDict
from app.services.agent import AgentService
from app.services.exceptions import AgentException, UserException
from app.services.user import UserService


class UpdateAgentAction:
    def __init__(self, agent_service: AgentService, user_service: UserService) -> None:
        self._agent_service = agent_service
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        agent_name: str,
        content: str,
        db: AsyncSession,
    ) -> CustomAgentDict:
        try:
            sanitized_name = self._agent_service.sanitize_name(agent_name)
            if sanitized_name != agent_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid agent name format",
                )
        except AgentException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        try:
            user_settings = cast(
                UserSettings,
                await self._user_service.get_user_settings(user_id, db=db, for_update=True),
            )
        except UserException as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        current_agents: list[CustomAgentDict] = user_settings.custom_agents or []
        agent_index = next((i for i, c in enumerate(current_agents) if c.get("name") == agent_name), None)

        if agent_index is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Agent '{agent_name}' not found",
            )

        try:
            updated_agent = await self._agent_service.update(str(user_id), agent_name, content, current_agents)
        except AgentException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        current_agents[agent_index] = updated_agent
        user_settings.custom_agents = current_agents
        flag_modified(user_settings, "custom_agents")

        try:
            await self._user_service.commit_settings_and_invalidate_cache(user_settings, db, user_id)
        except Exception as exc:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update agent",
            ) from exc

        return updated_agent
