import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.migration_helpers import uuid_server_default
from app.db.types import GUID, UTCDateTime


class SubThreadReport(Base):
    """A delegated sub-thread run the parent chat still owes the user a report on."""

    __tablename__ = "subthread_reports"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=uuid_server_default(),
    )
    parent_chat_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    child_chat_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    # The delegated turn's assistant message; one report per delegated run.
    child_message_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # MessageStreamStatus value of the child turn; null while it is running.
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    # Earliest time the dispatcher may wake the parent for this row.
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime(), nullable=True
    )
    attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    # The parent turn composing the report; cleared if that turn does not deliver.
    wake_message_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    # The parent named this run as covered by its current wake turn.
    covered_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    # Set only once the wake turn completed with a reply covering this run.
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime(), nullable=True
    )

    __table_args__ = (
        Index("idx_subthread_reports_parent_chat_id", "parent_chat_id"),
        Index("idx_subthread_reports_wake_message_id", "wake_message_id"),
        Index("idx_subthread_reports_next_attempt_at", "next_attempt_at"),
    )
