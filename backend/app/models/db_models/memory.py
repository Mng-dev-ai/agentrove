import uuid
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.migration_helpers import uuid_server_default
from app.db.types import GUID


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=uuid_server_default(),
    )
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    pinned: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    source_chat_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="SET NULL"), nullable=True
    )
    source_model_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        Index("idx_memories_user_id_workspace_id", "user_id", "workspace_id"),
    )
