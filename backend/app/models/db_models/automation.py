import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.migration_helpers import uuid_server_default
from app.db.types import GUID, UTCDateTime


class Automation(Base):
    __tablename__ = "automations"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=uuid_server_default(),
    )
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    permission_mode: Mapped[str] = mapped_column(
        String(32),
        default="bypassPermissions",
        server_default="bypassPermissions",
        nullable=False,
    )
    thinking_mode: Mapped[str | None] = mapped_column(String(50), nullable=True)
    worktree: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    selected_persona_name: Mapped[str] = mapped_column(
        String(100), default="Default", server_default="Default", nullable=False
    )
    cron_expression: Mapped[str] = mapped_column(String(128), nullable=False)
    # IANA zone for cron so "daily at 9am" follows user local time/DST.
    timezone: Mapped[str] = mapped_column(
        String(64), default="UTC", server_default="UTC", nullable=False
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    # Stored in UTC; the dispatch job fires rows where next_run_at <= now.
    next_run_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    __table_args__ = (
        Index("idx_automations_user_id", "user_id"),
        Index("idx_automations_enabled_next_run_at", "enabled", "next_run_at"),
    )
