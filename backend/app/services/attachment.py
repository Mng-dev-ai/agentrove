import mimetypes
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models.chat import MessageAttachment
from app.services.exceptions import AttachmentException, ErrorCode
from app.services.message import MessageService

settings = get_settings()


class AttachmentService:
    def __init__(self, message_service: MessageService) -> None:
        self._message_service = message_service
        # Canonical base for per-request path checks.
        self._storage_base = Path(settings.STORAGE_PATH).resolve()

    async def get_temp_preview(self, path: str, user_id: UUID) -> FileResponse:
        user_temp_base = (self._storage_base / "temp" / str(user_id)).resolve()
        # resolve() normalises ".." segments so path-traversal attacks can't escape the user's temp dir
        file_path = (self._storage_base / path).resolve()

        if not file_path.is_relative_to(user_temp_base):
            raise AttachmentException(
                "Access denied",
                error_code=ErrorCode.CHAT_ACCESS_DENIED,
                status_code=403,
            )

        if not file_path.exists():
            raise AttachmentException(
                "File not found",
                error_code=ErrorCode.STORAGE_FILE_NOT_FOUND,
                status_code=404,
            )

        return self._build_file_response(file_path, file_path.name, inline=True)

    async def get_preview(
        self, attachment_id: UUID, user_id: UUID, db: AsyncSession
    ) -> FileResponse:
        attachment, file_path = await self._get_attachment_with_path(
            attachment_id, user_id, db
        )
        return self._build_file_response(file_path, attachment.filename, inline=True)

    async def get_download(
        self, attachment_id: UUID, user_id: UUID, db: AsyncSession
    ) -> FileResponse:
        attachment, file_path = await self._get_attachment_with_path(
            attachment_id, user_id, db
        )
        return self._build_file_response(file_path, attachment.filename, inline=False)

    async def _get_attachment_with_path(
        self, attachment_id: UUID, user_id: UUID, db: AsyncSession
    ) -> tuple[MessageAttachment, Path]:
        attachment = await self._message_service.get_attachment(attachment_id, db)

        if not attachment:
            raise AttachmentException(
                "Attachment not found",
                error_code=ErrorCode.STORAGE_FILE_NOT_FOUND,
                status_code=404,
            )

        if attachment.message.chat.user_id != user_id:
            raise AttachmentException(
                "Access denied",
                error_code=ErrorCode.CHAT_ACCESS_DENIED,
                status_code=403,
            )

        file_path = (self._storage_base / attachment.file_path).resolve()

        # Guard against stored paths that resolve outside the storage directory
        if not file_path.is_relative_to(self._storage_base):
            raise AttachmentException(
                "Access denied",
                error_code=ErrorCode.CHAT_ACCESS_DENIED,
                status_code=403,
            )

        # Pre-check so we return a clean 404 instead of Starlette's default 500 RuntimeError
        if not file_path.exists():
            raise AttachmentException(
                "File not found",
                error_code=ErrorCode.STORAGE_FILE_NOT_FOUND,
                status_code=404,
            )

        return attachment, file_path

    @staticmethod
    def _build_file_response(
        file_path: Path, filename: str | None, *, inline: bool
    ) -> FileResponse:
        safe_filename = filename or file_path.name or "file"
        disposition = "inline" if inline else "attachment"

        # RFC 5987: dual filename header — ASCII fallback for old clients, UTF-8 for modern ones
        ascii_filename = (
            safe_filename.encode("ascii", "ignore").decode("ascii") or "file"
        )
        encoded_filename = quote(safe_filename, safe="")

        # Explicit guess so we can fall back to octet-stream (Starlette defaults to text/plain)
        mime_type, _ = mimetypes.guess_type(str(file_path))

        headers = {
            "Content-Disposition": f"{disposition}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}",
        }
        if inline:
            headers["Cache-Control"] = "private, max-age=3600"

        return FileResponse(
            path=file_path,
            media_type=mime_type or "application/octet-stream",
            headers=headers,
        )
