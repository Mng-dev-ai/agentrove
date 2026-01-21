from typing import Literal, TypedDict


class BaseResourceDict(TypedDict, total=False):
    name: str
    description: str
    content: str
    enabled: bool


class CustomAgentDict(BaseResourceDict, total=False):
    model: Literal["sonnet", "opus", "haiku", "inherit"]
    allowed_tools: list[str] | None


class CustomMcpDict(TypedDict, total=False):
    name: str
    description: str
    command_type: Literal["npx", "bunx", "uvx", "http"]
    package: str | None
    url: str | None
    env_vars: dict[str, str] | None
    args: list[str] | None
    enabled: bool


class CustomEnvVarDict(TypedDict, total=False):
    key: str
    value: str


class CustomSkillDict(TypedDict, total=False):
    name: str
    description: str
    enabled: bool
    size_bytes: int
    file_count: int


class CustomSlashCommandDict(BaseResourceDict, total=False):
    argument_hint: str | None
    allowed_tools: list[str] | None
    model: (
        Literal[
            "claude-sonnet-4-5-20250929",
            "claude-opus-4-5-20251101",
            "claude-haiku-4-5-20251001",
        ]
        | None
    )


class CustomPromptDict(TypedDict, total=False):
    name: str
    content: str


class MessageAttachmentDict(TypedDict, total=False):
    file_url: str
    file_path: str | None
    file_type: str
    filename: str | None


class ChatCompletionResult(TypedDict):
    task_id: str
    message_id: str
    chat_id: str
    status: str


class YamlFrontmatterResult(TypedDict):
    metadata: "YamlMetadata"
    markdown_content: str


class YamlMetadata(TypedDict, total=False):
    name: str
    description: str
    model: str | None
    allowed_tools: list[str] | None
    argument_hint: str | None


class ParsedResourceResult(TypedDict):
    metadata: YamlMetadata
    content: str
    markdown_content: str


class EnabledResourceInfo(TypedDict):
    name: str
    path: str


ExceptionDetails = dict[str, str]


type JSONValue = (
    str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]
)
type JSONDict = dict[str, JSONValue]
type JSONList = list[JSONValue]


class MarketplaceAuthorDict(TypedDict, total=False):
    name: str
    email: str | None
    url: str | None


class MarketplacePluginDict(TypedDict, total=False):
    name: str
    description: str
    category: str
    source: str
    version: str | None
    author: MarketplaceAuthorDict | None
    homepage: str | None
    has_lsp_only: bool


class PluginComponentsDict(TypedDict, total=False):
    agents: list[str]
    commands: list[str]
    skills: list[str]
    mcp_servers: list[str]


class PluginDetailsDict(TypedDict, total=False):
    name: str
    description: str
    category: str
    source: str
    version: str | None
    author: MarketplaceAuthorDict | None
    homepage: str | None
    readme: str | None
    components: PluginComponentsDict


class InstalledPluginDict(TypedDict, total=False):
    name: str
    version: str | None
    installed_at: str
    components: list[str]


class CustomProviderModelDict(TypedDict, total=False):
    model_id: str
    name: str
    enabled: bool


class CustomProviderDict(TypedDict, total=False):
    id: str
    name: str
    provider_type: Literal["anthropic", "openrouter", "openai", "custom"]
    base_url: str | None
    auth_token: str | None
    enabled: bool
    models: list[CustomProviderModelDict]
