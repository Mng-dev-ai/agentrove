import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.paired_device import PairedDevice, PairingSecret
from app.models.db_models.user import User
from app.services.exceptions import AuthException
from app.services.refresh_token import RefreshTokenService

PAIRING_SECRET_TTL = timedelta(minutes=5)
MAX_PAIRING_SECRETS_PER_USER = 5


class PairingService:
    @staticmethod
    def hash_secret(secret: str) -> str:
        return hashlib.sha256(secret.encode()).hexdigest()

    @staticmethod
    async def create_secret(user_id: UUID, db: AsyncSession) -> tuple[str, datetime]:
        secret = secrets.token_urlsafe(16)
        now = datetime.now(timezone.utc)
        expires_at = now + PAIRING_SECRET_TTL
        await db.execute(delete(PairingSecret).where(PairingSecret.expires_at <= now))
        db.add(
            PairingSecret(
                secret_hash=PairingService.hash_secret(secret),
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
                PairingSecret.secret_hash == PairingService.hash_secret(secret),
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
    def edited_device_ids(
        stored: frozenset[UUID],
        editor: frozenset[UUID],
        earlier_content_survives: bool,
    ) -> frozenset[UUID]:
        return stored | editor if earlier_content_survives else editor

    @staticmethod
    async def active_device_ids(
        db: AsyncSession, user_id: UUID, device_ids: frozenset[UUID]
    ) -> frozenset[UUID]:
        if not device_ids:
            return frozenset()
        result = await db.scalars(
            select(PairedDevice.id).where(
                PairedDevice.id.in_(device_ids),
                PairedDevice.user_id == user_id,
                PairedDevice.revoked_at.is_(None),
            )
        )
        return frozenset(result.all())

    @staticmethod
    async def all_active(
        db: AsyncSession, user_id: UUID, device_ids: frozenset[UUID]
    ) -> bool:
        return (
            await PairingService.active_device_ids(db, user_id, device_ids)
            == device_ids
        )
