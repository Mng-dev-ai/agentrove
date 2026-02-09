import logging
from datetime import datetime, timedelta, timezone

from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.services import gmail_oauth
from app.services.exceptions import UserException
from app.services.user import UserService

logger = logging.getLogger(__name__)


class OAuthCallbackAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(self, code: str, state: str, db: AsyncSession) -> HTMLResponse:
        user_id = gmail_oauth.verify_oauth_state(state)
        if not user_id:
            return HTMLResponse(
                content=self._callback_html(
                    "Authentication failed: Invalid state token"
                ),
                status_code=400,
            )

        try:
            user_settings = await self._user_service.get_user_settings(
                user_id, db=db, for_update=True
            )
        except UserException:
            return HTMLResponse(
                content=self._callback_html("Authentication failed: User not found"),
                status_code=404,
            )

        if not user_settings.gmail_oauth_client:
            return HTMLResponse(
                content=self._callback_html(
                    "Authentication failed: OAuth client not configured"
                ),
                status_code=400,
            )

        client_id, client_secret = gmail_oauth.extract_client_credentials(
            user_settings.gmail_oauth_client
        )

        try:
            tokens = await gmail_oauth.exchange_code_for_tokens(
                code, client_id, client_secret
            )
        except Exception as exc:
            logger.error("Token exchange failed: %s", exc)
            return HTMLResponse(
                content=self._callback_html(
                    "Authentication failed: Could not exchange code for tokens"
                ),
                status_code=500,
            )

        email = await gmail_oauth.get_user_email(tokens.get("access_token", ""))

        if "expires_in" in tokens:
            expiry = datetime.now(timezone.utc) + timedelta(
                seconds=tokens["expires_in"]
            )
            tokens["expiry"] = expiry.isoformat()

        user_settings.gmail_oauth_tokens = tokens
        user_settings.gmail_connected_at = datetime.now(timezone.utc)
        user_settings.gmail_email = email
        flag_modified(user_settings, "gmail_oauth_tokens")

        await self._user_service.commit_settings_and_invalidate_cache(
            user_settings, db, user_id
        )

        return HTMLResponse(content=self._callback_html(None, email))

    @staticmethod
    def _callback_html(error: str | None, email: str | None = None) -> str:
        if error:
            return f"""
<!DOCTYPE html>
<html>
<head><title>Gmail Connection Failed</title></head>
<body style=\"font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;\">
    <div style=\"text-align: center;\">
        <h2 style=\"color: #ef4444;\">Connection Failed</h2>
        <p>{error}</p>
        <p style=\"color: #888;\">You can close this window.</p>
    </div>
</body>
</html>
"""
        return f"""
<!DOCTYPE html>
<html>
<head><title>Gmail Connected</title></head>
<body style=\"font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;\">
    <div style=\"text-align: center;\">
        <h2 style=\"color: #22c55e;\">Gmail Connected Successfully</h2>
        <p>Connected account: {email or "Unknown"}</p>
        <p style=\"color: #888;\">You can close this window and return to Claudex.</p>
    </div>
</body>
</html>
"""
