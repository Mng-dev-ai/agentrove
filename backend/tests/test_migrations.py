from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.core.config import get_settings

BASE_REVISION = "e3bdc269cf4a"
COLUMN_VALUES = {("channel_messages", "status"): "completed"}


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


def test_upgrade_and_downgrade_keep_every_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "migrations.db"
    monkeypatch.setattr(
        get_settings(), "DATABASE_URL", f"sqlite+aiosqlite:///{db_path}"
    )
    config = _alembic_config()
    engine = sa.create_engine(f"sqlite:///{db_path}")

    command.upgrade(config, BASE_REVISION)
    _seed_empty_tables(engine)
    base_counts = _row_counts(engine)
    assert all(count == 1 for count in base_counts.values())

    command.upgrade(config, "head")
    assert {table: _row_counts(engine)[table] for table in base_counts} == base_counts
    _seed_empty_tables(engine)

    command.downgrade(config, BASE_REVISION)
    assert _row_counts(engine) == base_counts

    command.upgrade(config, "head")
    assert {table: _row_counts(engine)[table] for table in base_counts} == base_counts
    engine.dispose()
