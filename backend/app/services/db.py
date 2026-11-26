from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import AsyncContextManager, Callable, Generic, TypeVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, begin_immediate
from app.models.db_models.user import User
from app.services.exceptions import ErrorCode, ServiceException

T = TypeVar("T")

SessionFactoryType = Callable[[], AsyncContextManager[AsyncSession]]


class BaseDbService(Generic[T]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        self._session_factory = session_factory or SessionLocal

    @property
    def session_factory(self) -> SessionFactoryType:
        return self._session_factory

    @session_factory.setter
    def session_factory(self, value: SessionFactoryType) -> None:
        self._session_factory = value

    @asynccontextmanager
    async def write_session(self) -> AsyncIterator[AsyncSession]:
        async with self._session_factory() as db:
            await begin_immediate(db)
            yield db

    @staticmethod
    def require_agent_workspace(user: User, workspace_id: UUID | None) -> None:
        if (
            user.agent_scope is not None
            and workspace_id != user.agent_scope.workspace_id
        ):
            raise ServiceException(
                "Not found: this sandboxed agent session is limited to its own workspace",
                error_code=ErrorCode.WORKSPACE_NOT_FOUND,
                status_code=404,
            )

    @staticmethod
    def agent_workspace_filter(user: User, workspace_id: UUID | None) -> UUID | None:
        return user.agent_scope.workspace_id if user.agent_scope else workspace_id
