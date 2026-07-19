import os
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import get_settings
from app.models.types import MessageAttachmentDict
from app.services.acp.adapters import NATIVE_FILE_TYPES, AgentKind
from app.services.exceptions import StorageException
from app.services.sandbox import SandboxService
from app.utils.attachment_urls import AttachmentURL

settings = get_settings()


class StorageService:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self.sandbox_service = sandbox_service

        self.storage_path = Path(settings.STORAGE_PATH)

        self.storage_path.mkdir(parents=True, exist_ok=True)
        for subdir in ["images", "pdfs", "xlsx"]:
            (self.storage_path / subdir).mkdir(exist_ok=True)

    async def save_file(
        self,
        file: UploadFile,
        agent_kind: AgentKind,
        sandbox_id: str | None = None,
        user_id: str | None = None,
    ) -> MessageAttachmentDict:
        if file.content_type not in settings.ALLOWED_FILE_TYPES:
            raise StorageException(f"Invalid file type: {file.content_type}")

        if not file.filename:
            raise StorageException("Filename is required")

        content_type = file.content_type
        contents = await file.read()

        if len(contents) > settings.MAX_UPLOAD_SIZE:
            raise StorageException(
                f"File too large: {len(contents)} bytes exceeds {settings.MAX_UPLOAD_SIZE} bytes"
            )

        ext = os.path.splitext(file.filename)[1].lower()
        file_type_config = {
            "application/pdf": ("pdfs", "pdf"),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
                "xlsx",
                "xlsx",
            ),
        }

        if content_type.startswith("image/"):
            folder, file_type = "images", "image"
        elif content_type in file_type_config:
            folder, file_type = file_type_config[content_type]
        else:
            raise StorageException(
                f"Unexpected file type: {content_type}. This should have been caught by ALLOWED_FILE_TYPES validation."
            )

        unique_filename = f"{uuid4()}{ext}"

        if not user_id:
            raise StorageException("user_id is required for temp attachments")

        relative_file_path = f"temp/{user_id}/{folder}/{unique_filename}"
        physical_file_path = self.storage_path / relative_file_path
        physical_file_path.parent.mkdir(parents=True, exist_ok=True)

        physical_file_path.write_bytes(contents)

        file_url = AttachmentURL.build_temp_preview_url(relative_file_path)

        if sandbox_id and file_type not in NATIVE_FILE_TYPES[agent_kind]:
            # Fail if sandbox copy unavailable (agent reads from sandbox).
            # Skip write for inline ACP types (dead data; pollutes desktop workspaces).
            # Relative filename so both providers resolve under workspace (Host rejects abs).
            await self.sandbox_service.provider.write_file(
                sandbox_id=sandbox_id, path=unique_filename, content=contents
            )

        return {
            "file_url": file_url,
            "file_path": relative_file_path,
            "file_type": file_type,
            "filename": file.filename,
        }
