#!/usr/bin/env python3
import importlib.util
import logging

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def check_and_run_migrations():
    settings = get_settings()
    db_url = settings.DATABASE_URL
    is_production = settings.ENVIRONMENT.lower() == "production"

    if db_url.startswith("postgresql+asyncpg://"):
        if importlib.util.find_spec("psycopg2") is not None:
            db_url = db_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
        else:
            db_url = db_url.replace("postgresql+asyncpg://", "postgresql+psycopg://")

    engine = create_engine(db_url)

    try:
        with engine.connect():
            inspector = inspect(engine)
            tables = inspector.get_table_names()

            alembic_cfg = Config("alembic.ini")
            alembic_cfg.set_main_option("sqlalchemy.url", db_url)

            script = ScriptDirectory.from_config(alembic_cfg)
            head_revision = script.get_current_head()

            if "alembic_version" not in tables:
                if "users" in tables and head_revision:
                    command.stamp(alembic_cfg, head_revision)
            else:
                with engine.connect() as conn:
                    result = conn.execute(
                        text("SELECT version_num FROM alembic_version")
                    )
                    current = result.scalar()
                    if current and current != head_revision:
                        revisions = [r.revision for r in script.walk_revisions()]
                        if current not in revisions:
                            logger.info(
                                "Stamping to head (old revision %s not found)", current
                            )
                            command.stamp(alembic_cfg, head_revision, purge=True)

            command.upgrade(alembic_cfg, "head")

    except Exception as e:
        logger.error("Migration failed: %s", e)
        if is_production:
            logger.error("Migration failed in production. Aborting startup.")
            raise
        logger.error("Continuing in non-production environment...")
    finally:
        engine.dispose()


if __name__ == "__main__":
    check_and_run_migrations()
