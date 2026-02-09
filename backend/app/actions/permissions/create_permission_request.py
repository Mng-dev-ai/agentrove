import asyncio
import json
import uuid
from uuid import UUID

from fastapi import HTTPException, status

from app.actions.permissions.common import validate_token_for_chat
from app.constants import (
    REDIS_KEY_CHAT_STREAM_LIVE,
    REDIS_KEY_PERMISSION_REQUEST,
)
from app.core.config import get_settings
from app.models.schemas import PermissionRequest, PermissionRequestResponse
from app.services.chat import ChatService
from app.services.streaming.protocol import build_envelope, redact_for_audit
from app.utils.redis import redis_connection

settings = get_settings()


class CreatePermissionRequestAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(
        self,
        chat_id: str,
        request: PermissionRequest,
        authorization: str,
    ) -> PermissionRequestResponse:
        validate_token_for_chat(authorization, chat_id)

        async with redis_connection() as redis:
            request_id = str(uuid.uuid4())
            request_key = REDIS_KEY_PERMISSION_REQUEST.format(request_id=request_id)
            payload = json.dumps(
                {
                    "chat_id": chat_id,
                    "tool_name": request.tool_name,
                    "tool_input": request.tool_input,
                    "timestamp": asyncio.get_running_loop().time(),
                }
            )

            try:
                await redis.setex(
                    request_key,
                    settings.PERMISSION_REQUEST_TTL_SECONDS,
                    payload,
                )

                message_service = self._chat_service.message_service
                latest_assistant = await message_service.get_latest_assistant_message(
                    UUID(chat_id)
                )
                if latest_assistant and latest_assistant.active_stream_id:
                    render_payload = {
                        "request_id": request_id,
                        "tool_name": request.tool_name,
                        "tool_input": request.tool_input,
                    }
                    seq = await message_service.append_event_with_next_seq(
                        chat_id=UUID(chat_id),
                        message_id=latest_assistant.id,
                        stream_id=latest_assistant.active_stream_id,
                        event_type="permission_request",
                        render_payload=render_payload,
                        audit_payload={"payload": redact_for_audit(render_payload)},
                    )
                    envelope = build_envelope(
                        chat_id=UUID(chat_id),
                        message_id=latest_assistant.id,
                        stream_id=latest_assistant.active_stream_id,
                        seq=seq,
                        kind="permission_request",
                        payload=render_payload,
                    )
                    await redis.publish(
                        REDIS_KEY_CHAT_STREAM_LIVE.format(chat_id=chat_id),
                        json.dumps(envelope, ensure_ascii=False),
                    )

            except Exception as exc:
                await redis.delete(request_key)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create permission request",
                ) from exc

        return PermissionRequestResponse(request_id=request_id)
