from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.models.db_models import Chat, User
from app.models.schemas import ChatUpdate
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode


class UpdateChatAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        chat_id: UUID,
        chat_update: ChatUpdate,
        current_user: User,
    ) -> Chat:
        try:
            return await self._chat_service.update_chat(chat_id, chat_update, current_user)
        except ChatException:
            raise
        except SQLAlchemyError as exc:
            raise ChatException(
                "Database error while updating chat",
                error_code=ErrorCode.UNKNOWN_ERROR,
                status_code=500,
            ) from exc
