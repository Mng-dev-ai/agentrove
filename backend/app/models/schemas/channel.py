from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.constants import MODELS


class ChannelMemberCreate(BaseModel):
    model_id: str
    persona: str | None = Field(None, max_length=100)
    thinking_mode: str | None = Field(None, max_length=50)

    @field_validator("model_id")
    @classmethod
    def valid_model(cls, value: str) -> str:
        if value not in MODELS:
            raise ValueError("Unknown model_id")
        return value


class ChannelCreate(BaseModel):
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=255)
    members: list[ChannelMemberCreate] = Field(min_length=1)


class ChannelMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    model_id: str
    persona: str | None
    thinking_mode: str | None
    display_name: str


class ChannelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    workspace_id: UUID
    name: str
    created_at: datetime
    updated_at: datetime
    members: list[ChannelMemberRead]


class ChannelMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=100000)


class ChannelMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    seq: int
    version: int
    member_id: UUID | None
    content: str
    status: Literal["streaming", "completed", "cancelled", "deleted"]
    created_at: datetime

    @computed_field
    def author_type(self) -> Literal["user", "agent"]:
        return "user" if self.member_id is None else "agent"
