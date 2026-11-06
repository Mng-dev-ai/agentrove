from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.paired_device import PairedDevice, PairingSecret
from app.models.db_models.refresh_token import RefreshToken
from app.services.channel import channel_service
from app.services.device_session import DeviceSession
from app.services.refresh_token import RefreshTokenService
from app.services.streaming.runtime import ChatStreamRuntime


class DeviceRevocationService:
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
        await DeviceRevocationService.end_sessions(frozenset({device_id}))
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
        await DeviceRevocationService.end_sessions(device_ids)
        return revoked

    @staticmethod
    async def end_sessions(device_ids: frozenset[UUID]) -> None:
        DeviceSession.revoke(device_ids)
        await channel_service.cancel_device_turns(device_ids)
        await ChatStreamRuntime.cancel_device_turns(device_ids)
