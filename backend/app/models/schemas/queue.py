from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME


class QueuedMessageBase(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)
    model_id: str = Field(..., min_length=1, max_length=255)
    permission_mode: PermissionMode = "bypassPermissions"
    thinking_mode: str | None = None
    worktree: bool = False
    selected_persona_name: str = DEFAULT_PERSONA_NAME


class QueueMessageUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)


class QueuedMessage(QueuedMessageBase):
    id: UUID
    queued_at: datetime
    attachments: list[dict[str, Any]] | None = None


class QueueAddResponse(BaseModel):
    id: UUID
    queued_at: datetime
