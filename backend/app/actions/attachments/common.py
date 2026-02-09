import mimetypes
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models import MessageAttachment, User
from app.services.chat import ChatService

settings = get_settings()


def get_mime_type(file_path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(file_path))
    return mime_type or "application/octet-stream"


def build_file_response(
    file_path: Path,
    filename: str | None,
    *,
    inline: bool,
) -> FileResponse:
    safe_filename = filename or file_path.name or "file"
    disposition = "inline" if inline else "attachment"
    ascii_filename = safe_filename.encode("ascii", "ignore").decode("ascii") or "file"
    encoded_filename = quote(safe_filename, safe="")

    headers = {
        "Content-Disposition": f"{disposition}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}",
    }
    if inline:
        headers["Cache-Control"] = "private, max-age=3600"

    return FileResponse(
        path=file_path,
        media_type=get_mime_type(file_path),
        headers=headers,
    )


async def get_attachment_with_path(
    attachment_id: UUID,
    current_user: User,
    db: AsyncSession,
    chat_service: ChatService,
) -> tuple[MessageAttachment, Path]:
    attachment = await chat_service.message_service.get_attachment(attachment_id, db)

    if not attachment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )

    if attachment.message.chat.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    storage_base = Path(settings.STORAGE_PATH).resolve()
    file_path = (storage_base / attachment.file_path).resolve()

    if not str(file_path).startswith(str(storage_base)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )

    return attachment, file_path
