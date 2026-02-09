import logging
from datetime import datetime, timedelta, timezone
from typing import Any, cast
from urllib.parse import urlencode, urlparse
from uuid import UUID

import httpx
from jose import jwt

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
]


def get_redirect_uri() -> str:
    return f"{settings.BASE_URL}{settings.API_V1_STR}/integrations/gmail/callback"


def validate_client_config(config: dict[str, Any]) -> tuple[bool, str | None]:
    if "installed" in config:
        client_data = config["installed"]
        is_web = False
    elif "web" in config:
        client_data = config["web"]
        is_web = True
    else:
        return False, "Missing 'installed' or 'web' key in OAuth config"

    if not client_data.get("client_id"):
        return False, "Missing client_id"
    if not client_data.get("client_secret"):
        return False, "Missing client_secret"

    redirect_uris = client_data.get("redirect_uris", [])
    expected_uri = get_redirect_uri().rstrip("/")
    normalized_uris = [uri.rstrip("/") for uri in redirect_uris]

    if not is_web:
        redirect_host = urlparse(expected_uri).hostname or ""
        if redirect_host not in {"localhost", "127.0.0.1", "::1"}:
            return (
                False,
                "Installed OAuth clients only work with localhost redirects. "
                "Create a Web application client instead.",
            )
        if not redirect_uris:
            return False, "Installed client must include redirect_uris"
        has_loopback_redirect = any(
            (urlparse(uri).hostname or "") in {"localhost", "127.0.0.1", "::1"}
            for uri in normalized_uris
        )
        if not has_loopback_redirect:
            return (
                False,
                "Installed client must include a localhost redirect URI "
                "(e.g., http://localhost).",
            )
    else:
        if expected_uri not in normalized_uris:
            return False, f"Web client must include '{expected_uri}' in redirect_uris"

    return True, None


def extract_client_credentials(config: dict[str, Any]) -> tuple[str, str]:
    if "installed" in config:
        client_data = config["installed"]
    else:
        client_data = config["web"]

    return client_data["client_id"], client_data["client_secret"]


def create_oauth_state(user_id: UUID) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    payload = {
        "user_id": str(user_id),
        "purpose": "gmail_oauth",
        "exp": expires,
    }
    return cast(
        str, jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    )


def verify_oauth_state(state: str) -> UUID | None:
    try:
        payload = jwt.decode(
            state, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        if payload.get("purpose") != "gmail_oauth":
            return None
        user_id_str = payload.get("user_id")
        if not user_id_str:
            return None
        return UUID(user_id_str)
    except Exception as e:
        logger.warning("OAuth state verification failed: %s", e)
        return None


def build_authorization_url(client_id: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": get_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_tokens(
    code: str,
    client_id: str,
    client_secret: str,
) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": get_redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
        response.raise_for_status()
        return cast(dict[str, Any], response.json())


async def revoke_token(token: str) -> bool:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GOOGLE_REVOKE_URL,
            params={"token": token},
        )
        return bool(response.status_code == 200)


async def get_user_email(access_token: str) -> str | None:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if response.status_code == 200:
            data = response.json()
            return cast(str | None, data.get("email"))
        return None
