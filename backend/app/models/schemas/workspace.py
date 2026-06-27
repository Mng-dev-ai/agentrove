from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.services.sandbox_providers.types import SandboxProviderType


class CustomSkill(BaseModel):
    name: str
    description: str
    size_bytes: int
    file_count: int
    sources: list[str]
    read_only: bool


class BuiltinSlashCommand(BaseModel):
    value: str
    label: str
    description: str


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    source_type: Literal["git", "local", "empty"] = "empty"
    workspace_path: str | None = Field(None, max_length=2048)
    git_url: str | None = Field(None, max_length=2048)
    sandbox_provider: SandboxProviderType


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)


class Workspace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    user_id: UUID
    sandbox_id: str
    sandbox_provider: SandboxProviderType
    workspace_path: str
    source_type: str | None = None
    source_url: str | None = None
    created_at: datetime
    updated_at: datetime
    chat_count: int = 0
    last_chat_at: datetime | None = None


class WorkspaceResources(BaseModel):
    skills: list[CustomSkill] = Field(default_factory=list)
    # Keyed by agent kind ("claude", "codex")
    builtin_slash_commands: dict[str, list[BuiltinSlashCommand]] = Field(
        default_factory=dict
    )
