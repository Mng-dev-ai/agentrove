import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import Enum as SQLAlchemyEnum
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.db.migration_helpers import uuid_server_default
from app.db.types import GUID, UTCDateTime, enum_values

from .enums import AttachmentType, MessageRole, MessageStreamStatus


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    session_agent_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    worktree_cwd: Mapped[str | None] = mapped_column(String(512), nullable=True)
    context_token_usage: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    last_event_seq: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    pinned_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_viewed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime(), nullable=True
    )
    parent_chat_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="SET NULL"), nullable=True
    )
    # The last turn's settings — server-side source of truth so out-of-band
    # follow-ups (MCP) and the UI inherit them instead of their own defaults.
    last_model_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_thinking_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_persona_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    user = relationship("User", back_populates="chats")
    workspace = relationship("Workspace", back_populates="chats")
    messages = relationship(
        "Message", back_populates="chat", cascade="all, delete-orphan"
    )
    sub_threads = relationship(
        "Chat",
        back_populates="parent_chat",
        foreign_keys="[Chat.parent_chat_id]",
    )
    parent_chat = relationship(
        "Chat",
        back_populates="sub_threads",
        remote_side="[Chat.id]",
        foreign_keys="[Chat.parent_chat_id]",
    )

    __table_args__ = (
        Index("idx_chats_workspace_id_deleted_at", "workspace_id", "deleted_at"),
        Index("idx_chats_user_id_deleted_at", "user_id", "deleted_at"),
        Index("idx_chats_user_id_updated_at_desc", "user_id", "updated_at"),
        Index("idx_chats_parent_chat_id", "parent_chat_id"),
    )

    @property
    def unread(self) -> bool:
        # Activity since the user last opened the chat — updated_at advances on
        # turn initiation, so out-of-band turns (automations, MCP) flag unread.
        return self.last_viewed_at is None or self.updated_at > self.last_viewed_at

    @property
    def sandbox_id(self) -> str:
        if self.workspace:
            sid: str = self.workspace.sandbox_id
            return sid
        val: str = self._sandbox_id
        return val

    @property
    def workspace_path(self) -> str | None:
        if self.workspace:
            wp: str = self.workspace.workspace_path
            return wp
        val: str | None = getattr(self, "_workspace_path", None)
        return val

    @property
    def sandbox_provider(self) -> str:
        if self.workspace:
            sp: str = self.workspace.sandbox_provider
            return sp
        val: str = self._sandbox_provider
        return val

    @classmethod
    def from_dict(cls, data: dict[str, str | None]) -> "Chat":
        chat = cls(
            id=UUID(str(data["id"])),
            user_id=UUID(str(data["user_id"])),
            title=str(data["title"]),
            workspace_id=UUID(str(data["workspace_id"])),
            session_id=data.get("session_id"),
            session_agent_kind=data.get("session_agent_kind"),
        )
        # Stash sandbox fields for streaming runtime (workspace not loaded from DB)
        sandbox_id = data.get("sandbox_id")
        if sandbox_id is None:
            raise ValueError("Missing sandbox_id in chat data")
        chat._sandbox_id = sandbox_id
        chat._workspace_path = data.get("workspace_path")
        sandbox_provider = data.get("sandbox_provider")
        if sandbox_provider is None:
            # Stream resumes must preserve the original provider instead of
            # silently switching to Docker when the serialized chat is invalid.
            raise ValueError("Missing sandbox_provider in chat data")
        chat._sandbox_provider = sandbox_provider
        chat.worktree_cwd = data.get("worktree_cwd")
        return chat


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    chat_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    content_text: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    content_render: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: {"events": []},
        server_default='{"events": []}',
    )
    last_seq: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    active_stream_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    role: Mapped[MessageRole] = mapped_column(
        SQLAlchemyEnum(
            MessageRole,
            name="messagerole",
            values_callable=enum_values,
        ),
        nullable=False,
    )
    model_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    total_cost_usd: Mapped[float | None] = mapped_column(
        Float, nullable=True, default=0.0, server_default="0.0"
    )
    # Total wall-clock run time, recorded once at the terminal snapshot.
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stream_status: Mapped[MessageStreamStatus] = mapped_column(
        SQLAlchemyEnum(
            MessageStreamStatus,
            name="messagestreamstatus",
            values_callable=enum_values,
        ),
        nullable=False,
        default=MessageStreamStatus.IN_PROGRESS,
        server_default="in_progress",
    )
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    chat = relationship("Chat", back_populates="messages")
    attachments = relationship(
        "MessageAttachment", back_populates="message", cascade="all, delete-orphan"
    )
    events = relationship(
        "MessageEvent", back_populates="message", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_messages_chat_id_created_at", "chat_id", "created_at"),
        Index("idx_messages_role_created", "role", "created_at"),
        Index("idx_messages_chat_id_deleted_at", "chat_id", "deleted_at"),
        Index("idx_messages_chat_id_role_deleted", "chat_id", "role", "deleted_at"),
    )


class MessageAttachment(Base):
    __tablename__ = "message_attachments"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    message_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_type: Mapped[AttachmentType] = mapped_column(
        SQLAlchemyEnum(
            AttachmentType,
            name="attachmenttype",
            values_callable=enum_values,
        ),
        nullable=False,
        default=AttachmentType.IMAGE,
        server_default="image",
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)

    message = relationship("Message", back_populates="attachments")


class MessageEvent(Base):
    __tablename__ = "message_events"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    message_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    chat_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=False,
    )
    stream_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    render_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    audit_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    message = relationship("Message", back_populates="events")
    chat = relationship("Chat")

    __table_args__ = (
        Index("idx_message_events_message_id_seq", "message_id", "seq"),
        Index("idx_message_events_chat_id_created_at", "chat_id", "created_at"),
        Index(
            "idx_message_events_chat_id_stream_id_seq", "chat_id", "stream_id", "seq"
        ),
        Index("uq_message_events_stream_seq", "stream_id", "seq", unique=True),
    )


class ChatCheckpoint(Base):
    __tablename__ = "chat_checkpoints"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
        server_default=uuid_server_default(),
    )
    chat_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    assistant_message_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    cwd: Mapped[str | None] = mapped_column(String(512), nullable=True)
    base_head: Mapped[str] = mapped_column(String(64), nullable=False)
    pre_run_diff: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )

    __table_args__ = (
        Index(
            "idx_chat_checkpoints_assistant_message_id",
            "assistant_message_id",
            unique=True,
        ),
        Index("idx_chat_checkpoints_chat_id_created_at", "chat_id", "created_at"),
    )
