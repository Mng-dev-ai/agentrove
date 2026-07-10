from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from croniter import croniter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME


def validate_cron_expression(value: str) -> str:
    if not croniter.is_valid(value):
        raise ValueError("Invalid cron expression")
    return value


def validate_timezone_name(value: str) -> str:
    try:
        ZoneInfo(value)
    except (KeyError, ValueError) as e:
        raise ValueError("Unknown timezone") from e
    return value


class AutomationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    prompt: str = Field(..., min_length=1, max_length=100000)
    model_id: str = Field(..., min_length=1, max_length=255)
    cron_expression: str = Field(..., min_length=1, max_length=128)
    timezone: str = Field("UTC", min_length=1, max_length=64)
    permission_mode: PermissionMode = "bypassPermissions"
    thinking_mode: str | None = Field(None, max_length=50)
    worktree: bool = False
    selected_persona_name: str = Field(DEFAULT_PERSONA_NAME, max_length=100)
    enabled: bool = True

    @field_validator("cron_expression")
    @classmethod
    def check_cron_expression(cls, value: str) -> str:
        return validate_cron_expression(value)

    @field_validator("timezone")
    @classmethod
    def check_timezone(cls, value: str) -> str:
        return validate_timezone_name(value)


class AutomationCreate(AutomationBase):
    workspace_id: UUID


class AutomationUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    prompt: str | None = Field(None, min_length=1, max_length=100000)
    model_id: str | None = Field(None, min_length=1, max_length=255)
    workspace_id: UUID | None = None
    cron_expression: str | None = Field(None, min_length=1, max_length=128)
    timezone: str | None = Field(None, min_length=1, max_length=64)
    permission_mode: PermissionMode | None = None
    thinking_mode: str | None = Field(None, max_length=50)
    worktree: bool | None = None
    selected_persona_name: str | None = Field(None, min_length=1, max_length=100)
    enabled: bool | None = None

    @field_validator("cron_expression")
    @classmethod
    def check_cron_expression(cls, value: str | None) -> str | None:
        return None if value is None else validate_cron_expression(value)

    @field_validator("timezone")
    @classmethod
    def check_timezone(cls, value: str | None) -> str | None:
        return None if value is None else validate_timezone_name(value)


class Automation(BaseModel):
    # Standalone read model (not AutomationBase) so responses skip the input
    # validators and stored rows survive later write-rule drift — mirrors the
    # Workspace schema pattern.
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    workspace_id: UUID
    name: str
    prompt: str
    model_id: str
    cron_expression: str
    timezone: str
    permission_mode: str
    thinking_mode: str | None = None
    worktree: bool
    selected_persona_name: str
    enabled: bool
    next_run_at: datetime
    last_run_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AutomationRunResponse(BaseModel):
    chat_id: UUID
