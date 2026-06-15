import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.db.types import GUID, UTCDateTime
from app.services.sandbox_providers.types import SandboxProviderType


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    sandbox_id: Mapped[str] = mapped_column(String(128), nullable=False)
    sandbox_provider: Mapped[str] = mapped_column(
        String(32),
        default=SandboxProviderType.DOCKER.value,
        server_default=SandboxProviderType.DOCKER.value,
        nullable=False,
    )
    workspace_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    source_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    user = relationship("User", back_populates="workspaces")
    chats = relationship("Chat", back_populates="workspace")

    __table_args__ = (
        Index("idx_workspaces_user_id_deleted_at", "user_id", "deleted_at"),
    )
