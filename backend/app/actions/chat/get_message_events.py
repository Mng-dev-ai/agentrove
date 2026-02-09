from uuid import UUID

from app.models.db_models import User
from app.models.schemas import MessageEvent
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode


class GetMessageEventsAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        message_id: UUID,
        after_seq: int,
        current_user: User,
    ) -> list[MessageEvent]:
        message = await self._chat_service.message_service.get_message(message_id)
        if not message:
            raise ChatException(
                "Message not found",
                error_code=ErrorCode.MESSAGE_NOT_FOUND,
                status_code=404,
            )

        await self._chat_service.get_chat(message.chat_id, current_user)
        return await self._chat_service.message_service.get_message_events_after_seq(
            message_id,
            after_seq,
            limit=5000,
        )
