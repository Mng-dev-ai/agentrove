from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base, PG_GEN_UUID
from app.db.types import GUID


class BankAccount(Base):
    """Company bank accounts for receiving payments."""
    __tablename__ = "bank_accounts"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(128), nullable=False)
    account_holder: Mapped[str] = mapped_column(String(128), nullable=False)
    iban: Mapped[str] = mapped_column(String(34), nullable=False)
    account_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    routing_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    swift_bic: Mapped[str | None] = mapped_column(String(11), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
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


class PaymentNotification(Base):
    """Payment notifications submitted by customers."""
    __tablename__ = "payment_notifications"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    customer_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    invoice_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True
    )
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    payment_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False)
    sender_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sender_bank: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    receipt_file_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    receipt_file_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), default="pending", nullable=False
    )  # pending, verified, rejected
    ticket_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True
    )
    verified_by: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class ProjectRequest(Base):
    """Project requests from customers."""
    __tablename__ = "project_requests"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        server_default=PG_GEN_UUID,
    )
    customer_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    budget: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    budget_range: Mapped[str | None] = mapped_column(String(64), nullable=True)
    topics: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of topics
    desired_start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    desired_end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachments: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of file info
    attachment_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    attachment_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), default="pending", nullable=False
    )  # pending, reviewing, approved, rejected, converted
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    ticket_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True
    )
    project_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
