import asyncio
from dataclasses import replace
from functools import partial
from typing import ClassVar
from uuid import UUID

from sqlalchemy import select, update

from app.models.db_models.chat import Chat
from app.services.acp.session import AcpSession, AcpSessionConfig
from app.services.db import SessionFactoryType
from app.services.exceptions import ChatException, ErrorCode


class ForkService:
    """Gives a forked chat its own copy of the source's native session.

    The copy is made with ACP session/fork in a short-lived agent process and
    its id stored on the chat, which then loads it like any session of its own.
    """

    # One uvicorn worker, so in-process state dedupes the fork started at
    # creation against the chat's first turn.
    _inflight: ClassVar[dict[UUID, asyncio.Task[str]]] = {}

    def __init__(self, session_factory: SessionFactoryType) -> None:
        self.session_factory = session_factory

    def start(self, chat_id: UUID, config: AcpSessionConfig) -> asyncio.Task[str]:
        task = asyncio.create_task(self._fork(chat_id, config))
        self._inflight[chat_id] = task
        task.add_done_callback(partial(self._settle, chat_id))
        return task

    async def ensure_session(self, chat_id: UUID, config: AcpSessionConfig) -> str:
        task = self._inflight.get(chat_id) or self.start(chat_id, config)
        # Shielded: a cancelled turn must not kill the fork another caller awaits.
        return await asyncio.shield(task)

    async def discard_session(self, chat_id: UUID) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(Chat)
                .where(Chat.id == chat_id)
                .values(forked_session_id=None, updated_at=Chat.updated_at)
            )
            await db.commit()

    @classmethod
    def _settle(cls, chat_id: UUID, task: asyncio.Task[str]) -> None:
        del cls._inflight[chat_id]
        # A failure at creation resurfaces on the chat's first turn, which retries.
        if not task.cancelled():
            task.exception()

    async def _fork(self, chat_id: UUID, config: AcpSessionConfig) -> str:
        async with self.session_factory() as db:
            forked_session_id, source_session_id = (
                await db.execute(
                    select(Chat.forked_session_id, Chat.fork_source_session_id).where(
                        Chat.id == chat_id
                    )
                )
            ).one()
        if forked_session_id:
            return str(forked_session_id)
        try:
            session = await AcpSession.create(
                # Closed right after the copy, so it needs no model or mode.
                replace(
                    config,
                    resume_session_id=None,
                    fork_session_id=source_session_id,
                    model="",
                    permission_mode="",
                    fast_mode=False,
                )
            )
        except Exception as exc:
            raise ChatException(
                "Couldn't copy the source chat's session into this fork "
                f"({str(exc) or type(exc).__name__}). Send your message again to retry.",
                error_code=ErrorCode.VALIDATION_ERROR,
            ) from exc
        try:
            async with self.session_factory() as db:
                await db.execute(
                    update(Chat)
                    .where(Chat.id == chat_id)
                    .values(
                        forked_session_id=session.acp_session_id,
                        updated_at=Chat.updated_at,
                    )
                )
                await db.commit()
        finally:
            await session.close()
        return session.acp_session_id
