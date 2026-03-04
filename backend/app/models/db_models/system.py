from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, String, Text, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base, PG_GEN_UUID
from app.db.types import EncryptedString


class SystemSettings(Base):
    """Global system settings - single row table for admin configuration."""

    __tablename__ = "system_settings"

    id: Mapped[UUID] = mapped_column(
        primary_key=True,
        server_default=PG_GEN_UUID,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
    # App version tracking
    app_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Master password for remote database connections
    master_password_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Remote database configuration
    remote_db_url: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    remote_db_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # Instance identification
    instance_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_web_master: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # Connection settings
    allow_remote_connections: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # SMTP settings
    smtp_host: Mapped[str | None] = mapped_column(String(256), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smtp_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    smtp_from_email: Mapped[str | None] = mapped_column(String(256), nullable=True)
    smtp_from_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    smtp_use_tls: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    smtp_use_ssl: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    smtp_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
