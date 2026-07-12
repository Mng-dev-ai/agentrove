#!/usr/bin/env python3
import logging

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.core.config import get_settings
from app.db.sqlite import configure_sqlite

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def check_and_run_migrations():
    settings = get_settings()
    db_url = settings.DATABASE_URL.replace("sqlite+aiosqlite://", "sqlite://", 1)
    is_production = settings.ENVIRONMENT.lower() == "production"

    engine = create_engine(db_url)
    configure_sqlite(engine)

    try:
        with engine.connect():
            inspector = inspect(engine)
            tables = inspector.get_table_names()

            alembic_cfg = Config("alembic.ini")
            alembic_cfg.set_main_option("sqlalchemy.url", db_url)

            if "alembic_version" not in tables and "users" in tables:
                command.stamp(alembic_cfg, "head")

            command.upgrade(alembic_cfg, "head")

    except Exception as e:
        logger.error("Migration failed: %s", e)
        if is_production or settings.DESKTOP_MODE:
            logger.error("Migration failed in strict mode. Aborting startup.")
            raise
        logger.error("Continuing in non-production environment...")
    finally:
        engine.dispose()


if __name__ == "__main__":
    check_and_run_migrations()
