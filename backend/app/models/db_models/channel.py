import uuid
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.db.types import GUID


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    members: Mapped[list["ChannelMember"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )


class ChannelMember(Base):
    __tablename__ = "channel_members"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    chat_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="CASCADE"), unique=True
    )
    model_id: Mapped[str] = mapped_column(String(128))
    persona: Mapped[str | None] = mapped_column(String(100))
    thinking_mode: Mapped[str | None] = mapped_column(String(50))
    display_name: Mapped[str] = mapped_column(String(255))
    introduced: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")


class ChannelMessage(Base):
    __tablename__ = "channel_messages"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("channels.id", ondelete="CASCADE")
    )
    seq: Mapped[int] = mapped_column(Integer)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    member_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("channel_members.id", ondelete="CASCADE")
    )
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10))

    __table_args__ = (
        UniqueConstraint("channel_id", "seq", name="uq_channel_messages_channel_seq"),
        CheckConstraint(
            "status IN ('streaming', 'completed', 'cancelled', 'deleted')",
            name="ck_channel_message_status",
        ),
    )


class ChannelDelivery(Base):
    __tablename__ = "channel_deliveries"

    member_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("channel_members.id", ondelete="CASCADE"), primary_key=True
    )
    message_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("channel_messages.id", ondelete="CASCADE"), primary_key=True
    )
