from sqlalchemy.exc import SQLAlchemyError

from app.models.db_models import User
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode


class DeleteAllChatsAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, current_user: User) -> int:
        try:
            return await self._chat_service.delete_all_chats(current_user)
        except SQLAlchemyError as exc:
            raise ChatException(
                "Database error while deleting chats",
                error_code=ErrorCode.UNKNOWN_ERROR,
                status_code=500,
            ) from exc
