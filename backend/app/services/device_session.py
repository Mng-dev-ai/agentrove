import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from typing import ClassVar, TypeVar

from app.core.user_manager import password_fingerprint
from app.db.session import SessionLocal
from app.models.db_models.user import User
from app.services.pairing import PairingService


DEVICE_RECHECK_SECONDS = 5.0
StreamItem = TypeVar("StreamItem")


class DeviceSession:
    live: ClassVar[set["DeviceSession"]] = set()

    def __init__(self, user: User) -> None:
        self.user_id = user.id
        self.device_ids = user.device_ids
        self.fingerprint = password_fingerprint(user.hashed_password)
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
        async with SessionLocal() as db:
            user = await db.get(User, self.user_id)
            active = (
                user is not None
                and user.is_active
                and password_fingerprint(user.hashed_password) == self.fingerprint
                and await PairingService.all_active(db, self.user_id, self.device_ids)
            )
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
