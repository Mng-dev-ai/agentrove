from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Integer, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.db.base_class import Base, PG_GEN_UUID
from app.db.types import GUID


class TicketType(str, enum.Enum):
    ADMIN = "admin"  # Admin-only tickets
    MANAGER = "manager"  # Manager and above
    DEPARTMENT = "department"  # Department-specific
    GENERAL = "general"  # All users including customers


class TicketPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"
    CRITICAL = "critical"


class TicketStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING = "waiting"  # Waiting for customer/response
    RESOLVED = "resolved"
    CLOSED = "closed"


class TicketCategory(Base):
    __tablename__ = "ticket_categories"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ticket_type: Mapped[TicketType] = mapped_column(
        SQLEnum(TicketType), default=TicketType.GENERAL, nullable=False
    )
    department_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    ticket_number: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    ticket_type: Mapped[TicketType] = mapped_column(
        SQLEnum(TicketType), default=TicketType.GENERAL, nullable=False
    )
    priority: Mapped[TicketPriority] = mapped_column(
        SQLEnum(TicketPriority), default=TicketPriority.MEDIUM, nullable=False
    )
    status: Mapped[TicketStatus] = mapped_column(
        SQLEnum(TicketStatus), default=TicketStatus.OPEN, nullable=False
    )
    category_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("ticket_categories.id", ondelete="SET NULL"), nullable=True
    )
    department_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    project_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    requester_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    assignee_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    team_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True
    )
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_private: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    comments = relationship("TicketComment", back_populates="ticket", cascade="all, delete-orphan")
    attachments = relationship("TicketAttachment", back_populates="ticket", cascade="all, delete-orphan")


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    ticket_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_internal: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    ticket = relationship("Ticket", back_populates="comments")


class TicketAttachment(Base):
    __tablename__ = "ticket_attachments"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    ticket_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False
    )
    uploaded_by: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    filepath: Mapped[str] = mapped_column(String(512), nullable=False)
    filesize: Mapped[int] = mapped_column(Integer, nullable=False)
    mimetype: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    ticket = relationship("Ticket", back_populates="attachments")


class TicketStatusHistory(Base):
    __tablename__ = "ticket_status_history"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    ticket_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False
    )
    changed_by: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    old_status: Mapped[TicketStatus] = mapped_column(SQLEnum(TicketStatus), nullable=False)
    new_status: Mapped[TicketStatus] = mapped_column(SQLEnum(TicketStatus), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
