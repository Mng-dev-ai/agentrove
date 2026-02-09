import asyncio
import json

from fastapi import HTTPException, status

from app.actions.permissions.common import (
    parse_response_payload,
    validate_token_for_chat,
)
from app.constants import REDIS_KEY_PERMISSION_REQUEST, REDIS_KEY_PERMISSION_RESPONSE
from app.core.config import get_settings
from app.models.schemas import PermissionResult
from app.utils.redis import redis_connection, redis_pubsub

settings = get_settings()


class GetPermissionResponseAction:
    async def execute(
        self,
        chat_id: str,
        request_id: str,
        authorization: str,
        timeout: int,
    ) -> PermissionResult:
        validate_token_for_chat(authorization, chat_id)

        async with redis_connection() as redis:
            request_key = REDIS_KEY_PERMISSION_REQUEST.format(request_id=request_id)

            request_data = await redis.get(request_key)
            if not request_data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Permission request not found or expired",
                )

            try:
                request_json = json.loads(request_data)
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Invalid stored permission data",
                ) from exc

            if request_json.get("chat_id") != chat_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission request does not belong to this chat",
                )

            await redis.setex(
                request_key,
                settings.PERMISSION_REQUEST_TTL_SECONDS,
                json.dumps(request_json),
            )

            channel = REDIS_KEY_PERMISSION_RESPONSE.format(request_id=request_id)

            try:
                async with redis_pubsub(redis, channel) as pubsub:
                    try:
                        async with asyncio.timeout(timeout):
                            async for message in pubsub.listen():
                                if message.get("type") != "message":
                                    continue

                                try:
                                    result = parse_response_payload(message["data"])
                                except HTTPException:
                                    await redis.delete(request_key)
                                    raise

                                await redis.delete(request_key)
                                return result

                    except asyncio.TimeoutError as exc:
                        await redis.delete(request_key)
                        raise HTTPException(
                            status_code=status.HTTP_408_REQUEST_TIMEOUT,
                            detail="Permission request timed out",
                        ) from exc
            except HTTPException:
                raise
            except Exception as exc:
                await redis.delete(request_key)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to get permission response",
                ) from exc

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected state: permission response not received",
        )
