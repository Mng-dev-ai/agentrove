from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.models.db_models import Chat, User
from app.services.chat import ChatService
from app.services.exceptions import (
    ChatException,
    ErrorCode,
    MessageException,
    SandboxException,
)


class ForkChatAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        chat_id: UUID,
        message_id: UUID,
        current_user: User,
    ) -> tuple[Chat, int]:
        try:
            return await self._chat_service.fork_chat(chat_id, message_id, current_user)
        except ChatException:
            raise
        except (MessageException, SandboxException) as exc:
            raise ChatException(
                str(exc),
                error_code=exc.error_code,
                details=exc.details,
                status_code=exc.status_code,
            ) from exc
        except SQLAlchemyError as exc:
            raise ChatException(
                "Database error while forking chat",
                error_code=ErrorCode.UNKNOWN_ERROR,
                status_code=500,
            ) from exc
        except FileNotFoundError as exc:
            raise ChatException(
                "Checkpoint not found",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=404,
            ) from exc
