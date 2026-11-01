from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MemoryCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=80, pattern=r"^[^\r\n]+$")
    content: str = Field(..., min_length=1, max_length=500)
    pinned: bool = False
    workspace_id: UUID | None = None
    chat_id: UUID | None = None


class MemoryUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=80, pattern=r"^[^\r\n]+$")
    content: str | None = Field(None, min_length=1, max_length=500)
    pinned: bool | None = None
    workspace_id: UUID | None = None
    chat_id: UUID | None = None

    @field_validator("title", "content", "pinned", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Field cannot be null")
        return value


class Memory(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID | None = None
    title: str
    content: str
    pinned: bool
    source_chat_id: UUID | None = None
    source_model_id: str | None = None
    created_at: datetime
    updated_at: datetime
