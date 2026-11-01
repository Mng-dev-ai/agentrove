from enum import Enum
from typing import Literal, TypeAlias, TypedDict


class AgentKind(str, Enum):
    ANTIGRAVITY = "antigravity"
    CLAUDE = "claude"
    CODEX = "codex"
    COPILOT = "copilot"
    CURSOR = "cursor"
    GROK = "grok"
    OPENCODE = "opencode"


PermissionMode: TypeAlias = Literal[
    "auto_edit",
    "default",
    "acceptEdits",
    "plan",
    "build",
    "bypassPermissions",
    "agent",
    "autopilot",
    "auto",
    "always-approve",
    "read-only",
    "full-access",
    "ask",
    "yolo",
]


class CustomEnvVarDict(TypedDict):
    key: str
    value: str


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


class EnabledResourceInfo(TypedDict):
    name: str
    path: str
