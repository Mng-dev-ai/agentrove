from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine


def _set_pragmas(dbapi_connection: Any, _: Any) -> None:
    cursor = dbapi_connection.cursor()
    # SQLite ignores FK constraints unless PRAGMA foreign_keys=ON is set per
    # connection — required for ondelete CASCADE / SET NULL to be enforced.
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL lets readers and the writer proceed concurrently — the engine uses
    # NullPool (one connection per session), so without WAL concurrent sessions
    # would serialize behind the rollback journal's exclusive lock.
    cursor.execute("PRAGMA journal_mode=WAL")
    # Wait for a busy writer instead of failing fast with "database is locked"
    # (the driver default is 5s, too short for bursts of stream-snapshot writes).
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


def configure_sqlite(engine: Engine) -> None:
    event.listen(engine, "connect", _set_pragmas)
