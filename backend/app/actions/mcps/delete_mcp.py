from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.actions.mcps.common import SAFE_NAME_PATTERN
from app.models.db_models import DeleteResponseStatus
from app.models.schemas import McpDeleteResponse
from app.services.exceptions import UserException
from app.services.user import UserService


class DeleteMcpAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(
        self, user_id: UUID, mcp_name: str, db: AsyncSession
    ) -> McpDeleteResponse:
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

        current_mcps = user_settings.custom_mcps or []
        mcp_index = next(
            (i for i, m in enumerate(current_mcps) if m.get("name") == mcp_name), None
        )

        if mcp_index is None:
            return McpDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

        current_mcps.pop(mcp_index)
        user_settings.custom_mcps = current_mcps
        flag_modified(user_settings, "custom_mcps")

        if self._user_service.remove_installed_component(
            user_settings, f"mcp:{mcp_name}"
        ):
            flag_modified(user_settings, "installed_plugins")

        await self._user_service.commit_settings_and_invalidate_cache(
            user_settings, db, user_id
        )

        return McpDeleteResponse(status=DeleteResponseStatus.DELETED.value)
