from app.models.db_models import User
from app.models.schemas import PaginatedChats, PaginationParams
from app.services.chat import ChatService


class GetChatsAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        current_user: User,
        pagination: PaginationParams,
    ) -> PaginatedChats:
        return await self._chat_service.get_user_chats(current_user, pagination)
