from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import UserSettings
from app.models.types import CustomSlashCommandDict
from app.services.command import CommandService
from app.services.exceptions import CommandException, UserException
from app.services.user import UserService


class UpdateCommandAction:
    def __init__(
        self, command_service: CommandService, user_service: UserService
    ) -> None:
        self._command_service = command_service
        self._user_service = user_service

    async def execute(
        self,
        user_id: UUID,
        command_name: str,
        content: str,
        db: AsyncSession,
    ) -> CustomSlashCommandDict:
        try:
            sanitized_name = self._command_service.sanitize_name(command_name)
            if sanitized_name != command_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid command name format",
                )
        except CommandException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

        try:
            user_settings = cast(
                UserSettings,
                await self._user_service.get_user_settings(
                    user_id, db=db, for_update=True
                ),
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        current_commands: list[CustomSlashCommandDict] = (
            user_settings.custom_slash_commands or []
        )
        command_index = next(
            (
                i
                for i, c in enumerate(current_commands)
                if c.get("name") == command_name
            ),
            None,
        )

        if command_index is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Command '{command_name}' not found",
            )

        try:
            updated_command = await self._command_service.update(
                str(user_id), command_name, content, current_commands
            )
        except CommandException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

        current_commands[command_index] = updated_command
        user_settings.custom_slash_commands = current_commands
        flag_modified(user_settings, "custom_slash_commands")

        try:
            await self._user_service.commit_settings_and_invalidate_cache(
                user_settings, db, user_id
            )
        except Exception as exc:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update command",
            ) from exc

        return updated_command
