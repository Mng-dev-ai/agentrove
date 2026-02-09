import logging

from app.models.db_models import User
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ClaudeAgentException, ErrorCode

logger = logging.getLogger(__name__)


class EnhancePromptAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, prompt: str, model_id: str, current_user: User) -> str:
        try:
            return await self._chat_service.ai_service.enhance_prompt(
                prompt,
                model_id,
                current_user,
            )
        except ClaudeAgentException:
            raise
        except Exception as exc:
            logger.error("Unexpected error enhancing prompt: %s", exc)
            raise ChatException(
                "Failed to enhance prompt",
                error_code=ErrorCode.AI_SERVICE_ERROR,
                status_code=500,
            ) from exc
