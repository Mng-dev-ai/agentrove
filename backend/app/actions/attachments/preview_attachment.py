from uuid import UUID

from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.attachments.common import build_file_response, get_attachment_with_path
from app.models.db_models import User
from app.services.chat import ChatService


class PreviewAttachmentAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        attachment_id: UUID,
        current_user: User,
        db: AsyncSession,
    ) -> FileResponse:
        attachment, file_path = await get_attachment_with_path(
            attachment_id, current_user, db, self._chat_service
        )
        return build_file_response(file_path, attachment.filename, inline=True)
