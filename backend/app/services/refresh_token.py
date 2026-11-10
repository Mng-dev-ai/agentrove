import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.db_models.paired_device import PairedDevice
from app.models.db_models.refresh_token import RefreshToken
from app.models.db_models.user import User
from app.services.db import SessionFactoryType
from app.services.exceptions import AuthException

settings = get_settings()
logger = logging.getLogger(__name__)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RefreshTokenService:
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        self.session_factory = session_factory or SessionLocal

    @staticmethod
    def generate_refresh_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def get_refresh_token_expiry() -> datetime:
        return datetime.now(timezone.utc) + timedelta(
            days=settings.REFRESH_TOKEN_EXPIRE_DAYS
        )

    async def create_refresh_token(
        self,
        user_id: UUID,
        db: AsyncSession,
        device_id: UUID | None,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        token = self.generate_refresh_token()
        token_hash = hash_refresh_token(token)
        expires_at = self.get_refresh_token_expiry()

        refresh_token = RefreshToken(
            token_hash=token_hash,
            user_id=user_id,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device_id,
        )

        db.add(refresh_token)
        await db.commit()

        return token

    async def validate_and_rotate(
        self,
        token: str,
        db: AsyncSession,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> tuple[User, str, UUID | None]:
        now = datetime.now(timezone.utc)
        token_hash = hash_refresh_token(token)
        refresh_token = await db.scalar(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .values(revoked_at=now)
            .returning(RefreshToken)
        )
        if refresh_token is not None:
            parent_id: UUID | None = refresh_token.id
        else:
            # Lost-response replay: consume the presented token's never-used successor.
            # revoked_at < now: only a request that began after the consume is a retry.
            presented = aliased(RefreshToken)
            refresh_token = await db.scalar(
                update(RefreshToken)
                .where(
                    RefreshToken.parent_id
                    == select(presented.id)
                    .where(
                        presented.token_hash == token_hash,
                        presented.revoked_at < now,
                        presented.expires_at > now,
                    )
                    .scalar_subquery(),
                    RefreshToken.revoked_at.is_(None),
                    RefreshToken.expires_at > now,
                )
                .values(revoked_at=now)
                .returning(RefreshToken)
            )
            if refresh_token is None:
                raise AuthException("Invalid or expired refresh token")
            parent_id = refresh_token.parent_id

        user_result = await db.execute(
            select(User).where(User.id == refresh_token.user_id)
        )
        user = user_result.scalar_one_or_none()

        if not user or not user.is_active:
            raise AuthException("Invalid or expired refresh token")

        if refresh_token.device_id is not None:
            device = await db.scalar(
                select(PairedDevice).where(
                    PairedDevice.id == refresh_token.device_id,
                    PairedDevice.user_id == user.id,
                    PairedDevice.revoked_at.is_(None),
                )
            )
            if device is None:
                raise AuthException("Invalid or expired refresh token")
            device.last_used_at = now

        new_token = self.generate_refresh_token()
        new_token_hash = hash_refresh_token(new_token)
        new_expires_at = self.get_refresh_token_expiry()

        new_refresh_token = RefreshToken(
            token_hash=new_token_hash,
            user_id=user.id,
            expires_at=new_expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
            parent_id=parent_id,
            device_id=refresh_token.device_id,
        )

        db.add(new_refresh_token)
        await db.commit()

        return user, new_token, refresh_token.device_id

    @staticmethod
    def _with_children(token_id: UUID) -> ColumnElement[bool]:
        return or_(RefreshToken.id == token_id, RefreshToken.parent_id == token_id)

    async def revoke_token(self, token: str, db: AsyncSession) -> bool:
        token_hash = hash_refresh_token(token)

        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        refresh_token = result.scalar_one_or_none()
        if refresh_token is None:
            return False

        chain = self._with_children(refresh_token.id)
        if refresh_token.parent_id is not None:
            chain = or_(chain, self._with_children(refresh_token.parent_id))
        await db.execute(delete(RefreshToken).where(chain))
        await db.commit()

        return True

    async def revoke_all_tokens(self, user_id: UUID, db: AsyncSession) -> int:
        result = await db.execute(
            delete(RefreshToken).where(RefreshToken.user_id == user_id)
        )
        await db.commit()
        return int(getattr(result, "rowcount", 0))

    async def cleanup_expired_and_revoked_tokens(
        self, revoked_grace_days: int = 7
    ) -> dict[str, int]:
        now = datetime.now(timezone.utc)
        revoked_cutoff = now - timedelta(days=revoked_grace_days)

        delete_stmt = delete(RefreshToken).where(
            or_(
                RefreshToken.expires_at < now,
                RefreshToken.revoked_at < revoked_cutoff,
            )
        )

        async with self.session_factory() as db:
            result = await db.execute(delete_stmt)
            await db.commit()
            deleted_count = int(getattr(result, "rowcount", 0))
            return {"deleted_count": deleted_count}

    @classmethod
    async def cleanup_expired_tokens_job(cls) -> dict[str, Any]:
        try:
            service = cls(session_factory=SessionLocal)
            result = await service.cleanup_expired_and_revoked_tokens()
            deleted_count = result.get("deleted_count", 0)
            logger.info("Cleaned up %s expired/revoked refresh tokens", deleted_count)
            return {"deleted_count": deleted_count}
        except Exception as e:
            logger.error("Error cleaning up refresh tokens: %s", e)
            return {"error": str(e)}
