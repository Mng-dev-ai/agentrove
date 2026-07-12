from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.db.sqlite import configure_sqlite

settings = get_settings()

# NullPool: SQLite connections are cheap local file opens, and a bounded pool
# gets exhausted when slow requests (Docker setup, LLM calls) pin connections
# for their full duration — WAL mode handles the resulting write concurrency.
engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
    poolclass=NullPool,
)
configure_sqlite(engine.sync_engine)

SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as db:
        yield db
