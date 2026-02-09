from typing import Any

from fastapi import HTTPException

from app.models.schemas.integrations import DeviceCodeResponse
from app.services import copilot_oauth


class StartDeviceFlowAction:
    async def execute(self) -> DeviceCodeResponse:
        try:
            data: dict[str, Any] = await copilot_oauth.start_device_authorization()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail="Failed to initiate GitHub device authorization",
            ) from exc

        return DeviceCodeResponse(
            verification_uri=data["verification_uri"],
            user_code=data["user_code"],
            device_code=data["device_code"],
            interval=data.get("interval", 5),
            expires_in=data.get("expires_in", 900),
        )
