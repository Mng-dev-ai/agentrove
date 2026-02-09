from typing import Any

from fastapi import HTTPException

from app.models.schemas.integrations import OpenAIPollTokenRequest, PollTokenResponse
from app.services import openai_oauth


class PollOpenAITokenAction:
    async def execute(self, request: OpenAIPollTokenRequest) -> PollTokenResponse:
        try:
            data: dict[str, Any] = await openai_oauth.poll_device_token(
                request.device_code, request.user_code
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="OpenAI token request failed") from exc

        status_code = data.get("status_code", 0)
        if status_code in (403, 404):
            return PollTokenResponse(status="pending")

        if status_code == 200:
            auth_code = data.get("authorization_code")
            code_verifier = data.get("code_verifier")
            if not auth_code or not code_verifier:
                raise HTTPException(
                    status_code=502,
                    detail="Incomplete authorization response from OpenAI",
                )
            try:
                tokens = await openai_oauth.exchange_authorization_code(auth_code, code_verifier)
            except Exception as exc:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to exchange OpenAI authorization code",
                ) from exc
            return PollTokenResponse(
                status="success",
                access_token=tokens["access_token"],
                refresh_token=tokens.get("refresh_token"),
            )

        raise HTTPException(
            status_code=400,
            detail=f"OpenAI authorization failed (status {status_code})",
        )
