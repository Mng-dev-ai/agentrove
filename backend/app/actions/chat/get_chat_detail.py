from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.models.db_models import Chat, User
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode


class GetChatDetailAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, chat_id: UUID, current_user: User) -> Chat:
        try:
            return await self._chat_service.get_chat(chat_id, current_user)
        except ChatException:
            raise
        except SQLAlchemyError as exc:
            raise ChatException(
                "Database error while retrieving chat",
                error_code=ErrorCode.UNKNOWN_ERROR,
                status_code=500,
            ) from exc
