from typing import cast

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import User, UserSettings
from app.models.schemas.marketplace import (
    InstallComponentResult,
    UninstallComponentsRequest,
    UninstallResponse,
)
from app.models.types import InstalledPluginDict
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import UserException
from app.services.marketplace import MarketplaceService
from app.services.plugin_installer import PluginInstallerService
from app.services.skill import SkillService
from app.services.user import UserService


class UninstallPluginComponentsAction:
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

    async def execute(
        self,
        request: UninstallComponentsRequest,
        current_user: User,
        db: AsyncSession,
    ) -> UninstallResponse:
        try:
            user_settings = cast(
                UserSettings,
                await self._user_service.get_user_settings(current_user.id, db=db, for_update=True),
            )
        except UserException as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        uninstalled: list[str] = []
        failed: list[InstallComponentResult] = []
        user_id = str(current_user.id)

        installed_plugins: list[InstalledPluginDict] = list(user_settings.installed_plugins or [])

        for component_id in request.components:
            if ":" not in component_id:
                failed.append(InstallComponentResult(component=component_id, success=False, error="Invalid component format"))
                continue

            comp_type, comp_name = component_id.split(":", 1)

            try:
                if comp_type == "agent":
                    agents = list(user_settings.custom_agents or [])
                    idx = next((i for i, a in enumerate(agents) if a.get("name") == comp_name), None)
                    if idx is not None:
                        await self._agent_service.delete(user_id, comp_name)
                        agents.pop(idx)
                        user_settings.custom_agents = agents if agents else None
                        uninstalled.append(component_id)
                    else:
                        failed.append(InstallComponentResult(component=component_id, success=False, error="Agent not found"))

                elif comp_type == "command":
                    commands = list(user_settings.custom_slash_commands or [])
                    idx = next((i for i, c in enumerate(commands) if c.get("name") == comp_name), None)
                    if idx is not None:
                        await self._command_service.delete(user_id, comp_name)
                        commands.pop(idx)
                        user_settings.custom_slash_commands = commands if commands else None
                        uninstalled.append(component_id)
                    else:
                        failed.append(InstallComponentResult(component=component_id, success=False, error="Command not found"))

                elif comp_type == "skill":
                    skills = list(user_settings.custom_skills or [])
                    idx = next((i for i, s in enumerate(skills) if s.get("name") == comp_name), None)
                    if idx is not None:
                        await self._skill_service.delete(user_id, comp_name)
                        skills.pop(idx)
                        user_settings.custom_skills = skills if skills else None
                        uninstalled.append(component_id)
                    else:
                        failed.append(InstallComponentResult(component=component_id, success=False, error="Skill not found"))

                elif comp_type == "mcp":
                    mcps = list(user_settings.custom_mcps or [])
                    idx = next((i for i, m in enumerate(mcps) if m.get("name") == comp_name), None)
                    if idx is not None:
                        mcps.pop(idx)
                        user_settings.custom_mcps = mcps if mcps else None
                        uninstalled.append(component_id)
                    else:
                        failed.append(InstallComponentResult(component=component_id, success=False, error="MCP not found"))

                else:
                    failed.append(InstallComponentResult(component=component_id, success=False, error=f"Unsupported component type: {comp_type}"))

            except Exception as exc:
                failed.append(InstallComponentResult(component=component_id, success=False, error=str(exc)))

        if uninstalled:
            remaining_components = set(installed_plugins[0].get("components", [])) if installed_plugins else set()
            remaining_components.difference_update(uninstalled)

            if installed_plugins:
                updated_plugins: list[InstalledPluginDict] = []
                for plugin in installed_plugins:
                    plugin_components = set(plugin.get("components", []))
                    plugin_components.difference_update(uninstalled)
                    if plugin_components:
                        plugin["components"] = list(plugin_components)
                        updated_plugins.append(plugin)
                user_settings.installed_plugins = updated_plugins if updated_plugins else None

            flag_modified(user_settings, "custom_agents")
            flag_modified(user_settings, "custom_slash_commands")
            flag_modified(user_settings, "custom_skills")
            flag_modified(user_settings, "custom_mcps")
            flag_modified(user_settings, "installed_plugins")

            await self._user_service.commit_settings_and_invalidate_cache(user_settings, db, current_user.id)

        return UninstallResponse(uninstalled=uninstalled, failed=failed)
