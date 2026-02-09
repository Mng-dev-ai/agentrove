import asyncio
from typing import Literal, cast
from uuid import UUID

from fastapi import UploadFile
from redis.exceptions import RedisError

from app.models.db_models import User
from app.models.schemas import QueueUpsertResponse
from app.models.types import MessageAttachmentDict
from app.services.chat import ChatService
from app.services.exceptions import ChatException
from app.services.queue import QueueService
from app.utils.redis import redis_connection


class QueueMessageAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        *,
        chat_id: UUID,
        content: str,
        model_id: str,
        permission_mode: Literal["plan", "ask", "auto"] = "auto",
        thinking_mode: str | None = None,
        attached_files: list[UploadFile] | None = None,
        current_user: User,
    ) -> QueueUpsertResponse:
        try:
            chat = await self._chat_service.get_chat(chat_id, current_user)
        except ChatException:
            raise ChatException(
                "Chat not found or access denied",
                status_code=404,
            )

        attachments: list[MessageAttachmentDict] | None = None
        if attached_files:
            attachments = list(
                await asyncio.gather(
                    *[
                        self._chat_service.storage_service.save_file(
                            file,
                            sandbox_id=chat.sandbox_id,
                            user_id=str(current_user.id),
                        )
                        for file in attached_files
                    ]
                )
            )

        try:
            async with redis_connection() as redis:
                queue_service = QueueService(redis)
                return cast(
                    QueueUpsertResponse,
                    await queue_service.upsert_message(
                        str(chat_id),
                        content,
                        model_id,
                        permission_mode=permission_mode,
                        thinking_mode=thinking_mode,
                        attachments=attachments,
                    ),
                )
        except RedisError as exc:
            raise ChatException(
                "Service temporarily unavailable",
                status_code=503,
                details={"error": str(exc)},
            ) from exc
