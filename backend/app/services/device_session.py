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


async def active_device_ids(
    db: AsyncSession, user_id: uuid.UUID, device_ids: frozenset[uuid.UUID]
) -> frozenset[uuid.UUID]:
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


DEVICE_RECHECK_SECONDS = 5.0
StreamItem = TypeVar("StreamItem")


class DeviceSession:
    live: ClassVar[set["DeviceSession"]] = set()

    def __init__(self, user_id: uuid.UUID, device_ids: frozenset[uuid.UUID]) -> None:
        self.user_id = user_id
        self.device_ids = device_ids
        self.checked_at = time.monotonic()
        self.revoked = False
        self.interrupt: asyncio.Timeout | None = None

    @classmethod
    def revoke(cls, device_ids: frozenset[uuid.UUID]) -> None:
        for session in cls.live:
            if session.device_ids & device_ids:
                session.revoked = True
                if session.interrupt is not None:
                    session.interrupt.reschedule(0)

    @contextmanager
    def _registered(self) -> Iterator[None]:
        if self.device_ids:
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
        if not self.device_ids:
            return True
        async with SessionLocal() as db:
            active = await active_device_ids(db, self.user_id, self.device_ids)
        self.checked_at = time.monotonic()
        return active == self.device_ids and not self.revoked

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
