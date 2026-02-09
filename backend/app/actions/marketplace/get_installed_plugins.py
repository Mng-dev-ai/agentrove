from typing import cast

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import User
from app.models.schemas.marketplace import InstalledPlugin
from app.models.types import InstalledPluginDict
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import UserException
from app.services.marketplace import MarketplaceService
from app.services.plugin_installer import PluginInstallerService
from app.services.skill import SkillService
from app.services.user import UserService


class GetInstalledPluginsAction:
    def __init__(
        self,
        marketplace_service: MarketplaceService,
        user_service: UserService,
        installer_service: PluginInstallerService,
        agent_service: AgentService,
        command_service: CommandService,
        skill_service: SkillService,
    ) -> None:
        self._marketplace_service = marketplace_service
        self._user_service = user_service
        self._installer_service = installer_service
        self._agent_service = agent_service
        self._command_service = command_service
        self._skill_service = skill_service

    async def execute(self, current_user: User, db: AsyncSession) -> list[InstalledPlugin]:
        try:
            user_settings = await self._user_service.get_user_settings(current_user.id, db=db)
        except UserException as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        installed: list[InstalledPluginDict] = cast(list[InstalledPluginDict], user_settings.installed_plugins or [])
        return [InstalledPlugin(**p) for p in installed]
