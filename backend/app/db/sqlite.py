from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine


def _set_pragmas(dbapi_connection: Any, _: Any) -> None:
    cursor = dbapi_connection.cursor()
    # Per-connection: SQLite ignores FKs unless this is ON (CASCADE/SET NULL).
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL: NullPool means one conn per session; without WAL writers serialize.
    cursor.execute("PRAGMA journal_mode=WAL")
    # Default 5s busy timeout is too short under stream-snapshot write bursts.
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


def configure_sqlite(engine: Engine) -> None:
    event.listen(engine, "connect", _set_pragmas)
