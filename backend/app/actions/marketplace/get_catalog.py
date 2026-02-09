from fastapi import HTTPException

from app.models.schemas.marketplace import MarketplacePlugin
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import MarketplaceException
from app.services.marketplace import MarketplaceService
from app.services.plugin_installer import PluginInstallerService
from app.services.skill import SkillService
from app.services.user import UserService


class GetCatalogAction:
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

    async def execute(self, force_refresh: bool) -> list[MarketplacePlugin]:
        try:
            plugins = await self._marketplace_service.fetch_catalog(force_refresh=force_refresh)
            return [MarketplacePlugin(**p) for p in plugins]
        except MarketplaceException as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
