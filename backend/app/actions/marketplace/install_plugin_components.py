from typing import Any, cast

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import User, UserSettings
from app.models.schemas.marketplace import InstallComponentRequest, InstallResponse
from app.models.types import (
    CustomAgentDict,
    CustomMcpDict,
    CustomSkillDict,
    CustomSlashCommandDict,
    InstalledPluginDict,
)
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import MarketplaceException, UserException
from app.services.marketplace import MarketplaceService
from app.services.plugin_installer import PluginInstallerService
from app.services.skill import SkillService
from app.services.user import UserService


class InstallPluginComponentsAction:
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

    @staticmethod
    def _append_if_not_exists(items: list[Any], new_item: Any) -> None:
        if not any(item.get("name") == new_item.get("name") for item in items):
            items.append(new_item)

    async def execute(
        self,
        request: InstallComponentRequest,
        current_user: User,
        db: AsyncSession,
    ) -> InstallResponse:
        try:
            user_settings_readonly = await self._user_service.get_user_settings(
                current_user.id, db=db, for_update=False
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        current_agents: list[CustomAgentDict] = list(
            user_settings_readonly.custom_agents or []
        )
        current_commands: list[CustomSlashCommandDict] = list(
            user_settings_readonly.custom_slash_commands or []
        )
        current_skills: list[CustomSkillDict] = list(
            user_settings_readonly.custom_skills or []
        )
        current_mcps: list[CustomMcpDict] = list(
            user_settings_readonly.custom_mcps or []
        )

        try:
            details = await self._marketplace_service.get_plugin_details(
                request.plugin_name
            )
        except MarketplaceException as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

        try:
            result = await self._installer_service.install_components(
                user_id=str(current_user.id),
                plugin_name=request.plugin_name,
                components=request.components,
                current_agents=current_agents,
                current_commands=current_commands,
                current_skills=current_skills,
                current_mcps=current_mcps,
            )
        except MarketplaceException as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

        if result.installed:
            try:
                user_settings = cast(
                    UserSettings,
                    await self._user_service.get_user_settings(
                        current_user.id, db=db, for_update=True
                    ),
                )
            except UserException as exc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
                ) from exc

            if user_settings.custom_agents is None:
                user_settings.custom_agents = []
            for agent in result.new_agents:
                self._append_if_not_exists(user_settings.custom_agents, agent)

            if user_settings.custom_slash_commands is None:
                user_settings.custom_slash_commands = []
            for cmd in result.new_commands:
                self._append_if_not_exists(user_settings.custom_slash_commands, cmd)

            if user_settings.custom_skills is None:
                user_settings.custom_skills = []
            for skill in result.new_skills:
                self._append_if_not_exists(user_settings.custom_skills, skill)

            if user_settings.custom_mcps is None:
                user_settings.custom_mcps = []
            for mcp in result.new_mcps:
                self._append_if_not_exists(user_settings.custom_mcps, mcp)

            installed_plugins: list[InstalledPluginDict] = list(
                user_settings.installed_plugins or []
            )
            existing_idx = next(
                (
                    i
                    for i, p in enumerate(installed_plugins)
                    if p["name"] == request.plugin_name
                ),
                None,
            )
            record = self._installer_service.create_installed_record(
                request.plugin_name,
                details.get("version"),
                result.installed,
            )
            if existing_idx is not None:
                existing_comps = set(
                    installed_plugins[existing_idx].get("components", [])
                )
                existing_comps.update(result.installed)
                record["components"] = list(existing_comps)
                installed_plugins[existing_idx] = record
            else:
                installed_plugins.append(record)
            user_settings.installed_plugins = installed_plugins

            flag_modified(user_settings, "custom_agents")
            flag_modified(user_settings, "custom_slash_commands")
            flag_modified(user_settings, "custom_skills")
            flag_modified(user_settings, "custom_mcps")
            flag_modified(user_settings, "installed_plugins")

            await self._user_service.commit_settings_and_invalidate_cache(
                user_settings, db, current_user.id
            )

        return InstallResponse(
            plugin_name=request.plugin_name,
            version=details.get("version"),
            installed=result.installed,
            failed=result.failed,
        )
