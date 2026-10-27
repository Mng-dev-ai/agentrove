import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum as SQLAlchemyEnum
from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.migration_helpers import uuid_server_default
from app.db.types import GUID, UTCDateTime, enum_values
from app.models.db_models.enums import SubThreadReportStatus


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
    status: Mapped[SubThreadReportStatus] = mapped_column(
        SQLAlchemyEnum(
            SubThreadReportStatus,
            name="subthreadreportstatus",
            values_callable=enum_values,
        ),
        nullable=False,
        default=SubThreadReportStatus.RUNNING,
        server_default=SubThreadReportStatus.RUNNING.value,
    )
    # MessageStreamStatus value of the child turn; null while it is running.
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Earliest time the dispatcher may wake the parent for a pending row.
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime(), nullable=True
    )
    attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    # The parent message carrying the report: the wake turn while waking or
    # covered, and the delivering message once acknowledged or notified.
    wake_message_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("idx_subthread_reports_parent_status", "parent_chat_id", "status"),
        Index("idx_subthread_reports_wake_message_id", "wake_message_id"),
    )
