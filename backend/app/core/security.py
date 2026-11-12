import asyncio
import base64
import hashlib
import json
import logging
from typing import Any
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, WebSocket, status
from fastapi_users.jwt import generate_jwt
from fastapi_users.password import PasswordHelper
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import WS_CLOSE_SANDBOX_NOT_FOUND, WS_MSG_AUTH
from ..db.session import SessionLocal
from ..models.db_models.user import User
from ..models.db_models.workspace import Workspace
from ..services.sandbox_providers import SandboxProviderType
from .config import get_settings
from .user_manager import (
    DEVICE_IDS,
    UserDatabase,
    UserManager,
    get_jwt_strategy,
    optional_current_active_user,
    password_fingerprint,
)

settings = get_settings()
password_helper = PasswordHelper()
logger = logging.getLogger(__name__)

SANDBOX_MCP_AUDIENCE = "agentrove:sandbox-mcp"
SCOPED_MCP_TOKEN_LIFETIME_SECONDS = 120


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
    user = await get_jwt_strategy(db).read_token(
        token, UserManager(UserDatabase(db, User))
    )
    if user is None or not user.is_active:
        return None
    return user


async def get_current_user(
    user: User | None = Depends(optional_current_active_user),
) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def create_mcp_access_token(
    user_id: str, hashed_password: str, device_ids: frozenset[UUID]
) -> str:
    # Minted for the stdio MCP server of a host-workspace session — audience must
    # match the JWTStrategy in user_manager.py (fastapi-users default) so the
    # normal bearer path accepts it. `mcp` limits it to AGENT_ROUTES.
    return str(
        generate_jwt(
            {
                "sub": str(user_id),
                "aud": ["fastapi-users:auth"],
                "mcp": True,
                "did": DEVICE_IDS.dump_python(device_ids, mode="json"),
                "pwd": password_fingerprint(hashed_password),
            },
            settings.SECRET_KEY,
            lifetime_seconds=settings.AGENTROVE_MCP_TOKEN_LIFETIME_SECONDS,
            algorithm=settings.ALGORITHM,
        )
    )


def create_sandbox_mcp_token(
    user_id: str,
    hashed_password: str,
    device_ids: frozenset[UUID],
    *,
    workspace_id: str | None,
    chat_id: str | None,
    session_id: str,
) -> str:
    # Everything in a Docker sandbox can read this token, so its audience is one
    # only McpAuthMiddleware accepts: no REST route or WebSocket takes it.
    return str(
        generate_jwt(
            {
                "sub": str(user_id),
                "aud": [SANDBOX_MCP_AUDIENCE],
                "wid": workspace_id,
                "cid": chat_id,
                "sid": session_id,
                "did": DEVICE_IDS.dump_python(device_ids, mode="json"),
                "pwd": password_fingerprint(hashed_password),
            },
            settings.SECRET_KEY,
            lifetime_seconds=settings.AGENTROVE_MCP_TOKEN_LIFETIME_SECONDS,
            algorithm=settings.ALGORITHM,
        )
    )


def create_scoped_mcp_token(sandbox_claims: dict[str, Any]) -> str:
    # Never leaves the API process: McpAuthMiddleware mints it per MCP request
    # for the loopback REST calls that request makes.
    return str(
        generate_jwt(
            {
                "aud": ["fastapi-users:auth"],
                "mcp": True,
                **{k: sandbox_claims[k] for k in ("sub", "wid", "cid", "did", "pwd")},
            },
            settings.SECRET_KEY,
            lifetime_seconds=SCOPED_MCP_TOKEN_LIFETIME_SECONDS,
            algorithm=settings.ALGORITHM,
        )
    )


async def authenticate_websocket_user(token: str) -> User | None:
    try:
        async with SessionLocal() as db:
            user = await get_user_from_token(token, db)
        return None if user is None or user.agent_token else user
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
