import hashlib
import hmac
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Literal, cast

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, exceptions
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.jwt import decode_jwt, generate_jwt
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.db_models.user import AgentScope, User, UserSettings
from app.models.schemas.auth import UserCreate
from app.services.pairing import PairingService
from app.services.email import email_service

settings = get_settings()
logger = logging.getLogger(__name__)


# Named subclass required: exported as a stable public type and imported by auth.py for Depends injection.
class UserDatabase(SQLAlchemyUserDatabase[User, uuid.UUID]):
    pass


async def get_user_db(
    session: AsyncSession = Depends(get_db),
) -> AsyncIterator[UserDatabase]:
    yield UserDatabase(session, User)


class RegistrationClosed(Exception):
    pass


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.SECRET_KEY
    verification_token_secret = settings.SECRET_KEY
    user_db: UserDatabase

    async def register(self, user_create: UserCreate) -> User:
        if not settings.REGISTRATION_OPEN:
            session = self.user_db.session
            await session.execute(text("BEGIN IMMEDIATE"))
            if await session.scalar(select(User.id).limit(1)) is not None:
                raise RegistrationClosed
        return cast(User, await self.create(user_create, safe=True))

    async def on_after_register(
        self, user: User, request: Request | None = None
    ) -> None:
        logger.info("User %s has registered", user.id)

        try:
            session = self.user_db.session
            existing_settings = await session.execute(
                select(UserSettings).filter(UserSettings.user_id == user.id)
            )
            if not existing_settings.scalar_one_or_none():
                user_settings = UserSettings(
                    user_id=user.id,
                    github_personal_access_token=None,
                )
                session.add(user_settings)
                await session.commit()
                logger.info("Created user settings for user %s", user.id)
        except SQLAlchemyError as e:
            logger.error("Failed to create user settings for %s: %s", user.id, e)

        if settings.REQUIRE_EMAIL_VERIFICATION and not user.is_verified:
            try:
                await self.request_verify(user, request)
                logger.info("Verification email sent to %s", user.email)
            except Exception as e:
                logger.error(
                    "Failed to send verification email to %s: %s", user.email, e
                )

    async def on_after_reset_password(
        self, user: User, request: Request | None = None
    ) -> None:
        # Reset implies compromise — kill refresh tokens from the old password.
        # Inline import avoids circular import with core.security.
        from app.services.device_revocation import DeviceRevocationService

        revoked = await DeviceRevocationService.revoke_all(
            user.id, self.user_db.session
        )
        logger.info(
            "Revoked %s refresh tokens for user %s after password reset",
            revoked,
            user.id,
        )

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        logger.info("User %s requested password reset", user.id)
        try:
            await email_service.send_password_reset_email(
                email=user.email, reset_token=token, user_name=user.username
            )
            logger.info("Password reset email sent to %s", user.email)
        except Exception as e:
            logger.error("Failed to send password reset email to %s: %s", user.email, e)

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        logger.info("Verification requested for user %s", user.id)
        try:
            await email_service.send_verification_email(
                email=user.email, verification_token=token, user_name=user.username
            )
            logger.info("Verification email sent to %s", user.email)
        except Exception as e:
            logger.error("Failed to send verification email to %s: %s", user.email, e)


async def get_user_manager(
    user_db: UserDatabase = Depends(get_user_db),
) -> AsyncIterator[UserManager]:
    yield UserManager(user_db)


bearer_transport = BearerTransport(tokenUrl="api/v1/auth/login")


DEVICE_IDS = TypeAdapter(frozenset[uuid.UUID])


def password_fingerprint(hashed_password: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode(), hashed_password.encode(), hashlib.sha256
    ).hexdigest()[:16]


class AccessTokenStrategy(JWTStrategy[User, uuid.UUID]):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(
            secret=settings.SECRET_KEY,
            lifetime_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            algorithm=settings.ALGORITHM,
        )
        self.db = db

    async def read_token(
        self, token: str | None, user_manager: BaseUserManager[User, uuid.UUID]
    ) -> User | None:
        if token is None:
            return None
        try:
            claims = decode_jwt(
                token, self.decode_key, self.token_audience, algorithms=[self.algorithm]
            )
            device_ids = DEVICE_IDS.validate_python(claims.get("did", []))
            agent_scope = (
                AgentScope(
                    workspace_id=uuid.UUID(claims["wid"]),
                    chat_id=(
                        uuid.UUID(claims["cid"])
                        if claims.get("cid") is not None
                        else None
                    ),
                )
                if "wid" in claims
                else None
            )
            user: User = await user_manager.get(user_manager.parse_id(claims["sub"]))
        except (
            jwt.PyJWTError,
            ValidationError,
            TypeError,
            ValueError,
            exceptions.InvalidID,
            exceptions.UserNotExists,
        ):
            return None
        agent_token = claims.get("mcp") is True
        # An agent token is bound to a Docker workspace or marked as minted for
        # a host session; `mcp` alone was once also what sandboxes were given.
        if agent_token != (agent_scope is not None or claims.get("host") is True):
            return None
        if claims.get("pwd") != password_fingerprint(user.hashed_password):
            return None
        if not await PairingService.all_active(self.db, user.id, device_ids):
            return None
        user.device_ids = device_ids
        user.agent_token = agent_token
        user.agent_scope = agent_scope
        return user

    async def write_session_token(
        self, user: User, device_ids: frozenset[uuid.UUID]
    ) -> str:
        return str(
            generate_jwt(
                {
                    "sub": str(user.id),
                    "aud": self.token_audience,
                    "did": DEVICE_IDS.dump_python(device_ids, mode="json"),
                    "pwd": password_fingerprint(user.hashed_password),
                },
                self.encode_key,
                self.lifetime_seconds,
                algorithm=self.algorithm,
            )
        )


def get_jwt_strategy(db: AsyncSession = Depends(get_db)) -> AccessTokenStrategy:
    return AccessTokenStrategy(db)


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager,
    [auth_backend],
)

_token_user = fastapi_users.current_user(active=True)
_optional_token_user = fastapi_users.current_user(active=True, optional=True)

# Every route an agent token (`mcp: true`) may call, relative to API_V1_STR: the
# requests mcp-server/client.py makes. "host" tokens belong to stdio MCP servers
# of host workspaces, "scoped" ones to a Docker sandbox's MCP requests.
AGENT_ROUTES: dict[tuple[str, str], Literal["any", "host", "scoped"]] = {
    ("GET", "/workspaces"): "any",
    ("GET", "/models/"): "any",
    ("GET", "/chat/chats"): "any",
    ("GET", "/chat/chats/search"): "any",
    ("GET", "/chat/chats/{chat_id}"): "any",
    ("GET", "/chat/chats/{chat_id}/messages"): "any",
    ("GET", "/chat/chats/{chat_id}/context-usage"): "any",
    ("POST", "/chat/chats"): "any",
    ("POST", "/chat/chat"): "any",
    ("POST", "/chat/chats/{chat_id}/queue"): "any",
    ("DELETE", "/chat/chats/{chat_id}/stream"): "any",
    ("POST", "/chat/chats/{chat_id}/attachments"): "host",
    ("POST", "/chat/chats/{chat_id}/attachments/sandbox"): "scoped",
    ("GET", "/settings/"): "any",
    ("PATCH", "/settings/"): "host",
    ("GET", "/channels"): "any",
    ("POST", "/channels"): "any",
    ("GET", "/channels/{channel_id}"): "any",
    ("GET", "/channels/{channel_id}/messages"): "any",
    ("POST", "/channels/{channel_id}/messages"): "any",
    ("POST", "/channels/{channel_id}/stop"): "any",
    ("GET", "/automations"): "any",
    ("POST", "/automations"): "any",
    ("PATCH", "/automations/{automation_id}"): "any",
    ("DELETE", "/automations/{automation_id}"): "any",
    ("POST", "/automations/{automation_id}/run"): "any",
    ("POST", "/inbox/messages"): "any",
    ("GET", "/memories"): "any",
    ("POST", "/memories"): "any",
    ("PATCH", "/memories/{memory_id}"): "any",
    ("DELETE", "/memories/{memory_id}"): "any",
}


def _enforce_agent_routes(request: Request, user: User | None) -> None:
    if user is None or not user.agent_token:
        return
    path = request.scope["route"].path.removeprefix(settings.API_V1_STR)
    allowed = AGENT_ROUTES.get((request.method, path))
    kind = "scoped" if user.agent_scope is not None else "host"
    if allowed not in ("any", kind):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent tokens cannot access this route",
        )


async def current_active_user(
    request: Request, user: User = Depends(_token_user)
) -> User:
    _enforce_agent_routes(request, user)
    return user


async def optional_current_active_user(
    request: Request, user: User | None = Depends(_optional_token_user)
) -> User | None:
    _enforce_agent_routes(request, user)
    return user
