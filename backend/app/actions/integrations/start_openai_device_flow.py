from typing import Any

from fastapi import HTTPException

from app.models.schemas.integrations import DeviceCodeResponse
from app.services import openai_oauth


class StartOpenAIDeviceFlowAction:
    async def execute(self) -> DeviceCodeResponse:
        try:
            data: dict[str, Any] = await openai_oauth.start_device_authorization()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail="Failed to initiate OpenAI device authorization",
            ) from exc

        return DeviceCodeResponse(
            verification_uri=openai_oauth.VERIFICATION_URI,
            user_code=data["user_code"],
            device_code=data["device_auth_id"],
            interval=int(data.get("interval", 5)),
            expires_in=data.get("expires_in", 900),
        )
