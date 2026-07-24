from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.utils.sandbox import is_valid_base_ref


class QueuedMessageBase(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)
    model_id: str = Field(..., min_length=1, max_length=255)
    permission_mode: PermissionMode = "bypassPermissions"
    thinking_mode: str | None = None
    worktree: bool = False
    base_branch: str | None = None
    fast_mode: bool = False
    selected_persona_name: str = DEFAULT_PERSONA_NAME

    @field_validator("base_branch")
    @classmethod
    def validate_base_branch(cls, base_branch: str | None) -> str | None:
        if base_branch is None:
            return None
        base_branch = base_branch.strip()
        if not base_branch:
            return None
        if not is_valid_base_ref(base_branch):
            raise ValueError("Invalid base branch name")
        return base_branch


class QueueMessageUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)


class QueuedMessage(QueuedMessageBase):
    id: UUID
    queued_at: datetime
    attachments: list[dict[str, Any]] | None = None


class QueueAddResponse(BaseModel):
    id: UUID
    queued_at: datetime
