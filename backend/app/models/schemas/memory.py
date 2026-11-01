from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MemoryScope = Literal["workspace", "global"]


class MemoryScopeTarget(BaseModel):
    scope: MemoryScope | None = None
    workspace_id: UUID | None = None
    chat_id: UUID | None = None

    @model_validator(mode="after")
    def check_scope_target(self) -> "MemoryScopeTarget":
        if self.workspace_id is not None and self.chat_id is not None:
            raise ValueError("Pass either workspace_id or chat_id, not both")
        if self.scope is None and (
            self.workspace_id is not None or self.chat_id is not None
        ):
            raise ValueError("workspace_id and chat_id require scope")
        if self.scope == "global" and self.workspace_id is not None:
            raise ValueError("Global memories cannot have a workspace_id")
        if (
            self.scope == "workspace"
            and self.workspace_id is None
            and self.chat_id is None
        ):
            raise ValueError("Workspace scope requires workspace_id or chat_id")
        return self


class MemoryCreate(MemoryScopeTarget):
    title: str = Field(..., min_length=1, max_length=80, pattern=r"^[^\r\n]+$")
    content: str = Field(..., min_length=1, max_length=500)
    pinned: bool = False
    scope: MemoryScope


class MemoryUpdate(MemoryScopeTarget):
    title: str | None = Field(None, min_length=1, max_length=80, pattern=r"^[^\r\n]+$")
    content: str | None = Field(None, min_length=1, max_length=500)
    pinned: bool | None = None

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
