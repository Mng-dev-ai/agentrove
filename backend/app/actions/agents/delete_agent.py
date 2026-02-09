from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import DeleteResponseStatus
from app.models.schemas import AgentDeleteResponse
from app.services.agent import AgentService
from app.services.exceptions import AgentException, UserException
from app.services.user import UserService


class DeleteAgentAction:
    def __init__(self, agent_service: AgentService, user_service: UserService) -> None:
        self._agent_service = agent_service
        self._user_service = user_service

    async def execute(self, user_id: UUID, agent_name: str, db: AsyncSession) -> AgentDeleteResponse:
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
            user_settings = await self._user_service.get_user_settings(user_id, db=db, for_update=True)
        except UserException as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        current_agents = user_settings.custom_agents or []
        agent_index = next((i for i, c in enumerate(current_agents) if c.get("name") == agent_name), None)

        if agent_index is None:
            return AgentDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

        await self._agent_service.delete(str(user_id), agent_name)

        current_agents.pop(agent_index)
        user_settings.custom_agents = current_agents
        flag_modified(user_settings, "custom_agents")

        if self._user_service.remove_installed_component(user_settings, f"agent:{agent_name}"):
            flag_modified(user_settings, "installed_plugins")

        await self._user_service.commit_settings_and_invalidate_cache(user_settings, db, user_id)

        return AgentDeleteResponse(status=DeleteResponseStatus.DELETED.value)
