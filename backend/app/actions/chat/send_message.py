import asyncio
import logging

from app.models.db_models import MessageRole, ToolStatus, User
from app.models.schemas import ChatRequest
from app.models.types import ChatCompletionResult, MessageAttachmentDict
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.chat import ChatService
from app.services.exceptions import ChatException, ErrorCode
from app.utils.message_events import extract_user_prompt

logger = logging.getLogger(__name__)


class SendMessageAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        request: ChatRequest,
        current_user: User,
    ) -> ChatCompletionResult:
        if not request.chat_id:
            raise ChatException(
                "chat_id is required for chat completion",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        await self._chat_service.check_message_limit(current_user.id)

        user_settings = await self._chat_service.user_service.get_user_settings(
            current_user.id
        )
        self._chat_service.validate_api_keys(user_settings, request.model_id)

        chat = await self._chat_service.get_chat(request.chat_id, current_user)

        chat_id = chat.id

        attachments: list[MessageAttachmentDict] | None = None
        if request.attached_files:
            attachments = list(
                await asyncio.gather(
                    *[
                        self._chat_service.storage_service.save_file(
                            file,
                            sandbox_id=chat.sandbox_id,
                            user_id=str(current_user.id),
                        )
                        for file in request.attached_files
                    ]
                )
            )

        try:
            user_prompt = extract_user_prompt(request.prompt)
            ai_prompt = user_prompt
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            logger.error("Failed to parse message events: %s", exc)
            user_prompt = request.prompt or ""
            ai_prompt = user_prompt

        await self._chat_service.message_service.create_message(
            chat_id,
            user_prompt,
            MessageRole.USER,
            attachments=attachments,
        )

        # When switching from OpenRouter to Claude, we need to clean thinking blocks
        # from the session to avoid invalid signatures.
        session_id = chat.session_id
        if session_id and chat.sandbox_id:
            if await self._chat_service.needs_session_cleaning(
                chat.id, request.model_id, current_user.id
            ):
                await self._chat_service.sandbox_service.clean_session_thinking_blocks(
                    chat.sandbox_id, session_id
                )

        assistant_message = await self._chat_service.create_assistant_message(
            chat, request.model_id
        )

        system_prompt = build_system_prompt_for_chat(
            chat.sandbox_id or "",
            user_settings,
            selected_prompt_name=request.selected_prompt_name,
        )
        is_custom_prompt = bool(request.selected_prompt_name)
        custom_instructions = (
            user_settings.custom_instructions if user_settings else None
        )

        try:
            task = await self._chat_service.enqueue_chat_task(
                prompt=ai_prompt,
                system_prompt=system_prompt,
                custom_instructions=custom_instructions,
                user=current_user,
                chat=chat,
                permission_mode=request.permission_mode,
                model_id=request.model_id,
                session_id=session_id,
                assistant_message_id=str(assistant_message.id),
                thinking_mode=request.thinking_mode,
                attachments=attachments,
                is_custom_prompt=is_custom_prompt,
            )

            await self._chat_service.store_active_task(chat_id, task.id)
        except Exception:
            await self._chat_service.message_service.soft_delete_message(
                assistant_message.id
            )
            raise

        return {
            "task_id": task.id,
            "message_id": str(assistant_message.id),
            "chat_id": str(chat_id),
            "last_seq": int(chat.last_event_seq or 0),
            "status": ToolStatus.STARTED.value,
        }
