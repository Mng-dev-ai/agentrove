import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.migration_helpers import uuid_server_default
from app.db.types import GUID, UTCDateTime


class InboxItem(Base):
    __tablename__ = "inbox_items"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=uuid_server_default(),
    )
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    chat_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    __table_args__ = (
        Index("idx_inbox_items_user_id_created_at", "user_id", "created_at"),
    )
