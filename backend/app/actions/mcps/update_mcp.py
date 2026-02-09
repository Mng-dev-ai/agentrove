from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.actions.mcps.common import SAFE_NAME_PATTERN
from app.models.schemas import McpUpdateRequest
from app.models.types import CustomMcpDict
from app.services.exceptions import UserException
from app.services.user import UserService


class UpdateMcpAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        mcp_name: str,
        request: McpUpdateRequest,
        db: AsyncSession,
    ) -> CustomMcpDict:
        if not SAFE_NAME_PATTERN.match(mcp_name):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid MCP name format",
            )

        try:
            user_settings = await self._user_service.get_user_settings(
                user_id, db=db, for_update=True
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        current_mcps: list[CustomMcpDict] = cast(
            list[CustomMcpDict], user_settings.custom_mcps or []
        )
        mcp_index = next(
            (i for i, m in enumerate(current_mcps) if m.get("name") == mcp_name), None
        )

        if mcp_index is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"MCP '{mcp_name}' not found",
            )

        mcp = current_mcps[mcp_index]

        if (
            "description" in request.model_fields_set
            and request.description is not None
        ):
            mcp["description"] = request.description
        if (
            "command_type" in request.model_fields_set
            and request.command_type is not None
        ):
            mcp["command_type"] = request.command_type
        if "package" in request.model_fields_set:
            mcp["package"] = request.package
        if "url" in request.model_fields_set:
            mcp["url"] = request.url
        if "env_vars" in request.model_fields_set:
            mcp["env_vars"] = request.env_vars
        if "args" in request.model_fields_set:
            mcp["args"] = request.args
        if "enabled" in request.model_fields_set and request.enabled is not None:
            mcp["enabled"] = request.enabled

        user_settings.custom_mcps = current_mcps
        flag_modified(user_settings, "custom_mcps")

        await self._user_service.commit_settings_and_invalidate_cache(
            user_settings, db, user_id
        )

        return mcp
