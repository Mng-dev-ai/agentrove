import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_refresh_token
from app.services.channel import channel_service
from app.services.device_session import DeviceSession
from app.models.db_models.paired_device import PairedDevice, PairingSecret
from app.models.db_models.refresh_token import RefreshToken
from app.models.db_models.user import User
from app.services.exceptions import AuthException
from app.services.refresh_token import RefreshTokenService
from app.services.streaming.runtime import ChatStreamRuntime

PAIRING_SECRET_TTL = timedelta(minutes=5)
MAX_PAIRING_SECRETS_PER_USER = 5


class PairingService:
    @staticmethod
    async def create_secret(user_id: UUID, db: AsyncSession) -> tuple[str, datetime]:
        secret = secrets.token_urlsafe(16)
        now = datetime.now(timezone.utc)
        expires_at = now + PAIRING_SECRET_TTL
        await db.execute(delete(PairingSecret).where(PairingSecret.expires_at <= now))
        db.add(
            PairingSecret(
                secret_hash=hash_refresh_token(secret),
                user_id=user_id,
                expires_at=expires_at,
            )
        )
        await db.flush()
        newest = (
            select(PairingSecret.id)
            .where(PairingSecret.user_id == user_id)
            .order_by(PairingSecret.expires_at.desc())
            .limit(MAX_PAIRING_SECRETS_PER_USER)
        )
        await db.execute(
            delete(PairingSecret).where(
                PairingSecret.user_id == user_id, PairingSecret.id.not_in(newest)
            )
        )
        await db.commit()
        return secret, expires_at

    @staticmethod
    async def redeem(
        secret: str,
        device_name: str,
        db: AsyncSession,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> tuple[User, PairedDevice, str]:
        user_id = await db.scalar(
            delete(PairingSecret)
            .where(
                PairingSecret.secret_hash == hash_refresh_token(secret),
                PairingSecret.expires_at > datetime.now(timezone.utc),
            )
            .returning(PairingSecret.user_id)
        )
        user = None if user_id is None else await db.get(User, user_id)
        if user is None or not user.is_active:
            raise AuthException("Invalid or expired pairing link")
        device = PairedDevice(user_id=user.id, name=device_name)
        db.add(device)
        await db.flush()
        refresh_token = await RefreshTokenService().create_refresh_token(
            user_id=user.id,
            db=db,
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device.id,
        )
        return user, device, refresh_token

    @staticmethod
    async def list_devices(user_id: UUID, db: AsyncSession) -> list[PairedDevice]:
        result = await db.scalars(
            select(PairedDevice)
            .where(PairedDevice.user_id == user_id, PairedDevice.revoked_at.is_(None))
            .order_by(PairedDevice.created_at)
        )
        return list(result.all())

    @staticmethod
    async def revoke_device(user_id: UUID, device_id: UUID, db: AsyncSession) -> bool:
        revoked = await db.scalar(
            update(PairedDevice)
            .where(PairedDevice.id == device_id, PairedDevice.user_id == user_id)
            .values(
                revoked_at=func.coalesce(
                    PairedDevice.revoked_at, datetime.now(timezone.utc)
                )
            )
            .returning(PairedDevice.id)
        )
        if revoked is None:
            return False
        await db.execute(
            delete(RefreshToken).where(RefreshToken.device_id == device_id)
        )
        await db.commit()
        await PairingService.end_sessions(frozenset({device_id}))
        return True

    @staticmethod
    async def revoke_all(user_id: UUID, db: AsyncSession) -> int:
        device_ids = frozenset(
            await db.scalars(
                update(PairedDevice)
                .where(PairedDevice.user_id == user_id)
                .values(
                    revoked_at=func.coalesce(
                        PairedDevice.revoked_at, datetime.now(timezone.utc)
                    )
                )
                .returning(PairedDevice.id)
            )
        )
        await db.execute(delete(PairingSecret).where(PairingSecret.user_id == user_id))
        revoked = await RefreshTokenService().revoke_all_tokens(user_id, db)
        await PairingService.end_sessions(device_ids)
        return revoked

    @staticmethod
    async def end_sessions(device_ids: frozenset[UUID]) -> None:
        DeviceSession.revoke(device_ids)
        await channel_service.cancel_device_turns(device_ids)
        await ChatStreamRuntime.cancel_device_turns(device_ids)
