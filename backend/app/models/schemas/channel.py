import re
from datetime import datetime
from typing import Literal, get_args
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.constants import MODELS
from app.models.schemas.chat import MessageAttachment
from app.models.types import PermissionMode
from app.utils.sandbox import BaseBranch


class ChannelMemberCreate(BaseModel):
    model_id: str
    display_name: str | None = None
    permission_mode: PermissionMode | None = None
    persona: str | None = Field(None, max_length=100)
    thinking_mode: str | None = Field(None, max_length=50)

    @field_validator("display_name")
    @classmethod
    def valid_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,31}", value) is None:
            raise ValueError(
                "Display name must be 1–32 characters, start with a letter or digit, "
                "and contain only letters, digits, dots, underscores, or hyphens"
            )
        return value

    @field_validator("permission_mode", mode="before")
    @classmethod
    def valid_permission_mode(cls, value: object) -> object:
        if value is not None and value not in get_args(PermissionMode):
            raise HTTPException(400, "Invalid permission mode")
        return value

    @field_validator("model_id")
    @classmethod
    def valid_model(cls, value: str) -> str:
        if value not in MODELS:
            raise ValueError("Unknown model_id")
        return value


class ChannelCreate(BaseModel):
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=255)
    worktree: bool = False
    branch: BaseBranch = None
    members: list[ChannelMemberCreate] = Field(min_length=1)


class ChannelUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ChannelMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    chat_id: UUID
    permission_mode: PermissionMode
    model_id: str
    persona: str | None
    thinking_mode: str | None
    display_name: str


class ChannelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    workspace_id: UUID
    name: str
    worktree: bool
    branch: str | None
    created_at: datetime
    updated_at: datetime
    members: list[ChannelMemberRead]


class ChannelMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    seq: int
    version: int
    member_id: UUID | None
    content: str
    attachments: list[MessageAttachment]
    status: Literal["streaming", "completed", "cancelled", "deleted"]
    created_at: datetime

    @computed_field
    def author_type(self) -> Literal["user", "agent"]:
        return "user" if self.member_id is None else "agent"
