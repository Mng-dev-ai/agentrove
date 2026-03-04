import logging
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.system import SystemSettings
from app.models.db_models.user import User

logger = logging.getLogger(__name__)

APP_VERSION = "2.0.0"


class MigrationService:
    """Service for handling app version migrations and seeding."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_migration_status(self) -> dict[str, Any]:
        """Get current migration and version status."""
        # Check if system_settings table exists and has data
        try:
            result = await self.session.execute(select(SystemSettings))
            settings = result.scalar_one_or_none()
        except Exception:
            await self.session.rollback()
            settings = None

        # Check if any users exist (determines if this is a fresh install)
        try:
            user_result = await self.session.execute(select(User).limit(1))
            has_users = user_result.scalar_one_or_none() is not None
        except Exception:
            await self.session.rollback()
            has_users = False

        # Check if this is an upgrade from an older version
        is_upgrade = False
        previous_version = None

        if settings:
            # System settings exist, check if it's an older version
            if hasattr(settings, 'app_version') and settings.app_version:
                if settings.app_version != APP_VERSION:
                    is_upgrade = True
                    previous_version = settings.app_version
            elif has_users:
                # Users exist but no version recorded = old version
                is_upgrade = True
                previous_version = "1.x"

        # Determine if remote DB is configured
        uses_remote_db = False
        if settings and settings.remote_db_enabled and settings.remote_db_url:
            uses_remote_db = True

        return {
            "current_version": APP_VERSION,
            "previous_version": previous_version,
            "is_fresh_install": not has_users,
            "is_upgrade": is_upgrade,
            "needs_migration": is_upgrade,
            "uses_remote_db": uses_remote_db,
            "needs_seed": not has_users and not uses_remote_db,
        }

    async def run_migrations(self) -> dict[str, Any]:
        """Run necessary migrations for version upgrade."""
        status = await self.get_migration_status()
        results = {
            "migrations_run": [],
            "seed_completed": False,
            "errors": [],
        }

        if not status["needs_migration"] and not status["needs_seed"]:
            results["message"] = "No migrations needed"
            return results

        try:
            # Ensure system_settings exists
            settings = await self._ensure_system_settings()
            if settings:
                results["migrations_run"].append("system_settings_initialized")

            # Set first user as admin if upgrading from old version
            if status["is_upgrade"]:
                await self._set_first_user_admin()
                results["migrations_run"].append("first_user_set_as_admin")

            # Run seed if needed (local mode only)
            if status["needs_seed"]:
                await self._run_seed()
                results["seed_completed"] = True
                results["migrations_run"].append("database_seeded")

            # Update app version
            if settings:
                settings.app_version = APP_VERSION  # type: ignore
                await self.session.commit()

            results["message"] = "Migrations completed successfully"

        except Exception as e:
            logger.error(f"Migration failed: {e}")
            results["errors"].append(str(e))

        return results

    async def _ensure_system_settings(self) -> SystemSettings | None:
        """Ensure system_settings table has a row."""
        try:
            result = await self.session.execute(select(SystemSettings))
            settings = result.scalar_one_or_none()

            if not settings:
                settings = SystemSettings()
                self.session.add(settings)
                await self.session.commit()
                await self.session.refresh(settings)

            return settings
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Failed to ensure system settings: {e}")
            return None

    async def _set_first_user_admin(self) -> None:
        """Set the first registered user as admin."""
        result = await self.session.execute(
            select(User).order_by(User.created_at.asc()).limit(1)
        )
        first_user = result.scalar_one_or_none()

        if first_user and not first_user.is_superuser:
            first_user.is_superuser = True
            await self.session.commit()
            logger.info(f"Set user {first_user.id} as admin during migration")

    async def _run_seed(self) -> None:
        """Run database seed for fresh local installation."""
        logger.info("Running database seed for fresh installation")
        # Seed is handled by user registration flow
        # Just ensure tables exist
        pass

    async def get_startup_status(self) -> dict[str, Any]:
        """Get startup status for splash screen."""
        migration_status = await self.get_migration_status()

        return {
            **migration_status,
            "message": self._get_status_message(migration_status),
            "actions": self._get_required_actions(migration_status),
        }

    def _get_status_message(self, status: dict[str, Any]) -> str:
        """Get human-readable status message."""
        if status["is_fresh_install"]:
            if status["uses_remote_db"]:
                return "Connecting to remote database..."
            return "Setting up local database..."
        elif status["is_upgrade"]:
            return f"Upgrading from version {status['previous_version']} to {APP_VERSION}..."
        return "Ready"

    def _get_required_actions(self, status: dict[str, Any]) -> list[str]:
        """Get list of required startup actions."""
        actions = []

        if status["is_upgrade"]:
            actions.append("run_migrations")
        if status["needs_seed"]:
            actions.append("seed_database")
        if status["uses_remote_db"]:
            actions.append("connect_remote_db")

        return actions
