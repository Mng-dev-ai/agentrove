import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash, verify_password
from app.models.db_models.system import SystemSettings

logger = logging.getLogger(__name__)


class SystemService:
    """Service for managing global system settings."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_settings(self) -> SystemSettings:
        """Get or create system settings (single row)."""
        result = await self.session.execute(select(SystemSettings))
        settings = result.scalar_one_or_none()

        if not settings:
            settings = SystemSettings()
            self.session.add(settings)
            await self.session.commit()
            await self.session.refresh(settings)

        return settings

    async def set_master_password(self, password: str) -> SystemSettings:
        """Set the master password for remote database connections."""
        settings = await self.get_settings()
        settings.master_password_hash = get_password_hash(password)
        await self.session.commit()
        await self.session.refresh(settings)
        return settings

    async def verify_master_password(self, password: str) -> bool:
        """Verify the master password."""
        settings = await self.get_settings()
        if not settings.master_password_hash:
            return False
        return verify_password(password, settings.master_password_hash)

    async def configure_remote_db(
        self,
        db_url: str,
        enabled: bool = True,
        master_password: str | None = None,
    ) -> SystemSettings:
        """Configure remote database connection."""
        settings = await self.get_settings()

        # Verify master password if setting up remote connection
        if enabled and master_password:
            if not await self.verify_master_password(master_password):
                raise ValueError("Invalid master password")

        settings.remote_db_url = db_url
        settings.remote_db_enabled = enabled
        await self.session.commit()
        await self.session.refresh(settings)
        return settings

    async def set_instance_config(
        self,
        instance_name: str | None = None,
        is_web_master: bool = False,
        allow_remote_connections: bool = False,
    ) -> SystemSettings:
        """Configure instance as web master or local client."""
        settings = await self.get_settings()

        if instance_name is not None:
            settings.instance_name = instance_name
        settings.is_web_master = is_web_master
        settings.allow_remote_connections = allow_remote_connections

        await self.session.commit()
        await self.session.refresh(settings)
        return settings

    async def get_status(self) -> dict[str, Any]:
        """Get system status for display."""
        settings = await self.get_settings()
        return {
            "has_master_password": settings.master_password_hash is not None,
            "remote_db_enabled": settings.remote_db_enabled,
            "has_remote_db_url": settings.remote_db_url is not None,
            "instance_name": settings.instance_name,
            "is_web_master": settings.is_web_master,
            "allow_remote_connections": settings.allow_remote_connections,
        }

    async def disable_remote_db(self) -> SystemSettings:
        """Disable remote database connection."""
        settings = await self.get_settings()
        settings.remote_db_enabled = False
        await self.session.commit()
        await self.session.refresh(settings)
        return settings
