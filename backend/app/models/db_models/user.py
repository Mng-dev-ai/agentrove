import uuid
from datetime import datetime
from uuid import UUID

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, ForeignKey, JSON, String, Text
from sqlalchemy.orm import relationship, Mapped, mapped_column

from app.models.types import (
    CustomEnvVarDict,
    PersonaDict,
    StreamActionDict,
)

from app.db.base_class import Base
from app.db.types import GUID, EncryptedString, UTCDateTime


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    email: Mapped[str] = mapped_column(String(length=320), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(length=256), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    is_superuser: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    is_verified: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )

    username: Mapped[str] = mapped_column(
        String(length=64), unique=True, nullable=False
    )
    verification_token: Mapped[str | None] = mapped_column(
        String(length=128), nullable=True
    )
    verification_token_expires: Mapped[datetime | None] = mapped_column(
        UTCDateTime(), nullable=True
    )
    reset_token: Mapped[str | None] = mapped_column(String(length=128), nullable=True)
    reset_token_expires: Mapped[datetime | None] = mapped_column(
        UTCDateTime(), nullable=True
    )
    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")
    workspaces = relationship(
        "Workspace", back_populates="user", cascade="all, delete-orphan"
    )
    settings = relationship(
        "UserSettings",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    refresh_tokens = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    github_personal_access_token: Mapped[str | None] = mapped_column(
        EncryptedString, nullable=True
    )
    custom_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    custom_env_vars: Mapped[list[CustomEnvVarDict] | None] = mapped_column(
        JSON, nullable=True
    )
    personas: Mapped[list[PersonaDict] | None] = mapped_column(JSON, nullable=True)
    stream_actions: Mapped[list[StreamActionDict] | None] = mapped_column(
        JSON, nullable=True
    )
    notifications_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    user = relationship("User", back_populates="settings")
