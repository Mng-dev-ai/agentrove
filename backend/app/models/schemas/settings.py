from datetime import datetime
from enum import Enum
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator

from app.models.types import JSONList
from app.utils.validators import normalize_json_list


class ProviderType(str, Enum):
    ANTHROPIC = "anthropic"
    OPENROUTER = "openrouter"
    OPENAI = "openai"
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


class CustomAgent(BaseModel):
    name: str = Field(..., description="Unique identifier/slug for the agent")
    description: str = Field(..., description="What the agent does")
    content: str = Field(..., description="Markdown content (the prompt)")
    enabled: bool = True
    model: Literal["sonnet", "opus", "haiku", "inherit"] = "inherit"
    allowed_tools: list[str] | None = Field(
        None, description="List of allowed tools for this agent"
    )


class CustomMcp(BaseModel):
    name: str = Field(..., description="Unique identifier for the MCP server")
    description: str = Field(..., description="What this MCP does")
    command_type: Literal["npx", "bunx", "uvx", "http"] = Field(
        ..., description="Type of MCP server"
    )
    package: str | None = Field(
        None,
        description="Package name for npx/bunx/uvx MCPs (e.g., '@netlify/mcp', 'mcp-server-git')",
    )
    url: str | None = Field(None, description="HTTP endpoint URL")
    env_vars: dict[str, str] | None = Field(None, description="Environment variables")
    args: list[str] | None = Field(None, description="Additional command arguments")
    enabled: bool = True


class CustomEnvVar(BaseModel):
    key: str = Field(
        ..., description="Environment variable name (e.g., OPENAI_API_KEY)"
    )
    value: str = Field(..., description="Environment variable value")


class CustomSkill(BaseModel):
    name: str = Field(..., description="Unique identifier/slug for the skill")
    description: str = Field(..., description="What the skill does")
    enabled: bool = True
    size_bytes: int = Field(..., description="Total size of skill files in bytes")
    file_count: int = Field(..., description="Number of files in skill")


class CustomSlashCommand(BaseModel):
    name: str = Field(..., description="Command name (without /)")
    description: str = Field(..., description="Brief overview of what the command does")
    content: str = Field(..., description="Markdown content (the prompt)")
    enabled: bool = True
    argument_hint: str | None = Field(
        None, description="e.g., '<pr-number> [priority]'"
    )
    allowed_tools: list[str] | None = Field(None, description="List of allowed tools")
    model: (
        Literal[
            "claude-sonnet-4-5-20250929",
            "claude-opus-4-5-20251101",
            "claude-haiku-4-5-20251001",
        ]
        | None
    ) = Field(None, description="Model override")


class CustomPrompt(BaseModel):
    name: str = Field(..., description="Unique name for the prompt")
    content: str = Field(..., description="The system prompt content")


class InstalledPluginSchema(BaseModel):
    name: str = Field(..., description="Plugin name")
    version: str | None = None
    installed_at: str = Field(..., description="ISO timestamp when installed")
    components: list[str] = Field(
        default_factory=list, description="Installed components (type:name)"
    )


class UserSettingsBase(BaseModel):
    github_personal_access_token: str | None = None
    e2b_api_key: str | None = None
    modal_api_key: str | None = None
    sandbox_provider: Literal["docker", "e2b", "modal"] = "docker"
    custom_instructions: str | None = Field(default=None, max_length=1500)
    custom_providers: list[CustomProvider] | None = None
    custom_agents: list[CustomAgent] | None = None
    custom_mcps: list[CustomMcp] | None = None
    custom_env_vars: list[CustomEnvVar] | None = None
    custom_skills: list[CustomSkill] | None = None
    custom_slash_commands: list[CustomSlashCommand] | None = None
    custom_prompts: list[CustomPrompt] | None = None
    installed_plugins: list[InstalledPluginSchema] | None = None
    notification_sound_enabled: bool = True
    auto_compact_disabled: bool = False
    attribution_disabled: bool = False

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
    def _normalize_json_lists(cls, value: JSONList | None) -> JSONList | None:
        if value is None:
            return None
        return normalize_json_list(value)


class UserSettingsResponse(UserSettingsBase):
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
