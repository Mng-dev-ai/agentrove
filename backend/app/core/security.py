import asyncio
import base64
import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import cast
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Query, WebSocket, status
from fastapi_users.password import PasswordHelper
from jose import jwt
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import WS_CLOSE_SANDBOX_NOT_FOUND, WS_MSG_AUTH
from ..db.session import SessionLocal, get_db
from ..models.db_models.user import User
from ..models.db_models.workspace import Workspace
from ..services.sandbox_providers import SandboxProviderType
from .config import get_settings
from .user_manager import optional_current_active_user

settings = get_settings()
password_helper = PasswordHelper()
logger = logging.getLogger(__name__)


def _get_fernet_key() -> bytes:
    # Fernet key derived from SECRET_KEY so users need not set a separate one.
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(key_bytes)


_fernet = Fernet(_get_fernet_key())


def encrypt_value(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt_value(encrypted_value: str) -> str:
    return _fernet.decrypt(encrypted_value.encode()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        verified, _ = password_helper.verify_and_update(plain_password, hashed_password)
        return bool(verified)
    except Exception as e:
        logger.warning("Password verification failed: %s", e)
        return False


def get_password_hash(password: str) -> str:
    return str(password_helper.hash(password))


async def get_user_from_token(token: str, db: AsyncSession) -> User | None:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"verify_aud": False},
        )
        user_id_str = payload.get("sub")
        if not user_id_str:
            logger.warning("No sub in token payload")
            return None

        user_id = UUID(user_id_str)
        result = await db.execute(select(User).filter(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            logger.info("Successfully validated token for user %s", user_id)
        else:
            logger.warning("User %s not found in database", user_id)
        return cast(User | None, user)
    except Exception as e:
        logger.error("Error validating token: %s", e)
        return None


async def get_current_user(
    # Bearer (via fastapi-users) or ?token= for SSE/WebSocket (no custom headers).
    token_query: str | None = Query(None, alias="token"),
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if token_query:
        query_user = await get_user_from_token(token_query, db)
        if query_user is None:
            raise credentials_exception
        return query_user

    if user is None:
        raise credentials_exception

    return user


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )


async def authenticate_websocket_user(token: str) -> User | None:
    try:
        async with SessionLocal() as db:
            return await get_user_from_token(token, db)
    except (ValueError, OSError, SQLAlchemyError) as e:
        logger.warning("WebSocket authentication failed: %s", e)
        return None


async def wait_for_websocket_auth(
    websocket: WebSocket, timeout: float = 10.0
) -> User | None:
    # First frame must be JSON auth — WS can't send headers after the handshake.
    try:
        message = await asyncio.wait_for(websocket.receive(), timeout=timeout)
        data = json.loads(message["text"])
    except (asyncio.TimeoutError, json.JSONDecodeError, KeyError):
        return None

    if not isinstance(data, dict) or data.get("type") != WS_MSG_AUTH:
        return None

    token = data.get("token")
    if not isinstance(token, str) or not token:
        return None

    return await authenticate_websocket_user(token)


async def resolve_websocket_sandbox_access(
    websocket: WebSocket,
    sandbox_id: str,
    user: User,
) -> tuple[SandboxProviderType, str] | None:
    # Not a Depends: WS needs accept→auth→access ordering. On failure close
    # with SANDBOX_NOT_FOUND and return None.
    async with SessionLocal() as db:
        query = select(Workspace.sandbox_provider, Workspace.workspace_path).where(
            Workspace.sandbox_id == sandbox_id,
            Workspace.user_id == user.id,
            Workspace.deleted_at.is_(None),
        )
        result = await db.execute(query)
        row = result.one_or_none()

    if not row:
        await websocket.close(
            code=WS_CLOSE_SANDBOX_NOT_FOUND, reason="Sandbox not found"
        )
        return None

    return SandboxProviderType(row.sandbox_provider), row.workspace_path
