import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx
from jose import jwt
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.db_models.push import PushDelivery, PushDevice
from app.models.db_models.user import UserSettings
from app.services.db import SessionFactoryType

logger = logging.getLogger(__name__)
settings = get_settings()

PERMISSION_TTL_SECONDS = 600
COMPLETION_TTL_SECONDS = 3600
SEND_INTERVAL_SECONDS = 5.0
MAX_ATTEMPTS = 5
CLAIM_LEASE_SECONDS = 60
# Apple rejects provider tokens older than an hour and throttles refreshes
# more often than every 20 minutes.
PROVIDER_TOKEN_TTL_SECONDS = 50 * 60
DEAD_TOKEN_REASONS = frozenset(
    {"BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"}
)
SEND_BATCH_SIZE = 100


class PushService:
    _provider_token: tuple[str, float] | None = None

    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        self.session_factory = session_factory or SessionLocal

    @staticmethod
    def enabled() -> bool:
        return bool(
            settings.APNS_KEY and settings.APNS_KEY_ID and settings.APNS_TEAM_ID
        )

    @staticmethod
    async def register_device(
        db: AsyncSession, user_id: UUID, token: str, sandbox: bool
    ) -> None:
        device = await db.scalar(select(PushDevice).where(PushDevice.token == token))
        now = datetime.now(timezone.utc)
        if device is not None and device.user_id == user_id:
            device.sandbox = sandbox
            device.updated_at = now
        else:
            # A phone that switched accounts gets a fresh row so deliveries queued
            # for the previous account cascade away instead of reaching the new one.
            if device is not None:
                await db.delete(device)
                await db.flush()
            db.add(
                PushDevice(
                    user_id=user_id, token=token, sandbox=sandbox, updated_at=now
                )
            )
        await db.commit()

    @staticmethod
    async def unregister_device(db: AsyncSession, user_id: UUID, token: str) -> None:
        await db.execute(
            delete(PushDevice).where(
                PushDevice.token == token, PushDevice.user_id == user_id
            )
        )
        await db.commit()

    async def notify_permission(
        self, *, user_id: UUID, path: str, request_id: str, tool_name: str
    ) -> None:
        if tool_name == "ExitPlanMode":
            title, body = (
                "Plan ready for approval",
                "Review the plan and approve or reject it.",
            )
        else:
            title, body = (
                "Permission needed",
                f'Tool "{tool_name}" is waiting for your approval.',
            )
        await self.enqueue(
            user_id=user_id,
            event_key=f"{path}:perm:{request_id}",
            title=title,
            body=body,
            path=path,
            collapse_id=f"perm:{request_id}",
            ttl_seconds=PERMISSION_TTL_SECONDS,
        )

    async def notify_completion(
        self, *, user_id: UUID, chat_id: str, message_id: str, failed: bool
    ) -> None:
        await self.enqueue(
            user_id=user_id,
            event_key=f"{message_id}:complete",
            title="Task failed" if failed else "Task completed",
            body="Open the chat to see the result.",
            path=f"/chat/{chat_id}",
            collapse_id=f"{chat_id}:complete",
            ttl_seconds=COMPLETION_TTL_SECONDS,
        )

    async def enqueue(
        self,
        *,
        user_id: UUID,
        event_key: str,
        title: str,
        body: str,
        path: str,
        collapse_id: str,
        ttl_seconds: int,
    ) -> None:
        if not self.enabled():
            return
        # Push is a side channel: a failure here must never fail the agent run.
        try:
            async with self.session_factory() as db:
                notifications_enabled = await db.scalar(
                    select(UserSettings.notifications_enabled).where(
                        UserSettings.user_id == user_id
                    )
                )
                if notifications_enabled is False:
                    return
                device_ids = (
                    await db.scalars(
                        select(PushDevice.id).where(PushDevice.user_id == user_id)
                    )
                ).all()
                if not device_ids:
                    return
                now = datetime.now(timezone.utc)
                await db.execute(
                    insert(PushDelivery)
                    .values(
                        [
                            {
                                "id": uuid4(),
                                "event_key": event_key,
                                "device_id": device_id,
                                "title": title,
                                "body": body,
                                "path": path,
                                "collapse_id": collapse_id[:64],
                                "expires_at": now + timedelta(seconds=ttl_seconds),
                                "next_attempt_at": now,
                                "attempts": 0,
                            }
                            for device_id in device_ids
                        ]
                    )
                    .on_conflict_do_nothing(index_elements=["event_key", "device_id"])
                )
                await db.commit()
        except Exception:
            logger.exception("Failed to enqueue push %s", event_key)

    async def send_due(self) -> dict[str, Any]:
        if not self.enabled():
            return {}
        now = datetime.now(timezone.utc)
        async with self.session_factory() as db:
            # Sent rows stay until expiry so a re-enqueued event still dedups.
            await db.execute(delete(PushDelivery).where(PushDelivery.expires_at <= now))
            await db.commit()
            due_ids = (
                await db.scalars(
                    select(PushDelivery.id)
                    .where(
                        PushDelivery.finished_at.is_(None),
                        PushDelivery.next_attempt_at <= now,
                    )
                    .limit(SEND_BATCH_SIZE)
                )
            ).all()
            if not due_ids:
                return {}
            sent = 0
            async with httpx.AsyncClient(http2=True, timeout=10.0) as client:
                for delivery_id in due_ids:
                    sent += await self._claim_and_send(db, client, delivery_id)
        return {"sent": sent}

    async def _claim_and_send(
        self, db: AsyncSession, client: httpx.AsyncClient, delivery_id: UUID
    ) -> int:
        # Claim right before sending, as a lease: a concurrent sender skips the row,
        # a crash only delays it, and every later write is fenced on the lease so a
        # sender that outlived it can't overwrite a newer claim.
        claimed_at = datetime.now(timezone.utc)
        lease = claimed_at + timedelta(seconds=CLAIM_LEASE_SECONDS)
        claim = await db.execute(
            update(PushDelivery)
            .where(
                PushDelivery.id == delivery_id,
                PushDelivery.finished_at.is_(None),
                PushDelivery.next_attempt_at <= claimed_at,
                PushDelivery.expires_at > claimed_at,
            )
            .values(next_attempt_at=lease, attempts=PushDelivery.attempts + 1)
            .execution_options(synchronize_session=False)
        )
        await db.commit()
        if claim.rowcount != 1:
            return 0
        # Re-read after the claim: logout or an account switch deletes the device
        # (and its deliveries), and the user may have turned notifications off.
        row = (
            await db.execute(
                select(PushDelivery, PushDevice, UserSettings.notifications_enabled)
                .join(PushDevice, PushDevice.id == PushDelivery.device_id)
                .outerjoin(UserSettings, UserSettings.user_id == PushDevice.user_id)
                .where(PushDelivery.id == delivery_id)
                .execution_options(populate_existing=True)
            )
        ).one_or_none()
        if row is None:
            return 0
        delivery, device, notifications_enabled = row
        if notifications_enabled is False:
            await self._finish(db, delivery, lease)
            return 0

        host = "api.sandbox.push.apple.com" if device.sandbox else "api.push.apple.com"
        try:
            response = await client.post(
                f"https://{host}/3/device/{device.token}",
                headers={
                    "authorization": f"bearer {self._get_provider_token()}",
                    "apns-topic": settings.APNS_TOPIC,
                    "apns-push-type": "alert",
                    "apns-priority": "10",
                    "apns-expiration": str(int(delivery.expires_at.timestamp())),
                    "apns-collapse-id": delivery.collapse_id,
                },
                json={
                    "aps": {
                        "alert": {"title": delivery.title, "body": delivery.body},
                        "sound": "default",
                    },
                    "path": delivery.path,
                },
            )
        except httpx.HTTPError:
            logger.warning("APNs request failed for delivery %s", delivery.id)
            await self._retry_or_finish(db, delivery, lease, claimed_at)
            return 0

        if response.status_code == 200:
            await self._finish(db, delivery, lease)
            return 1
        reason = response.json().get("reason", "") if response.content else ""
        if response.status_code == 410 or reason in DEAD_TOKEN_REASONS:
            # Only a token unchanged since the claim is dead; a re-registration in
            # between may have fixed it (e.g. sandbox flag) and gets a retry.
            dead = await db.execute(
                delete(PushDevice).where(
                    PushDevice.id == device.id,
                    PushDevice.token == device.token,
                    PushDevice.updated_at <= claimed_at,
                )
            )
            await db.commit()
            if dead.rowcount != 1:
                await self._retry_or_finish(db, delivery, lease, claimed_at)
            return 0
        if response.status_code == 429 or response.status_code >= 500:
            await self._retry_or_finish(db, delivery, lease, claimed_at)
            return 0
        logger.error(
            "APNs rejected delivery %s: %s %s",
            delivery.id,
            response.status_code,
            reason,
        )
        await self._finish(db, delivery, lease)
        return 0

    @staticmethod
    async def _finish(
        db: AsyncSession, delivery: PushDelivery, lease: datetime
    ) -> None:
        await db.execute(
            update(PushDelivery)
            .where(
                PushDelivery.id == delivery.id, PushDelivery.next_attempt_at == lease
            )
            .values(finished_at=datetime.now(timezone.utc))
            .execution_options(synchronize_session=False)
        )
        await db.commit()

    @classmethod
    async def _retry_or_finish(
        cls,
        db: AsyncSession,
        delivery: PushDelivery,
        lease: datetime,
        claimed_at: datetime,
    ) -> None:
        next_attempt_at = claimed_at + timedelta(seconds=2**delivery.attempts * 5)
        if delivery.attempts >= MAX_ATTEMPTS or next_attempt_at >= delivery.expires_at:
            await cls._finish(db, delivery, lease)
            return
        await db.execute(
            update(PushDelivery)
            .where(
                PushDelivery.id == delivery.id, PushDelivery.next_attempt_at == lease
            )
            .values(next_attempt_at=next_attempt_at)
            .execution_options(synchronize_session=False)
        )
        await db.commit()

    @classmethod
    def _get_provider_token(cls) -> str:
        cached = cls._provider_token
        if cached is not None and time.time() - cached[1] < PROVIDER_TOKEN_TTL_SECONDS:
            return cached[0]
        issued_at = time.time()
        token: str = jwt.encode(
            {"iss": settings.APNS_TEAM_ID, "iat": int(issued_at)},
            # .p8 keys are multi-line; env files usually carry them with literal \n.
            settings.APNS_KEY.replace("\\n", "\n"),
            algorithm="ES256",
            headers={"kid": settings.APNS_KEY_ID},
        )
        cls._provider_token = (token, issued_at)
        return token
