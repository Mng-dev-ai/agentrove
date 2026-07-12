from logging.config import fileConfig

from sqlalchemy import create_engine, pool
import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import context
from app.db.base_class import Base
from app.db.sqlite import configure_sqlite
from app.models.db_models import (  # noqa: F401
    automation,
    chat,
    refresh_token,
    user,
    workspace,
)
from app.core.config import get_settings
from app.db.types import GUID, EncryptedString, UTCDateTime

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

settings = get_settings()
database_url = settings.DATABASE_URL

_HELPERS_IMPORT = "from app.db.migration_helpers import uuid_server_default, now_server_default"


def render_item(type_, obj, autogen_context):
    if type_ == "type":
        if isinstance(obj, GUID):
            autogen_context.imports.add("from app.db.types import GUID")
            return "GUID()"
        if isinstance(obj, EncryptedString):
            autogen_context.imports.add("from app.db.types import EncryptedString")
            return "EncryptedString()"
        if isinstance(obj, UTCDateTime):
            autogen_context.imports.add("from app.db.types import UTCDateTime")
            return "UTCDateTime()"

    if type_ == "server_default":
        arg = getattr(obj, "arg", obj)
        if isinstance(arg, sa.sql.elements.TextClause) and str(arg.text) == "CURRENT_TIMESTAMP":
            autogen_context.imports.add(_HELPERS_IMPORT)
            return "now_server_default()"
        if isinstance(arg, sa.sql.functions.Function) and arg.name == "now":
            autogen_context.imports.add(_HELPERS_IMPORT)
            return "now_server_default()"

    return False


def compare_server_default(
    migration_context,
    inspected_column,
    metadata_column,
    rendered_column_default,
    metadata_default,
    rendered_metadata_default,
):
    if isinstance(inspected_column.type, sa.JSON) or isinstance(
        metadata_column.type, sa.JSON
    ):
        return False
    return None


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_item=render_item,
        compare_server_default=compare_server_default,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_item=render_item,
        compare_server_default=compare_server_default,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    sync_url = database_url.replace("sqlite+aiosqlite://", "sqlite://", 1)
    engine = create_engine(sync_url, poolclass=pool.NullPool)
    configure_sqlite(engine)
    with engine.connect() as connection:
        do_run_migrations(connection)
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
