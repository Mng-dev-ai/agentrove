import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, TypeVar, cast

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.jwt import decode_jwt, generate_jwt
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal, get_db
from app.models.db_models.paired_device import PairedDevice
from app.models.db_models.user import User, UserSettings
from app.models.schemas.auth import UserCreate
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
        from app.services.refresh_token import RefreshTokenService

        revoked = await RefreshTokenService().revoke_all_tokens(
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


async def is_device_active(
    db: AsyncSession, device_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    device = await db.scalar(
        select(PairedDevice.id).where(
            PairedDevice.id == device_id,
            PairedDevice.user_id == user_id,
            PairedDevice.revoked_at.is_(None),
        )
    )
    return device is not None


DEVICE_RECHECK_SECONDS = 5.0
StreamItem = TypeVar("StreamItem")


class DeviceSession:
    def __init__(self, user_id: uuid.UUID, device_id: uuid.UUID | None) -> None:
        self.user_id = user_id
        self.device_id = device_id
        self.checked_at = time.monotonic()

    async def is_active(self) -> bool:
        if self.device_id is None:
            return True
        if time.monotonic() - self.checked_at < DEVICE_RECHECK_SECONDS:
            return True
        async with SessionLocal() as db:
            active = await is_device_active(db, self.device_id, self.user_id)
        self.checked_at = time.monotonic()
        return active

    async def guard(
        self, stream: AsyncIterator[StreamItem]
    ) -> AsyncIterator[StreamItem]:
        async for item in stream:
            if not await self.is_active():
                return
            yield item


class AccessTokenStrategy(JWTStrategy[User, uuid.UUID]):
    def __init__(self, db: AsyncSession) -> None:
        super().__init__(
            secret=settings.SECRET_KEY,
            lifetime_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            algorithm=settings.ALGORITHM,
        )
        self.db = db

    def read_claims(self, token: str) -> dict[str, Any]:
        claims: dict[str, Any] = decode_jwt(
            token, self.decode_key, self.token_audience, algorithms=[self.algorithm]
        )
        return claims

    def read_device_id(self, token: str) -> uuid.UUID | None:
        device_id = self.read_claims(token).get("did")
        return None if device_id is None else uuid.UUID(device_id)

    async def read_token(
        self, token: str | None, user_manager: BaseUserManager[User, uuid.UUID]
    ) -> User | None:
        user: User | None = await super().read_token(token, user_manager)
        if user is None or token is None:
            return None
        try:
            device_id = self.read_device_id(token)
        except jwt.PyJWTError:
            return None
        if device_id is None:
            return user
        return user if await is_device_active(self.db, device_id, user.id) else None

    async def write_token(self, user: User, device_id: uuid.UUID | None = None) -> str:
        data = {"sub": str(user.id), "aud": self.token_audience}
        if device_id is not None:
            data["did"] = str(device_id)
        return str(
            generate_jwt(
                data, self.encode_key, self.lifetime_seconds, algorithm=self.algorithm
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

current_active_user = fastapi_users.current_user(active=True)
optional_current_active_user = fastapi_users.current_user(active=True, optional=True)


async def get_current_device_id(
    _: User = Depends(current_active_user),
    token: str | None = Depends(bearer_transport.scheme),
    strategy: AccessTokenStrategy = Depends(get_jwt_strategy),
) -> uuid.UUID | None:
    if token is None:
        return None
    try:
        return strategy.read_device_id(token)
    except jwt.PyJWTError:
        return None


async def reject_agent_token(
    _: User = Depends(current_active_user),
    token: str | None = Depends(bearer_transport.scheme),
    strategy: AccessTokenStrategy = Depends(get_jwt_strategy),
) -> None:
    if token is not None and strategy.read_claims(token).get("mcp") is True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent tokens cannot manage pairing or devices",
        )
