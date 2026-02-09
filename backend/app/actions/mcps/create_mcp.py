from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.actions.mcps.common import MAX_MCPS_PER_USER, SAFE_NAME_PATTERN
from app.models.schemas import McpCreateRequest
from app.models.types import CustomMcpDict
from app.services.exceptions import UserException
from app.services.user import UserService


class CreateMcpAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        request: McpCreateRequest,
        db: AsyncSession,
    ) -> CustomMcpDict:
        if not SAFE_NAME_PATTERN.match(request.name):
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

        if len(current_mcps) >= MAX_MCPS_PER_USER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Maximum {MAX_MCPS_PER_USER} MCPs per user",
            )

        if any(m.get("name") == request.name for m in current_mcps):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"MCP '{request.name}' already exists",
            )

        mcp_data: CustomMcpDict = {
            "name": request.name,
            "description": request.description,
            "command_type": request.command_type,
            "package": request.package,
            "url": request.url,
            "env_vars": request.env_vars,
            "args": request.args,
            "enabled": request.enabled,
        }

        current_mcps.append(mcp_data)
        user_settings.custom_mcps = current_mcps
        flag_modified(user_settings, "custom_mcps")

        await self._user_service.commit_settings_and_invalidate_cache(
            user_settings, db, user_id
        )

        return mcp_data
