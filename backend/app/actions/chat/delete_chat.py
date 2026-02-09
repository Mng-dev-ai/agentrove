from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.models.db_models import User
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode


class DeleteChatAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, chat_id: UUID, current_user: User) -> None:
        try:
            await self._chat_service.delete_chat(chat_id, current_user)
        except ChatException:
            raise
        except SQLAlchemyError as exc:
            raise ChatException(
                "Database error while deleting chat",
                error_code=ErrorCode.UNKNOWN_ERROR,
                status_code=500,
            ) from exc
