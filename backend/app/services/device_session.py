import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from typing import ClassVar, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.db_models.paired_device import PairedDevice


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
    live: ClassVar[set["DeviceSession"]] = set()

    def __init__(self, user_id: uuid.UUID, device_id: uuid.UUID | None) -> None:
        self.user_id = user_id
        self.device_id = device_id
        self.checked_at = time.monotonic()
        self.revoked = False
        self.interrupt: asyncio.Timeout | None = None

    @classmethod
    def revoke(cls, user_id: uuid.UUID, device_id: uuid.UUID | None = None) -> None:
        for session in cls.live:
            if session.user_id == user_id and device_id in (None, session.device_id):
                session.revoked = True
                if session.interrupt is not None:
                    session.interrupt.reschedule(0)

    @contextmanager
    def _registered(self) -> Iterator[None]:
        if self.device_id is not None:
            DeviceSession.live.add(self)
        try:
            yield
        finally:
            DeviceSession.live.discard(self)

    @asynccontextmanager
    async def _interruptible(self) -> AsyncIterator[None]:
        try:
            async with asyncio.timeout(None) as self.interrupt:
                yield
        except TimeoutError:
            if not self.revoked:
                raise
        finally:
            self.interrupt = None

    async def check(self) -> bool:
        if self.device_id is None:
            return True
        async with SessionLocal() as db:
            active = await is_device_active(db, self.device_id, self.user_id)
        self.checked_at = time.monotonic()
        return active and not self.revoked

    async def is_active(self) -> bool:
        if time.monotonic() - self.checked_at < DEVICE_RECHECK_SECONDS:
            return not self.revoked
        return await self.check()

    async def watch(self) -> None:
        with self._registered():
            while await self.check():
                async with self._interruptible():
                    await asyncio.sleep(DEVICE_RECHECK_SECONDS)

    async def guard(
        self, stream: AsyncIterator[StreamItem]
    ) -> AsyncIterator[StreamItem]:
        with self._registered():
            if not await self.check():
                return
            while not self.revoked:
                try:
                    async with self._interruptible():
                        item = await anext(stream)
                except StopAsyncIteration:
                    return
                if not await self.is_active():
                    return
                yield item
