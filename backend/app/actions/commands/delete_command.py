from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import DeleteResponseStatus
from app.models.schemas import CommandDeleteResponse
from app.services.command import CommandService
from app.services.exceptions import CommandException, UserException
from app.services.user import UserService


class DeleteCommandAction:
    def __init__(self, command_service: CommandService, user_service: UserService) -> None:
        self._command_service = command_service
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        command_name: str,
        db: AsyncSession,
    ) -> CommandDeleteResponse:
        try:
            sanitized_name = self._command_service.sanitize_name(command_name)
            if sanitized_name != command_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid command name format",
                )
        except CommandException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        try:
            user_settings = await self._user_service.get_user_settings(user_id, db=db, for_update=True)
        except UserException as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        current_commands = user_settings.custom_slash_commands or []
        command_index = next((i for i, c in enumerate(current_commands) if c.get("name") == command_name), None)

        if command_index is None:
            return CommandDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

        await self._command_service.delete(str(user_id), command_name)

        current_commands.pop(command_index)
        user_settings.custom_slash_commands = current_commands
        flag_modified(user_settings, "custom_slash_commands")

        if self._user_service.remove_installed_component(user_settings, f"command:{command_name}"):
            flag_modified(user_settings, "installed_plugins")

        await self._user_service.commit_settings_and_invalidate_cache(user_settings, db, user_id)

        return CommandDeleteResponse(status=DeleteResponseStatus.DELETED.value)
