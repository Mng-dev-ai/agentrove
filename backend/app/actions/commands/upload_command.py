from typing import cast
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import UserSettings
from app.models.types import CustomSlashCommandDict
from app.services.command import CommandService
from app.services.exceptions import CommandException, UserException
from app.services.user import UserService


class UploadCommandAction:
    def __init__(
        self, command_service: CommandService, user_service: UserService
    ) -> None:
        self._command_service = command_service
        self._user_service = user_service

    async def execute(
        self, user_id: UUID, file: UploadFile, db: AsyncSession
    ) -> CustomSlashCommandDict:
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

        try:
            command_data = await self._command_service.upload(
                str(user_id), file, current_commands
            )
        except CommandException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

        current_commands.append(command_data)
        user_settings.custom_slash_commands = current_commands
        flag_modified(user_settings, "custom_slash_commands")

        try:
            await self._user_service.commit_settings_and_invalidate_cache(
                user_settings, db, user_id
            )
        except Exception as exc:
            await self._command_service.delete(str(user_id), command_data["name"])
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save command metadata",
            ) from exc

        return command_data
