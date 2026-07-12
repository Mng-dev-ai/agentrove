import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    generate_refresh_token,
    get_refresh_token_expiry,
    hash_refresh_token,
)
from app.db.session import SessionLocal
from app.models.db_models.refresh_token import RefreshToken
from app.models.db_models.user import User
from app.services.db import SessionFactoryType
from app.services.exceptions import AuthException

logger = logging.getLogger(__name__)

# How long a just-rotated token may still be replayed. Clients can lose the
# rotation response (network drop, app killed mid-refresh) and retry with the
# old token — rejecting that would log the device out for a benign retry.
REUSE_GRACE_SECONDS = 60


class RefreshTokenService:
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        self.session_factory = session_factory or SessionLocal

    async def create_refresh_token(
        self,
        user_id: UUID,
        db: AsyncSession,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        token = generate_refresh_token()
        token_hash = hash_refresh_token(token)
        expires_at = get_refresh_token_expiry()

        refresh_token = RefreshToken(
            token_hash=token_hash,
            user_id=user_id,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
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
    ) -> tuple[User, str]:
        token_hash = hash_refresh_token(token)

        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        refresh_token = result.scalar_one_or_none()

        if not refresh_token or refresh_token.is_expired:
            raise AuthException("Invalid or expired refresh token")

        # Reject stale replays per-token only — revoking every session here would
        # log the user out of all devices over one device's stale token.
        if refresh_token.revoked_at is not None and not self._replay_within_grace(
            refresh_token.revoked_at
        ):
            raise AuthException("Invalid or expired refresh token")

        user_result = await db.execute(
            select(User).where(User.id == refresh_token.user_id)
        )
        user = user_result.scalar_one_or_none()

        if not user or not user.is_active:
            raise AuthException("Invalid or expired refresh token")

        # A grace-window replay keeps its original revoked_at — refreshing it
        # would let repeated replays extend the window indefinitely.
        if refresh_token.revoked_at is None:
            refresh_token.revoked_at = datetime.now(timezone.utc)

        new_token = generate_refresh_token()
        new_token_hash = hash_refresh_token(new_token)
        new_expires_at = get_refresh_token_expiry()

        new_refresh_token = RefreshToken(
            token_hash=new_token_hash,
            user_id=user.id,
            expires_at=new_expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )

        db.add(new_refresh_token)
        await db.commit()

        return user, new_token

    def _replay_within_grace(self, revoked_at: datetime) -> bool:
        # ORM objects written in this session keep the Python-side value, which
        # can be naive — UTCDateTime only normalizes on DB read.
        if revoked_at.tzinfo is None:
            revoked_at = revoked_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - revoked_at <= timedelta(
            seconds=REUSE_GRACE_SECONDS
        )

    async def revoke_token(self, token: str, db: AsyncSession) -> bool:
        token_hash = hash_refresh_token(token)

        result = await db.execute(
            select(RefreshToken.user_id).where(RefreshToken.token_hash == token_hash)
        )
        user_id = result.scalar_one_or_none()
        if user_id is None:
            return False

        # Hard-delete rather than mark revoked, and take the user's rotated
        # predecessors (revoked_at set) with it — a grace-eligible predecessor
        # left behind could re-mint credentials for up to REUSE_GRACE_SECONDS
        # after logout.
        await db.execute(
            delete(RefreshToken).where(
                or_(
                    RefreshToken.token_hash == token_hash,
                    and_(
                        RefreshToken.user_id == user_id,
                        RefreshToken.revoked_at.is_not(None),
                    ),
                )
            )
        )
        await db.commit()

        return True

    async def revoke_all_tokens(self, user_id: UUID, db: AsyncSession) -> int:
        # Hard-delete for the same reason as revoke_token — revocation here
        # (password reset) must take effect immediately, not after the grace.
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
