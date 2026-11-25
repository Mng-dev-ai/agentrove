import asyncio
import os
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import get_settings
from app.models.types import AgentKind, MessageAttachmentDict
from app.services.acp.adapters import NATIVE_FILE_TYPES
from app.services.exceptions import StorageException
from app.services.sandbox import SandboxService
from app.utils.attachment_urls import AttachmentURL

settings = get_settings()

DOCUMENT_STORAGE = {
    "application/pdf": ("pdfs", "pdf"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
        "xlsx",
        "xlsx",
    ),
}


class StorageService:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self.sandbox_service = sandbox_service

        self.storage_path = Path(settings.STORAGE_PATH)

        self.storage_path.mkdir(parents=True, exist_ok=True)
        for subdir in ["images", "pdfs", "xlsx"]:
            (self.storage_path / subdir).mkdir(exist_ok=True)

    @staticmethod
    def storage_target(content_type: str | None) -> tuple[str, str] | None:
        if content_type is None or content_type not in settings.ALLOWED_FILE_TYPES:
            return None
        if content_type.startswith("image/"):
            return "images", "image"
        return DOCUMENT_STORAGE.get(content_type)

    @staticmethod
    def allowed_file_types() -> list[str]:
        return [
            content_type
            for content_type in settings.ALLOWED_FILE_TYPES
            if StorageService.storage_target(content_type)
        ]

    async def save_files(
        self,
        files: list[UploadFile],
        agent_kind: AgentKind | None,
        sandbox_id: str | None = None,
        user_id: str | None = None,
    ) -> list[MessageAttachmentDict]:
        return list(
            await asyncio.gather(
                *(
                    self.save_file(file, agent_kind, sandbox_id, user_id)
                    for file in files
                )
            )
        )

    async def save_file(
        self,
        file: UploadFile,
        agent_kind: AgentKind | None,
        sandbox_id: str | None = None,
        user_id: str | None = None,
    ) -> MessageAttachmentDict:
        target = self.storage_target(file.content_type)
        if target is None:
            raise StorageException(f"Invalid file type: {file.content_type}")
        folder, file_type = target

        if not file.filename:
            raise StorageException("Filename is required")

        contents = await file.read()

        if len(contents) > settings.MAX_UPLOAD_SIZE:
            raise StorageException(
                f"File too large: {len(contents)} bytes exceeds {settings.MAX_UPLOAD_SIZE} bytes"
            )

        ext = os.path.splitext(file.filename)[1].lower()
        unique_filename = f"{uuid4()}{ext}"

        if not user_id:
            raise StorageException("user_id is required for temp attachments")

        relative_file_path = f"temp/{user_id}/{folder}/{unique_filename}"
        physical_file_path = self.storage_path / relative_file_path
        physical_file_path.parent.mkdir(parents=True, exist_ok=True)

        physical_file_path.write_bytes(contents)

        file_url = AttachmentURL.build_temp_preview_url(relative_file_path)

        if (
            sandbox_id
            and agent_kind is not None
            and file_type not in NATIVE_FILE_TYPES[agent_kind]
        ):
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
