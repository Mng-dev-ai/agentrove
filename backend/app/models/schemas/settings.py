from datetime import datetime
from enum import Enum
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProviderType(str, Enum):
    ANTHROPIC = "anthropic"
    OPENROUTER = "openrouter"
    OPENAI = "openai"
    COPILOT = "copilot"
    GLM = "glm"
    A4F = "a4f"
    CUSTOM = "custom"


class CustomProviderModel(BaseModel):
    model_id: str
    name: str
    enabled: bool = True


class CustomProvider(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    provider_type: ProviderType = ProviderType.CUSTOM
    base_url: str | None = None
    auth_token: str | None = None
    enabled: bool = True
    models: list[CustomProviderModel] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_model_ids(self) -> "CustomProvider":
        if self.provider_type == ProviderType.OPENROUTER:
            for model in self.models:
                if not model.model_id.startswith("openrouter/"):
                    model.model_id = f"openrouter/{model.model_id}"
        elif self.provider_type == ProviderType.OPENAI:
            for model in self.models:
                if not model.model_id.startswith("openai/"):
                    model.model_id = f"openai/{model.model_id}"
        elif self.provider_type == ProviderType.COPILOT:
            for model in self.models:
                if not model.model_id.startswith("copilot/"):
                    model.model_id = f"copilot/{model.model_id}"
        # A4F uses its own format: provider-x/model-name - no prefix needed
        return self


class CustomAgent(BaseModel):
    name: str
    description: str
    content: str
    enabled: bool = True
    model: Literal["sonnet", "opus", "haiku", "inherit"] = "inherit"
    allowed_tools: list[str] | None = None


class CustomMcp(BaseModel):
    name: str
    description: str
    command_type: Literal["npx", "bunx", "uvx", "http"]
    package: str | None = None
    url: str | None = None
    env_vars: dict[str, str] | None = None
    args: list[str] | None = None
    enabled: bool = True


class CustomEnvVar(BaseModel):
    key: str
    value: str


class CustomSkill(BaseModel):
    name: str
    description: str
    enabled: bool = True
    size_bytes: int
    file_count: int


class CustomSlashCommand(BaseModel):
    name: str
    description: str
    content: str
    enabled: bool = True
    argument_hint: str | None = None
    allowed_tools: list[str] | None = None
    model: (
        Literal[
            "claude-sonnet-4-5-20250929",
            "claude-opus-4-5-20251101",
            "claude-haiku-4-5-20251001",
        ]
        | None
    ) = None


class CustomPrompt(BaseModel):
    name: str
    content: str


class InstalledPluginSchema(BaseModel):
    name: str
    version: str | None = None
    installed_at: str
    components: list[str] = Field(default_factory=list)


class UserSettingsBase(BaseModel):
    github_personal_access_token: str | None = None
    sandbox_provider: Literal["docker", "host"] = "docker"
    timezone: str = Field(default="UTC", max_length=64)
    custom_instructions: str | None = Field(default=None, max_length=1500)
    custom_providers: list[CustomProvider] | None = None
    custom_agents: list[CustomAgent] | None = None
    custom_mcps: list[CustomMcp] | None = None
    custom_env_vars: list[CustomEnvVar] | None = None
    custom_skills: list[CustomSkill] | None = None
    custom_slash_commands: list[CustomSlashCommand] | None = None
    custom_prompts: list[CustomPrompt] | None = None
    installed_plugins: list[InstalledPluginSchema] | None = None
    notifications_enabled: bool = True
    auto_compact_disabled: bool = False
    attribution_disabled: bool = False
    enterprise_mode: bool = False

    @field_validator(
        "custom_providers",
        "custom_agents",
        "custom_mcps",
        "custom_env_vars",
        "custom_skills",
        "custom_slash_commands",
        "custom_prompts",
        "installed_plugins",
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

    @field_validator("timezone")
    @classmethod
    def _validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Invalid timezone: {value}") from exc
        return value


class UserSettingsResponse(UserSettingsBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
