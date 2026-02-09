from uuid import UUID

from app.models.db_models import User
from app.models.schemas import CursorPaginatedMessages
from app.services.chat import ChatService


class GetChatMessagesAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        chat_id: UUID,
        current_user: User,
        cursor: str | None,
        limit: int,
    ) -> CursorPaginatedMessages:
        return await self._chat_service.get_chat_messages(
            chat_id,
            current_user,
            cursor,
            limit,
        )
