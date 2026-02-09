from typing import Any

from fastapi import HTTPException

from app.models.schemas.integrations import PollTokenRequest, PollTokenResponse
from app.services import copilot_oauth


class PollTokenAction:
    async def execute(self, request: PollTokenRequest) -> PollTokenResponse:
        try:
            data: dict[str, Any] = await copilot_oauth.poll_access_token(request.device_code)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="GitHub token request failed") from exc

        if data.get("access_token"):
            return PollTokenResponse(status="success", access_token=data["access_token"])

        error = data.get("error", "unknown")
        if error == "authorization_pending":
            return PollTokenResponse(status="pending")
        if error == "slow_down":
            interval = data.get("interval")
            if isinstance(interval, int) and interval > 0:
                return PollTokenResponse(status="slow_down", interval=interval)
            return PollTokenResponse(status="slow_down")

        raise HTTPException(status_code=400, detail=f"Authorization failed: {error}")
