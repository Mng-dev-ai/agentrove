import os
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.core.config import get_settings

BASE_REVISION = "e3bdc269cf4a"
ORPHANING_MIGRATION = """
import sqlalchemy as sa
from alembic import op

revision = "orphaning"
down_revision = "{head}"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("orphaning_marker", sa.Integer(), nullable=True))
    op.execute("DELETE FROM workspaces")


def downgrade() -> None:
    pass
"""
COLUMN_VALUES = {("channel_messages", "status"): "completed"}
NEW_TABLES = {"instance", "paired_devices", "pairing_secrets"}
ADDED_TO_BASE_TABLES = {
    "refresh_tokens": {
        ("column", "device_id", "CHAR(32)", 0, None, 0),
        ("index", "ix_refresh_tokens_device_id", 0, "c", 0, ("device_id",)),
    },
    "channel_messages": {("column", "device_ids", "JSON", 1, "'[]'", 0)},
    "automations": {("column", "device_ids", "JSON", 1, "'[]'", 0)},
    "chat_checkpoints": {("column", "head_ref", "VARCHAR(255)", 0, None, 0)},
    "channels": {
        ("column", "last_viewed_at", "DATETIME", 0, None, 0),
        ("column", "pinned_at", "DATETIME", 0, None, 0),
    },
    "channel_members": {("column", "removed_at", "DATETIME", 0, None, 0)},
    "user_settings": {("column", "settings_version", "INTEGER", 1, "'0'", 0)},
}


def _alembic_config() -> Config:
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).parents[1] / "migrations")
    )
    return config


def _column_value(table: sa.Table, column: sa.Column[Any]) -> Any:
    if (table.name, column.name) in COLUMN_VALUES:
        return COLUMN_VALUES[(table.name, column.name)]
    python_type = column.type.python_type
    if python_type is int:
        return 1
    if python_type is bool:
        return True
    if python_type is float:
        return 1.0
    if python_type is datetime:
        return datetime(2026, 1, 1)
    if python_type is dict:
        return {}
    return uuid4().hex


def _seed_empty_tables(engine: sa.Engine) -> None:
    metadata = sa.MetaData()
    metadata.reflect(engine)
    seeded: dict[str, dict[str, Any]] = {}
    with engine.begin() as conn:
        for table in metadata.sorted_tables:
            existing = conn.execute(sa.select(table).limit(1)).mappings().first()
            if existing is not None:
                seeded[table.name] = dict(existing)
                continue
            row: dict[str, Any] = {}
            for column in table.columns:
                foreign_keys = [
                    fk for fk in column.foreign_keys if fk.column.table is not table
                ]
                if foreign_keys:
                    parent = foreign_keys[0].column
                    row[column.name] = seeded[parent.table.name][parent.name]
                elif column.foreign_keys:
                    row[column.name] = None
                else:
                    row[column.name] = _column_value(table, column)
            conn.execute(table.insert().values(row))
            seeded[table.name] = row


def _row_counts(engine: sa.Engine) -> dict[str, int]:
    tables = sa.inspect(engine).get_table_names()
    with engine.connect() as conn:
        return {
            table: conn.execute(
                sa.select(sa.func.count()).select_from(sa.table(table))
            ).scalar_one()
            for table in tables
            if table != "alembic_version"
        }


def _table_schema(conn: sa.Connection, table: str) -> set[tuple[Any, ...]]:
    schema: set[tuple[Any, ...]] = {
        ("column", *row[1:])
        for row in conn.exec_driver_sql(f'PRAGMA table_info("{table}")')
    }
    schema |= {
        ("foreign_key", *row[2:7])
        for row in conn.exec_driver_sql(f'PRAGMA foreign_key_list("{table}")')
    }
    for index in conn.exec_driver_sql(f'PRAGMA index_list("{table}")').all():
        columns = tuple(
            row[2] for row in conn.exec_driver_sql(f'PRAGMA index_info("{index[1]}")')
        )
        schema.add(("index", *index[1:], columns))
    return schema


def _schema(engine: sa.Engine) -> dict[str, set[tuple[Any, ...]]]:
    with engine.connect() as conn:
        return {
            table: _table_schema(conn, table)
            for table in sa.inspect(conn).get_table_names()
            if table != "alembic_version"
        }


@pytest.fixture
def migration_engine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[sa.Engine]:
    db_path = tmp_path / "migrations.db"
    monkeypatch.setattr(
        get_settings(), "DATABASE_URL", f"sqlite+aiosqlite:///{db_path}"
    )
    engine = sa.create_engine(f"sqlite:///{db_path}")
    command.upgrade(_alembic_config(), BASE_REVISION)
    _seed_empty_tables(engine)
    yield engine
    engine.dispose()


def test_upgrade_and_downgrade_keep_every_row(migration_engine: sa.Engine) -> None:
    config = _alembic_config()
    base_counts = _row_counts(migration_engine)
    base_schema = _schema(migration_engine)
    assert all(count == 1 for count in base_counts.values())

    command.upgrade(config, "head")
    assert {
        table: _row_counts(migration_engine)[table] for table in base_counts
    } == base_counts
    head_schema = _schema(migration_engine)
    assert set(head_schema) - set(base_schema) == NEW_TABLES
    assert {table: head_schema[table] for table in base_schema} == {
        table: rows | ADDED_TO_BASE_TABLES.get(table, set())
        for table, rows in base_schema.items()
    }
    _seed_empty_tables(migration_engine)

    command.downgrade(config, BASE_REVISION)
    assert _row_counts(migration_engine) == base_counts
    assert _schema(migration_engine) == base_schema

    command.upgrade(config, "head")
    assert {
        table: _row_counts(migration_engine)[table] for table in base_counts
    } == base_counts
    assert _schema(migration_engine) == head_schema


def test_preexisting_orphan_does_not_block_upgrade(migration_engine: sa.Engine) -> None:
    with migration_engine.begin() as conn:
        chats = sa.Table("chats", sa.MetaData(), autoload_with=conn)
        chat = conn.execute(sa.select(chats)).mappings().one()
        gap_id = uuid4().hex
        conn.execute(chats.insert().values({**chat, "id": gap_id}))
        conn.execute(
            chats.insert().values(
                {**chat, "id": uuid4().hex, "workspace_id": uuid4().hex}
            )
        )
        conn.execute(chats.delete().where(chats.c.id == gap_id))
    base_counts = _row_counts(migration_engine)

    command.upgrade(_alembic_config(), "head")

    assert {
        table: _row_counts(migration_engine)[table] for table in base_counts
    } == base_counts


def test_migration_that_orphans_rows_is_rolled_back(
    migration_engine: sa.Engine, tmp_path: Path
) -> None:
    config = _alembic_config()
    command.upgrade(config, "head")
    head = ScriptDirectory.from_config(config).get_current_head()
    versions = tmp_path / "orphaning_versions"
    versions.mkdir()
    (versions / "orphaning.py").write_text(ORPHANING_MIGRATION.format(head=head))
    config.set_main_option("version_path_separator", "os")
    config.set_main_option(
        "version_locations",
        os.pathsep.join(
            [str(Path(__file__).parents[1] / "migrations" / "versions"), str(versions)]
        ),
    )
    counts = _row_counts(migration_engine)
    schema = _schema(migration_engine)

    with pytest.raises(RuntimeError, match="introduced foreign key violations"):
        command.upgrade(config, "orphaning")

    assert _row_counts(migration_engine) == counts
    assert _schema(migration_engine) == schema
    with migration_engine.connect() as conn:
        version = conn.exec_driver_sql("SELECT version_num FROM alembic_version")
        assert version.scalar_one() == head
