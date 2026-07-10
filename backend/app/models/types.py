from typing import Literal, TypeAlias, TypedDict

PermissionMode: TypeAlias = Literal[
    "default",
    "acceptEdits",
    "plan",
    "build",
    "bypassPermissions",
    "agent",
    "autopilot",
    "auto",
    "code",
    "read-only",
    "full-access",
    "ask",
]


class CustomEnvVarDict(TypedDict):
    key: str
    value: str


class CustomSkillDict(TypedDict):
    name: str
    description: str
    size_bytes: int
    file_count: int
    # Agent kinds whose scan dirs resolve to this skill's directory; overlapping
    # namespaces mean one on-disk skill can belong to several kinds.
    sources: list[str]
    read_only: bool


class PersonaDict(TypedDict):
    name: str
    content: str


class StreamActionDict(TypedDict):
    label: str
    enabled: bool
    model_id: str
    command: str
    persona_name: str
    permission_mode: str
    thinking_mode: str


class MessageAttachmentDict(TypedDict):
    file_url: str
    file_path: str | None
    file_type: str
    filename: str | None


class ChatCompletionResult(TypedDict):
    message_id: str
    chat_id: str
    last_seq: int
    checkpoint_id: str | None
    worktree_cwd: str | None


class YamlMetadata(TypedDict, total=False):
    description: str


class EnabledResourceInfo(TypedDict):
    name: str
    path: str
