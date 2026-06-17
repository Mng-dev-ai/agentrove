from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.prompts.system_prompt import DEFAULT_PERSONA_NAME


class CustomEnvVar(BaseModel):
    key: str
    value: str


class Persona(BaseModel):
    name: str
    content: str


# A post-stream action button: runs `command` on `model_id` in a new sub-thread.
class StreamAction(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    enabled: bool = True
    model_id: str = Field(min_length=1, max_length=200)
    command: str = Field(min_length=1, max_length=4000)
    persona_name: str = Field(default=DEFAULT_PERSONA_NAME, max_length=100)
    permission_mode: str = Field(default="bypassPermissions", max_length=50)
    thinking_mode: str = Field(default="high", max_length=50)


class UserSettingsBase(BaseModel):
    github_personal_access_token: str | None = None
    custom_instructions: str | None = None
    custom_env_vars: list[CustomEnvVar] | None = None
    personas: list[Persona] | None = None
    stream_actions: list[StreamAction] | None = None
    notifications_enabled: bool = True

    @field_validator(
        "custom_env_vars",
        "personas",
        "stream_actions",
        mode="before",
    )
    @classmethod
    def _normalize_json_lists(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            return []
        raise ValueError(f"Expected list or None, got {type(value).__name__}")


class UserSettingsResponse(UserSettingsBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
