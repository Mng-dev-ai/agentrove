from pathlib import Path

from fastapi import HTTPException, status
from fastapi.responses import FileResponse

from app.actions.attachments.common import build_file_response, settings
from app.models.db_models import User


class PreviewTempAttachmentAction:
    async def execute(self, path: str, current_user: User) -> FileResponse:
        storage_base = Path(settings.STORAGE_PATH).resolve()
        user_temp_base = (storage_base / "temp" / str(current_user.id)).resolve()
        file_path = (storage_base / path).resolve()

        if not str(file_path).startswith(str(user_temp_base)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        if not file_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

        return build_file_response(file_path, file_path.name, inline=True)
