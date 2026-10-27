from typing import Final, NamedTuple

from app.core.config import get_settings
from app.models.types import AgentKind

settings = get_settings()


class ModelInfo(NamedTuple):
    display_name: str
    agent_kind: AgentKind
    context_window: int | None
    legacy: bool = False
    # Effort tiers the model accepts (OpenCode's from models.dev
    # `reasoning_options`); empty = no effort dial.
    effort_levels: tuple[str, ...] = ()


REDIS_KEY_USER_STREAMS_LIVE: Final[str] = "user:{user_id}:streams:live"
REDIS_KEY_USER_CHATS_LIVE: Final[str] = "user:{user_id}:chats:live"
REDIS_KEY_USER_SETTINGS: Final[str] = "user_settings:{user_id}"
REDIS_KEY_CHAT_CONTEXT_USAGE: Final[str] = "chat:{chat_id}:context_usage"
REDIS_KEY_CHAT_QUEUE: Final[str] = "chat:{queue_id}:queue"
REDIS_KEY_CHANNEL_QUEUE: Final[str] = "channel:{queue_id}:queue"
REDIS_KEY_CHAT_QUEUE_SEND_NOW: Final[str] = "chat:{chat_id}:queue:send_now"

QUEUE_MESSAGE_TTL_SECONDS: Final[int] = 3600

# JSON-RPC code ACP agents return from load_session for an unknown session.
ACP_RESOURCE_NOT_FOUND: Final[int] = -32002

# Default model for chat title generation — cheap and fast; user-overridable in settings.
DEFAULT_TITLE_MODEL_ID: Final[str] = "haiku"

SANDBOX_DEFAULT_COMMAND_TIMEOUT: Final[int] = 120
PTY_OUTPUT_QUEUE_SIZE: Final[int] = 512
PTY_INPUT_QUEUE_SIZE: Final[int] = 1024

SANDBOX_SYSTEM_VARIABLES: Final[list[str]] = [
    "SHELL",
    "PWD",
    "LOGNAME",
    "HOME",
    "USER",
    "SHLVL",
    "PS1",
    "PATH",
    "_",
    "NVM_DIR",
    "NODE_VERSION",
    "TERM",
]

SANDBOX_BINARY_EXTENSIONS: Final[set[str]] = {
    "exe",
    "dll",
    "so",
    "dylib",
    "a",
    "lib",
    "obj",
    "o",
    "zip",
    "tar",
    "gz",
    "bz2",
    "xz",
    "7z",
    "rar",
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "ico",
    "tiff",
    "webp",
    "svg",
    "mp4",
    "avi",
    "mkv",
    "mov",
    "wmv",
    "flv",
    "webm",
    "mp3",
    "wav",
    "flac",
    "ogg",
    "wma",
    "aac",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "bin",
    "dat",
    "db",
    "sqlite",
    "sqlite3",
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
    "class",
    "jar",
    "war",
    "ear",
    "pyc",
    "pyo",
    "pyd",
}

SANDBOX_HOME_DIR: Final[str] = "/home/user"
SANDBOX_WORKSPACE_DIR: Final[str] = "/home/user/workspace"
SANDBOX_CLAUDE_JSON_PATH: Final[str] = "/home/user/.claude.json"
SANDBOX_GIT_ASKPASS_PATH: Final[str] = "/home/user/.git-askpass.sh"

WS_MSG_AUTH: Final[str] = "auth"
WS_MSG_INIT: Final[str] = "init"
WS_MSG_RESIZE: Final[str] = "resize"
WS_MSG_CLOSE: Final[str] = "close"
WS_MSG_PING: Final[str] = "ping"
WS_MSG_DETACH: Final[str] = "detach"
WS_MSG_REFRESH: Final[str] = "refresh"

WS_CLOSE_AUTH_FAILED: Final[int] = 4001
WS_CLOSE_SANDBOX_NOT_FOUND: Final[int] = 4004
WS_CLOSE_INVALID_CWD: Final[int] = 4005

TERMINAL_TYPE: Final[str] = "xterm-256color"
DEFAULT_PTY_ROWS: Final[int] = 24
DEFAULT_PTY_COLS: Final[int] = 80
DEFAULT_TERMINAL_ID: Final[str] = "terminal-1"
DOCKER_STATUS_RUNNING: Final[str] = "running"

SANDBOX_BASHRC_PATH: Final[str] = "/home/user/.bashrc"


MODELS: dict[str, ModelInfo] = {
    "sonnet": ModelInfo(
        "Sonnet",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "claude-sonnet-5-5": ModelInfo(
        "Sonnet 5.5",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "haiku": ModelInfo("Haiku", AgentKind.CLAUDE, 200_000),
    "claude-haiku-5-5": ModelInfo(
        "Haiku 5.5",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-fable-5-1": ModelInfo(
        "Fable 5.1",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-fable-5": ModelInfo(
        "Fable 5",
        AgentKind.CLAUDE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-opus-5-5": ModelInfo(
        "Opus 5.5",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-opus-5": ModelInfo(
        "Opus 5",
        AgentKind.CLAUDE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    # Codex CLI clamps model_context_window to its bundled catalog max — 272k for
    # these slugs — then sessions report ~95% of the resolved window (e.g. 258,400).
    # gpt-5.4's catalog max is 1M via config opt-in; raise it here once a live
    # session verifies the opt-in survives our app-server launch path.
    # Live-reported window still wins over these fallbacks.
    "gpt-6.1-sol": ModelInfo(
        "GPT 6.1 Sol",
        AgentKind.CODEX,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-6-astra": ModelInfo(
        "GPT 6 Astra",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-6-sol": ModelInfo(
        "GPT 6 Sol",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-6-luna": ModelInfo(
        "GPT 6 Luna",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "gpt-5.6-sol": ModelInfo(
        "GPT 5.6 Sol",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-5.6-terra": ModelInfo(
        "GPT 5.6 Terra",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-5.6-luna": ModelInfo(
        "GPT 5.6 Luna",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "gpt-5.5": ModelInfo(
        "GPT 5.5",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.4": ModelInfo(
        "GPT 5.4",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.4-mini": ModelInfo(
        "GPT 5.4 Mini",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.3-codex": ModelInfo(
        "GPT 5.3 Codex",
        AgentKind.CODEX,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.2-codex": ModelInfo(
        "GPT 5.2 Codex",
        AgentKind.CODEX,
        400_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.2": ModelInfo(
        "GPT 5.2",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.1-codex-max": ModelInfo(
        "GPT 5.1 Codex Max",
        AgentKind.CODEX,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.1-codex-mini": ModelInfo(
        "GPT 5.1 Codex Mini",
        AgentKind.CODEX,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:auto": ModelInfo("Auto", AgentKind.COPILOT, None),
    "copilot:claude-sonnet-5": ModelInfo(
        "Sonnet 5",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-fable-5": ModelInfo(
        "Fable 5",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-opus-5": ModelInfo(
        "Opus 5",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-opus-4.8": ModelInfo(
        "Opus 4.8",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-opus-4.8-fast": ModelInfo(
        "Opus 4.8 Fast",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-opus-4.7": ModelInfo(
        "Opus 4.7",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-sonnet-4.6": ModelInfo(
        "Sonnet 4.6",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "copilot:claude-opus-4.6": ModelInfo(
        "Opus 4.6",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "copilot:claude-sonnet-4.5": ModelInfo(
        "Sonnet 4.5", AgentKind.COPILOT, 160_000, legacy=True
    ),
    "copilot:claude-opus-4.5": ModelInfo(
        "Opus 4.5", AgentKind.COPILOT, 160_000, legacy=True
    ),
    "copilot:claude-haiku-4.5": ModelInfo("Haiku 4.5", AgentKind.COPILOT, 160_000),
    "copilot:gpt-6.1-sol": ModelInfo(
        "GPT 6.1 Sol",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-6-astra": ModelInfo(
        "GPT 6 Astra",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-6-sol": ModelInfo(
        "GPT 6 Sol",
        AgentKind.COPILOT,
        304_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-6-luna": ModelInfo(
        "GPT 6 Luna",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.6-sol": ModelInfo(
        "GPT 5.6 Sol",
        AgentKind.COPILOT,
        304_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.6-terra": ModelInfo(
        "GPT 5.6 Terra",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.6-luna": ModelInfo(
        "GPT 5.6 Luna",
        AgentKind.COPILOT,
        304_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.5": ModelInfo(
        "GPT 5.5",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:gpt-5.4": ModelInfo(
        "GPT 5.4",
        AgentKind.COPILOT,
        304_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:gpt-5.4-mini": ModelInfo(
        "GPT 5.4 Mini",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:gpt-5.3-codex": ModelInfo(
        "GPT 5.3 Codex",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:gpt-5-mini": ModelInfo(
        "GPT 5 Mini",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:mai-code-1-flash-picker": ModelInfo(
        "MAI Code 1 Flash",
        AgentKind.COPILOT,
        128_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-4-argon": ModelInfo(
        "Gemini 4 Argon",
        AgentKind.COPILOT,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash",
        AgentKind.COPILOT,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash",
        AgentKind.COPILOT,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash",
        AgentKind.COPILOT,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview",
        AgentKind.COPILOT,
        200_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:grok-4.5": ModelInfo(
        "Grok 4.5", AgentKind.COPILOT, 256_000, effort_levels=("low", "medium", "high")
    ),
    "copilot:kimi-k3": ModelInfo(
        "Kimi K3", AgentKind.COPILOT, 256_000, effort_levels=("low", "high", "max")
    ),
    "copilot:kimi-k2.7-code": ModelInfo("Kimi K2.7 Code", AgentKind.COPILOT, 256_000),
    "cursor:auto": ModelInfo("Auto", AgentKind.CURSOR, None),
    "cursor:composer-2.5-fast": ModelInfo(
        "Composer 2.5 Fast", AgentKind.CURSOR, 200_000
    ),
    "cursor:composer-2.5": ModelInfo("Composer 2.5", AgentKind.CURSOR, 200_000),
    "cursor:composer-2-fast": ModelInfo(
        "Composer 2", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:composer-1.5": ModelInfo(
        "Composer 1.5", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:gpt-5.4-medium": ModelInfo("GPT 5.4", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.4-mini-medium": ModelInfo("GPT 5.4 Mini", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.4-nano-medium": ModelInfo("GPT 5.4 Nano", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.3-codex": ModelInfo("GPT 5.3 Codex", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.3-codex-spark-preview": ModelInfo(
        "Codex 5.3 Spark", AgentKind.CURSOR, 272_000
    ),
    "cursor:gpt-5.2": ModelInfo("GPT 5.2", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.2-codex": ModelInfo(
        "GPT 5.2 Codex", AgentKind.CURSOR, 272_000, legacy=True
    ),
    "cursor:gpt-5.1": ModelInfo("GPT 5.1", AgentKind.CURSOR, 272_000, legacy=True),
    "cursor:gpt-5.1-codex-max-medium": ModelInfo(
        "GPT 5.1 Codex Max", AgentKind.CURSOR, 272_000
    ),
    "cursor:gpt-5.1-codex-mini": ModelInfo(
        "GPT 5.1 Codex Mini", AgentKind.CURSOR, 272_000
    ),
    "cursor:gpt-5-mini": ModelInfo("GPT 5 Mini", AgentKind.CURSOR, 272_000),
    "cursor:claude-opus-4-7-thinking-high": ModelInfo(
        "Opus 4.7 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:claude-4.6-opus-high-thinking": ModelInfo(
        "Opus 4.6 Thinking", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:claude-4.5-opus-high-thinking": ModelInfo(
        "Opus 4.5 Thinking", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:claude-4.6-sonnet-medium-thinking": ModelInfo(
        "Sonnet 4.6 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:claude-4.5-sonnet-thinking": ModelInfo(
        "Sonnet 4.5 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:claude-4-sonnet": ModelInfo("Sonnet 4", AgentKind.CURSOR, 200_000),
    "cursor:gemini-3.1-pro": ModelInfo("Gemini 3.1 Pro", AgentKind.CURSOR, 200_000),
    "cursor:gemini-3-flash": ModelInfo("Gemini 3 Flash", AgentKind.CURSOR, 200_000),
    "cursor:grok-4-20-thinking": ModelInfo(
        "Grok 4.20 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:kimi-k2.5": ModelInfo("Kimi K2.5", AgentKind.CURSOR, 262_000),
    "grok:grok-4.7": ModelInfo(
        "Grok 4.7",
        AgentKind.GROK,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "grok:grok-4.6": ModelInfo(
        "Grok 4.6",
        AgentKind.GROK,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "grok:grok-4.5": ModelInfo(
        "Grok 4.5",
        AgentKind.GROK,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-4-argon": ModelInfo(
        "Gemini 4 Argon",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-3.7-flash": ModelInfo(
        "Gemini 3.7 Flash",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-3.1-pro": ModelInfo(
        "Gemini 3.1 Pro",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        effort_levels=("low", "high"),
    ),
    "opencode:opencode/beam-free": ModelInfo(
        "Beam Free (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/big-pickle": ModelInfo(
        "Big Pickle (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/claude-fable-5": ModelInfo(
        "Claude Fable 5 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-fable-5-1": ModelInfo(
        "Claude Fable 5.1 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-haiku-4-5": ModelInfo(
        "Claude Haiku 4.5 (OpenCode)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:opencode/claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-opus-4-5": ModelInfo(
        "Claude Opus 4.5 (OpenCode)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/claude-opus-4-6": ModelInfo(
        "Claude Opus 4.6 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:opencode/claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-opus-5": ModelInfo(
        "Claude Opus 5 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-sonnet-4-5": ModelInfo(
        "Claude Sonnet 4.5 (OpenCode)", AgentKind.OPENCODE, 1_000_000, legacy=True
    ),
    "opencode:opencode/claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:opencode/claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/claude-sonnet-5-5": ModelInfo(
        "Claude Sonnet 5.5 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("high", "max"),
    ),
    "opencode:opencode/deepseek-v4.1-flash": ModelInfo(
        "DeepSeek V4.1 Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode/deepseek-v4.1-flash-free": ModelInfo(
        "DeepSeek V4.1 Flash Free (OpenCode)",
        AgentKind.OPENCODE,
        200_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode/flint-40b-free": ModelInfo(
        "Flint 40B Free (OpenCode)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/gemini-3-flash": ModelInfo(
        "Gemini 3 Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:opencode/gemini-3.1-pro": ModelInfo(
        "Gemini 3.1 Pro Preview (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:opencode/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:opencode/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:opencode/gemini-3.7-flash": ModelInfo(
        "Gemini 3.7 Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/gemini-4-argon": ModelInfo(
        "Gemini 4 Argon (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/glm-5": ModelInfo(
        "GLM-5 (OpenCode)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:opencode/glm-5.1": ModelInfo(
        "GLM-5.1 (OpenCode)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:opencode/glm-5.2": ModelInfo(
        "GLM-5.2 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("high", "max"),
    ),
    "opencode:opencode/glm-5.3": ModelInfo(
        "GLM-5.3 (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode/glm-5.3-flash": ModelInfo(
        "GLM-5.3-Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode/glm-5.3-flash-free": ModelInfo(
        "GLM-5.3-Flash Free (OpenCode)",
        AgentKind.OPENCODE,
        200_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode/gpt-5": ModelInfo(
        "GPT-5 (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:opencode/gpt-5-codex": ModelInfo(
        "GPT-5 Codex (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/gpt-5-nano": ModelInfo(
        "GPT-5 Nano (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:opencode/gpt-5.1": ModelInfo(
        "GPT-5.1 (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:opencode/gpt-5.1-codex": ModelInfo(
        "GPT-5.1 Codex (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/gpt-5.1-codex-max": ModelInfo(
        "GPT-5.1 Codex Max (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.1-codex-mini": ModelInfo(
        "GPT-5.1 Codex Mini (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/gpt-5.2": ModelInfo(
        "GPT-5.2 (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.2-codex": ModelInfo(
        "GPT-5.2 Codex (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.3-codex-spark": ModelInfo(
        "GPT-5.3 Codex Spark (OpenCode)",
        AgentKind.OPENCODE,
        128_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.4": ModelInfo(
        "GPT-5.4 (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 Mini (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 Nano (OpenCode)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.4-pro": ModelInfo(
        "GPT-5.4 Pro (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.5": ModelInfo(
        "GPT-5.5 (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.5-pro": ModelInfo(
        "GPT-5.5 Pro (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:opencode/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/gpt-6-astra": ModelInfo(
        "GPT-6 Astra (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/gpt-6-luna": ModelInfo(
        "GPT-6 Luna (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/gpt-6-sol": ModelInfo(
        "GPT-6 Sol (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (OpenCode)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/grok-4.5": ModelInfo(
        "Grok 4.5 (OpenCode)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode/grok-4.6": ModelInfo(
        "Grok 4.6 (OpenCode)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/grok-4.7": ModelInfo(
        "Grok 4.7 (OpenCode)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/grok-build-0.1": ModelInfo(
        "Grok Build 0.1 (OpenCode)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:opencode/kimi-k2.5": ModelInfo(
        "Kimi K2.5 (OpenCode)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:opencode/kimi-k2.6": ModelInfo(
        "Kimi K2.6 (OpenCode)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:opencode/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/kimi-k3": ModelInfo(
        "Kimi K3 (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode/mimo-v2.6-flash-free": ModelInfo(
        "MiMo-V2.6-Flash Free (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/minimax-m2.5": ModelInfo(
        "MiniMax-M2.5 (OpenCode)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:opencode/minimax-m2.7": ModelInfo(
        "MiniMax-M2.7 (OpenCode)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:opencode/minimax-m3": ModelInfo(
        "MiniMax-M3 (OpenCode)", AgentKind.OPENCODE, 512_000
    ),
    "opencode:opencode/mistral-large-4": ModelInfo(
        "Mistral Large 4 (OpenCode)",
        AgentKind.OPENCODE,
        524_288,
        effort_levels=("none", "high"),
    ),
    "opencode:opencode/muse-spark-1.2": ModelInfo(
        "Muse Spark 1.2 (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/muse-spark-1.3": ModelInfo(
        "Muse Spark 1.3 (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/muse-wonder-1.0": ModelInfo(
        "Muse Wonder (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode/nemotron-3-ultra-free": ModelInfo(
        "Nemotron 3 Ultra Free (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/nemotron-3.5-lightning-free": ModelInfo(
        "Nemotron 3.5 Lightning Free (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/nemotron-3.5-super-vl-free": ModelInfo(
        "Nemotron 3.5 Super VL Free (OpenCode)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode/qwen3.5-plus": ModelInfo(
        "Qwen3.5 Plus (OpenCode)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:opencode/qwen3.6-plus": ModelInfo(
        "Qwen3.6 Plus (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/qwen3.8-flash": ModelInfo(
        "Qwen3.8 Flash (OpenCode)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "xhigh"),
    ),
    "opencode:opencode/qwen3.8-max": ModelInfo(
        "Qwen3.8 Max (OpenCode)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("low", "medium", "xhigh"),
    ),
    "opencode:opencode-go/beam-free": ModelInfo(
        "Beam Free (Opencode Go)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode-go/claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode-go/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (New) (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("high", "max"),
    ),
    "opencode:opencode-go/deepseek-v4.1-flash": ModelInfo(
        "DeepSeek V4.1 Flash (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode-go/gemini-4-argon": ModelInfo(
        "Gemini 4 Argon (Opencode Go)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:opencode-go/glm-5.2": ModelInfo(
        "GLM-5.2 (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("high", "max"),
    ),
    "opencode:opencode-go/glm-5.3": ModelInfo(
        "GLM-5.3 (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode-go/glm-5.3-flash": ModelInfo(
        "GLM-5.3-Flash (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode-go/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Opencode Go)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode-go/gpt-6-luna": ModelInfo(
        "GPT-6 Luna (Opencode Go)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode-go/grok-4.7": ModelInfo(
        "Grok 4.7 (Opencode Go)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode-go/hy3": ModelInfo(
        "Hy3 (Opencode Go)",
        AgentKind.OPENCODE,
        256_000,
        legacy=True,
        effort_levels=("none", "low", "high"),
    ),
    "opencode:opencode-go/hy4-preview": ModelInfo(
        "Hy4 preview (Opencode Go)",
        AgentKind.OPENCODE,
        1_024_000,
        effort_levels=("none", "high"),
    ),
    "opencode:opencode-go/iceman-contributor-free": ModelInfo(
        "Iceman Contributor Free (Opencode Go)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (Opencode Go)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/kimi-k3": ModelInfo(
        "Kimi K3 (Opencode Go)", AgentKind.OPENCODE, 1_048_576, effort_levels=("max",)
    ),
    "opencode:opencode-go/kimi-k3.1-pro": ModelInfo(
        "Kimi K3.1 Pro (Opencode Go)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:opencode-go/longcat-2.0": ModelInfo(
        "LongCat-2.0 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/mimo-v2.5": ModelInfo(
        "MiMo V2.5 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/mimo-v2.5-pro": ModelInfo(
        "MiMo V2.5 Pro (Opencode Go)", AgentKind.OPENCODE, 1_048_576, legacy=True
    ),
    "opencode:opencode-go/mimo-v2.6-flash": ModelInfo(
        "MiMo-V2.6-Flash (Opencode Go)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode-go/mimo-v2.6-pro": ModelInfo(
        "MiMo-V2.6-Pro (Opencode Go)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode-go/minimax-m3": ModelInfo(
        "MiniMax-M3 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/minimax-m3.1-flash": ModelInfo(
        "MiniMax M3.1 Flash (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:opencode-go/muse-spark-1.2-contributor": ModelInfo(
        "Muse Spark 1.2 Contributor (Opencode Go)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode-go/muse-spark-1.3-contributor": ModelInfo(
        "Muse Spark 1.3 Contributor (Opencode Go)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:opencode-go/qwen3.7-plus": ModelInfo(
        "Qwen3.7 Plus (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/qwen3.8-flash": ModelInfo(
        "Qwen3.8 Flash (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "xhigh"),
    ),
    "opencode:opencode-go/qwen3.8-max": ModelInfo(
        "Qwen3.8 Max (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "xhigh"),
    ),
    "opencode:opencode-go/step-5-preview": ModelInfo(
        "Step 5 Preview (Opencode Go)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/amazon.nova-2-lite-v1:0": ModelInfo(
        "Nova 2 Lite (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/amazon.nova-lite-v1:0": ModelInfo(
        "Nova Lite (Amazon Bedrock)", AgentKind.OPENCODE, 300_000, legacy=True
    ),
    "opencode:amazon-bedrock/amazon.nova-micro-v1:0": ModelInfo(
        "Nova Micro (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/amazon.nova-pro-v1:0": ModelInfo(
        "Nova Pro (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-fable-5-1": ModelInfo(
        "Claude Fable 5.1 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:amazon-bedrock/anthropic.claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-5-5": ModelInfo(
        "Claude Sonnet 5.5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/apac.amazon.nova-lite-v1:0": ModelInfo(
        "Nova Lite (APAC) (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/apac.amazon.nova-micro-v1:0": ModelInfo(
        "Nova Micro (APAC) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/apac.amazon.nova-pro-v1:0": ModelInfo(
        "Nova Pro (APAC) (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-4-6-v1": ModelInfo(
        "AU Anthropic Claude Opus 4.6 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-sonnet-4-6": ModelInfo(
        "AU Anthropic Claude Sonnet 4.6 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-sonnet-5-5": ModelInfo(
        "Claude Sonnet 5.5 (AU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/ca.amazon.nova-lite-v1:0": ModelInfo(
        "Nova Lite (CA) (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/deepseek.v3.2": ModelInfo(
        "DeepSeek V3.2 (Amazon Bedrock)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:amazon-bedrock/eu.amazon.nova-2-lite-v1:0": ModelInfo(
        "Nova 2 Lite (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/eu.amazon.nova-lite-v1:0": ModelInfo(
        "Nova Lite (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 300_000, legacy=True
    ),
    "opencode:amazon-bedrock/eu.amazon.nova-micro-v1:0": ModelInfo(
        "Nova Micro (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/eu.amazon.nova-pro-v1:0": ModelInfo(
        "Nova Pro (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-5-5": ModelInfo(
        "Claude Sonnet 5.5 (EU) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/eu.mistral.pixtral-large-2502-v1:0": ModelInfo(
        "Pixtral Large (25.02) (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/global.amazon.nova-2-lite-v1:0": ModelInfo(
        "Nova 2 Lite (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-fable-5-1": ModelInfo(
        "Claude Fable 5.1 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-5-5": ModelInfo(
        "Claude Sonnet 5.5 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.moonshotai.kimi-k3": ModelInfo(
        "Kimi K3 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:amazon-bedrock/global.openai.gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.openai.gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.openai.gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.openai.gpt-6-astra": ModelInfo(
        "GPT-6 Astra (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.openai.gpt-6-luna": ModelInfo(
        "GPT-6 Luna (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.openai.gpt-6-sol": ModelInfo(
        "GPT-6 Sol (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.openai.gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/global.xai.grok-4.6": ModelInfo(
        "Grok 4.6 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:amazon-bedrock/global.xai.grok-4.7": ModelInfo(
        "Grok 4.7 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:amazon-bedrock/global.zai.glm-5.3": ModelInfo(
        "GLM-5.3 (Global) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/google.gemma-4-26b-a4b": ModelInfo(
        "Gemma 4 26B A4B IT (Amazon Bedrock)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "high"),
    ),
    "opencode:amazon-bedrock/google.gemma-4-31b": ModelInfo(
        "Gemma 4 31B IT (Amazon Bedrock)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "high"),
    ),
    "opencode:amazon-bedrock/google.gemma-4-e2b": ModelInfo(
        "Gemma 4 E2B IT (Amazon Bedrock)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("none", "high"),
    ),
    "opencode:amazon-bedrock/in.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (India) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/in.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (India) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/in.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (India) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/in.openai.gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (India) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/in.openai.gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (India) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/jp.amazon.nova-2-lite-v1:0": ModelInfo(
        "Nova 2 Lite (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (JP) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/minimax.minimax-m2.5": ModelInfo(
        "MiniMax-M2.5 (Amazon Bedrock)", AgentKind.OPENCODE, 196_608
    ),
    "opencode:amazon-bedrock/mistral.magistral-small-2509": ModelInfo(
        "Magistral Small 1.2 (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/mistral.ministral-3-14b-instruct": ModelInfo(
        "Ministral 14B 3.0 (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/mistral.ministral-3-3b-instruct": ModelInfo(
        "Ministral 3 3B (Amazon Bedrock)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:amazon-bedrock/mistral.ministral-3-8b-instruct": ModelInfo(
        "Ministral 3 8B (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/mistral.mistral-large-3-675b-instruct": ModelInfo(
        "Mistral Large 3 (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/mistral.pixtral-large-2502-v1:0": ModelInfo(
        "Pixtral Large (25.02) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/moonshotai.kimi-k2.5": ModelInfo(
        "Kimi K2.5 (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/nvidia.nemotron-nano-3-30b": ModelInfo(
        "NVIDIA Nemotron Nano 3 30B (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/nvidia.nemotron-super-3-120b": ModelInfo(
        "NVIDIA Nemotron 3 Super 120B A12B (Amazon Bedrock)",
        AgentKind.OPENCODE,
        262_144,
    ),
    "opencode:amazon-bedrock/openai.gpt-5.4": ModelInfo(
        "GPT-5.4 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:amazon-bedrock/openai.gpt-5.5": ModelInfo(
        "GPT-5.5 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:amazon-bedrock/openai.gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/openai.gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/openai.gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/openai.gpt-6-astra": ModelInfo(
        "GPT-6 Astra (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/openai.gpt-6-luna": ModelInfo(
        "GPT-6 Luna (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/openai.gpt-6-sol": ModelInfo(
        "GPT-6 Sol (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/openai.gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-120b": ModelInfo(
        "gpt-oss-120b (Amazon Bedrock)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-120b-1:0": ModelInfo(
        "gpt-oss-120b (Amazon Bedrock)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-20b": ModelInfo(
        "gpt-oss-20b (Amazon Bedrock)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-20b-1:0": ModelInfo(
        "gpt-oss-20b (Amazon Bedrock)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-safeguard-120b": ModelInfo(
        "GPT OSS Safeguard 120B (Amazon Bedrock)",
        AgentKind.OPENCODE,
        128_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-safeguard-20b": ModelInfo(
        "GPT OSS Safeguard 20B (Amazon Bedrock)",
        AgentKind.OPENCODE,
        128_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/qwen.qwen3-235b-a22b-2507-v1:0": ModelInfo(
        "Qwen3 235B-A22B Instruct 2507 (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/qwen.qwen3-32b-v1:0": ModelInfo(
        "Qwen3 32B (Amazon Bedrock)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:amazon-bedrock/qwen.qwen3-coder-next": ModelInfo(
        "Qwen3 Coder Next (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/qwen.qwen3-next-80b-a3b": ModelInfo(
        "Qwen3-Next 80B-A3B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/qwen.qwen3-vl-235b-a22b": ModelInfo(
        "Qwen3 VL 235B A22B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/us-gov.openai.gpt-oss-120b-1:0": ModelInfo(
        "gpt-oss-120b (GovCloud) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        128_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/us-gov.openai.gpt-oss-20b-1:0": ModelInfo(
        "gpt-oss-20b (GovCloud) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        128_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/us.amazon.nova-2-lite-v1:0": ModelInfo(
        "Nova 2 Lite (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/us.amazon.nova-lite-v1:0": ModelInfo(
        "Nova Lite (US) (Amazon Bedrock)", AgentKind.OPENCODE, 300_000, legacy=True
    ),
    "opencode:amazon-bedrock/us.amazon.nova-micro-v1:0": ModelInfo(
        "Nova Micro (US) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/us.amazon.nova-pro-v1:0": ModelInfo(
        "Nova Pro (US) (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-fable-5-1": ModelInfo(
        "Claude Fable 5.1 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-5-5": ModelInfo(
        "Claude Sonnet 5.5 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.mistral.pixtral-large-2502-v1:0": ModelInfo(
        "Pixtral Large (25.02) (US) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/us.moonshotai.kimi-k3": ModelInfo(
        "Kimi K3 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:amazon-bedrock/us.openai.gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.openai.gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.openai.gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.openai.gpt-6-astra": ModelInfo(
        "GPT-6 Astra (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.openai.gpt-6-luna": ModelInfo(
        "GPT-6 Luna (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.openai.gpt-6-sol": ModelInfo(
        "GPT-6 Sol (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.openai.gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/us.xai.grok-4.6": ModelInfo(
        "Grok 4.6 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:amazon-bedrock/us.xai.grok-4.7": ModelInfo(
        "Grok 4.7 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:amazon-bedrock/us.zai.glm-5.3": ModelInfo(
        "GLM-5.3 (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:amazon-bedrock/xai.grok-4.3": ModelInfo(
        "Grok 4.3 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:amazon-bedrock/xai.grok-4.6": ModelInfo(
        "Grok 4.6 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:amazon-bedrock/zai.glm-5": ModelInfo(
        "GLM-5 (Amazon Bedrock)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:deepseek/deepseek-flash": ModelInfo(
        "DeepSeek V4.1 Flash (Deepseek)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:deepseek/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (Deepseek)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:github-copilot/claude-fable-5": ModelInfo(
        "Claude Fable 5 (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/claude-fable-5.1": ModelInfo(
        "Claude Fable 5.1 (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/claude-haiku-4.5": ModelInfo(
        "Claude Haiku 4.5 (latest) (Github Copilot)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:github-copilot/claude-haiku-5.5": ModelInfo(
        "Claude Haiku 5.5 (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/claude-opus-4.8": ModelInfo(
        "Claude Opus 4.8 (Github Copilot)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/claude-opus-4.8-fast": ModelInfo(
        "Claude Opus 4.8 Fast (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-5": ModelInfo(
        "Claude Opus 5 (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/claude-opus-5.5": ModelInfo(
        "Claude Opus 5.5 (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/claude-sonnet-4.6": ModelInfo(
        "Claude Sonnet 4.6 (Github Copilot)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:github-copilot/claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/claude-sonnet-5.5": ModelInfo(
        "Claude Sonnet 5.5 (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash (Github Copilot)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:github-copilot/gemini-4-argon": ModelInfo(
        "Gemini 4 Argon (Github Copilot)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:github-copilot/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (Github Copilot)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:github-copilot/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 nano (Github Copilot)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:github-copilot/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gpt-6-astra": ModelInfo(
        "GPT-6 Astra (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gpt-6-luna": ModelInfo(
        "GPT-6 Luna (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gpt-6-sol": ModelInfo(
        "GPT-6 Sol (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/gpt-6.1-terra": ModelInfo(
        "GPT-6.1 Terra (Github Copilot)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:github-copilot/grok-4.5": ModelInfo(
        "Grok 4.5 (Github Copilot)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:github-copilot/grok-4.6": ModelInfo(
        "Grok 4.6 (Github Copilot)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:github-copilot/grok-4.7": ModelInfo(
        "Grok 4.7 (Github Copilot)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:github-copilot/kimi-k3": ModelInfo(
        "Kimi K3 (Github Copilot)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:github-copilot/mai-code-1.1-flash": ModelInfo(
        "MAI-Code-1.1-Flash (Github Copilot)",
        AgentKind.OPENCODE,
        256_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/deep-research-max-preview-04-2026": ModelInfo(
        "Deep Research Max Preview (Apr-21-2026) (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/deep-research-preview-04-2026": ModelInfo(
        "Deep Research Preview (Apr-21-2026) (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-2.5-computer-use-preview-10-2025": ModelInfo(
        "Gemini 2.5 Computer Use Preview 10-2025 (Google)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:google/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Google)", AgentKind.OPENCODE, 1_048_576, legacy=True
    ),
    "opencode:google/gemini-2.5-flash-image": ModelInfo(
        "Nano Banana (Google)", AgentKind.OPENCODE, 32_768, legacy=True
    ),
    "opencode:google/gemini-2.5-flash-lite": ModelInfo(
        "Gemini 2.5 Flash-Lite (Google)", AgentKind.OPENCODE, 1_048_576, legacy=True
    ),
    "opencode:google/gemini-2.5-flash-preview-tts": ModelInfo(
        "Gemini 2.5 Flash Preview TTS (Google)", AgentKind.OPENCODE, 8_192, legacy=True
    ),
    "opencode:google/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Google)", AgentKind.OPENCODE, 1_048_576, legacy=True
    ),
    "opencode:google/gemini-2.5-pro-preview-tts": ModelInfo(
        "Gemini 2.5 Pro Preview TTS (Google)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google/gemini-3-pro-image": ModelInfo(
        "Nano Banana Pro (Google)",
        AgentKind.OPENCODE,
        65_536,
        effort_levels=("low", "high"),
    ),
    "opencode:google/gemini-3-pro-image-preview": ModelInfo(
        "Nano Banana Pro (Google)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:google/gemini-3.1-flash-image": ModelInfo(
        "Nano Banana 2 (Google)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("minimal", "high"),
    ),
    "opencode:google/gemini-3.1-flash-image-preview": ModelInfo(
        "Nano Banana 2 (Google)",
        AgentKind.OPENCODE,
        65_536,
        legacy=True,
        effort_levels=("minimal", "high"),
    ),
    "opencode:google/gemini-3.1-flash-lite": ModelInfo(
        "Gemini 3.1 Flash Lite (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google/gemini-3.1-flash-lite-image": ModelInfo(
        "Nano Banana 2 Lite (Google)",
        AgentKind.OPENCODE,
        65_536,
        effort_levels=("minimal", "high"),
    ),
    "opencode:google/gemini-3.1-flash-live-preview": ModelInfo(
        "Gemini 3.1 Flash Live Preview (Google)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google/gemini-3.1-flash-tts-preview": ModelInfo(
        "Gemini 3.1 Flash TTS Preview (Google)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:google/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google/gemini-3.5-live-translate-preview": ModelInfo(
        "Gemini 3.5 Live Translate Preview (Google)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:google/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google/gemini-3.7-flash": ModelInfo(
        "Gemini 3.7 Flash (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/gemini-4-argon": ModelInfo(
        "Gemini 4 Argon (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/gemini-embedding-001": ModelInfo(
        "Gemini Embedding 001 (Google)", AgentKind.OPENCODE, 2_048, legacy=True
    ),
    "opencode:google/gemini-embedding-2": ModelInfo(
        "Gemini Embedding 2 (Google)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:google/gemini-flash-latest": ModelInfo(
        "Gemini Flash Latest (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/gemini-flash-lite-latest": ModelInfo(
        "Gemini Flash-Lite Latest (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google/gemini-omni-flash-preview": ModelInfo(
        "Gemini Omni Flash Preview (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-pro-latest": ModelInfo(
        "Gemini Pro Latest (Google)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google/gemma-4-26b-a4b-it": ModelInfo(
        "Gemma 4 26B A4B IT (Google)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:google/gemma-4-31b-it": ModelInfo(
        "Gemma 4 31B IT (Google)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:google/lyria-3-clip-preview": ModelInfo(
        "Lyria 3 Clip Preview (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/lyria-3-pro-preview": ModelInfo(
        "Lyria 3 Pro Preview (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/claude-fable-5-1@default": ModelInfo(
        "Claude Fable 5.1 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-fable-5@default": ModelInfo(
        "Claude Fable 5 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-haiku-4-5@20251001": ModelInfo(
        "Claude Haiku 4.5 (Google Vertex)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:google-vertex/claude-haiku-5-5@default": ModelInfo(
        "Claude Haiku 5.5 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-opus-4-5@20251101": ModelInfo(
        "Claude Opus 4.5 (Google Vertex)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/claude-opus-4-6@default": ModelInfo(
        "Claude Opus 4.6 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:google-vertex/claude-opus-4-7@default": ModelInfo(
        "Claude Opus 4.7 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-opus-4-8@default": ModelInfo(
        "Claude Opus 4.8 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-opus-5-5@default": ModelInfo(
        "Claude Opus 5.5 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-opus-5@default": ModelInfo(
        "Claude Opus 5 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-sonnet-4-6@default": ModelInfo(
        "Claude Sonnet 4.6 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "opencode:google-vertex/claude-sonnet-5-5@default": ModelInfo(
        "Claude Sonnet 5.5 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/claude-sonnet-5@default": ModelInfo(
        "Claude Sonnet 5 (Google Vertex)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:google-vertex/codestral-2": ModelInfo(
        "Codestral 2 (Google Vertex)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:google-vertex/gemini-2.5-flash-image": ModelInfo(
        "Nano Banana (Google Vertex)", AgentKind.OPENCODE, 32_768, legacy=True
    ),
    "opencode:google-vertex/gemini-2.5-flash-tts": ModelInfo(
        "Gemini 2.5 Flash TTS (Google Vertex)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google-vertex/gemini-2.5-pro-tts": ModelInfo(
        "Gemini 2.5 Pro TTS (Google Vertex)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google-vertex/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-3-pro-image": ModelInfo(
        "Nano Banana Pro (Google Vertex)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:google-vertex/gemini-3.1-flash-image": ModelInfo(
        "Nano Banana 2 (Google Vertex)",
        AgentKind.OPENCODE,
        131_072,
        legacy=True,
        effort_levels=("minimal", "high"),
    ),
    "opencode:google-vertex/gemini-3.1-flash-lite": ModelInfo(
        "Gemini 3.1 Flash Lite (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-3.1-flash-lite-image": ModelInfo(
        "Nano Banana 2 Lite (Google Vertex)",
        AgentKind.OPENCODE,
        65_536,
        effort_levels=("minimal", "high"),
    ),
    "opencode:google-vertex/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-3.7-flash": ModelInfo(
        "Gemini 3.7 Flash (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-4-argon": ModelInfo(
        "Gemini 4 Argon (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/gemini-embedding-001": ModelInfo(
        "Gemini Embedding 001 (Google Vertex)", AgentKind.OPENCODE, 2_048
    ),
    "opencode:google-vertex/gemini-nano-banana-2.1": ModelInfo(
        "Nano Banana 2.1 (Google Vertex)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("minimal", "medium", "high"),
    ),
    "opencode:google-vertex/google/gemma-4-26b-a4b-it-maas": ModelInfo(
        "Gemma 4 26B A4B IT (Google Vertex)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:google-vertex/meta/llama-4-maverick-17b-128e-instruct-maas": ModelInfo(
        "Llama 4 Maverick 17B 128E Instruct (Google Vertex)",
        AgentKind.OPENCODE,
        524_288,
    ),
    "opencode:google-vertex/meta/llama-4-scout-17b-16e-instruct-maas": ModelInfo(
        "Llama 4 Scout 17B Instruct (Google Vertex)", AgentKind.OPENCODE, 1_310_720
    ),
    "opencode:google-vertex/mistral-medium-3": ModelInfo(
        "Mistral Medium 3 (Google Vertex)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google-vertex/mistral-small-2503": ModelInfo(
        "Mistral Small 3.1 24B (Google Vertex)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:google-vertex/openai/gpt-oss-120b-maas": ModelInfo(
        "GPT OSS 120B (Google Vertex)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/xai/grok-4.20-non-reasoning": ModelInfo(
        "Grok 4.20 (Non-Reasoning) (Google Vertex)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:google-vertex/xai/grok-4.20-reasoning": ModelInfo(
        "Grok 4.20 (Reasoning) (Google Vertex)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:google-vertex/xai/grok-4.3": ModelInfo(
        "Grok 4.3 (Google Vertex)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:google-vertex/xai/grok-4.6": ModelInfo(
        "Grok 4.6 (Google Vertex)",
        AgentKind.OPENCODE,
        524_288,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/xai/grok-4.7": ModelInfo(
        "Grok 4.7 (Google Vertex)",
        AgentKind.OPENCODE,
        524_288,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:google-vertex/zai-org/glm-5.2-maas": ModelInfo(
        "GLM-5.2 (Google Vertex)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openai/gpt-4.1": ModelInfo(
        "GPT-4.1 (Openai)", AgentKind.OPENCODE, 1_047_576, legacy=True
    ),
    "opencode:openai/gpt-4.1-mini": ModelInfo(
        "GPT-4.1 mini (Openai)", AgentKind.OPENCODE, 1_047_576, legacy=True
    ),
    "opencode:openai/gpt-4o": ModelInfo("GPT-4o (Openai)", AgentKind.OPENCODE, 128_000),
    "opencode:openai/gpt-4o-2024-08-06": ModelInfo(
        "GPT-4o (2024-08-06) (Openai)", AgentKind.OPENCODE, 128_000, legacy=True
    ),
    "opencode:openai/gpt-4o-2024-11-20": ModelInfo(
        "GPT-4o (2024-11-20) (Openai)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openai/gpt-4o-mini": ModelInfo(
        "GPT-4o mini (Openai)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openai/gpt-5": ModelInfo(
        "GPT-5 (Openai)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openai/gpt-5-mini": ModelInfo(
        "GPT-5 Mini (Openai)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openai/gpt-5-nano": ModelInfo(
        "GPT-5 Nano (Openai)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openai/gpt-5-pro": ModelInfo(
        "GPT-5 Pro (Openai)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("high",),
    ),
    "opencode:openai/gpt-5.1": ModelInfo(
        "GPT-5.1 (Openai)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:openai/gpt-5.2": ModelInfo(
        "GPT-5.2 (Openai)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.2-pro": ModelInfo(
        "GPT-5.2 Pro (Openai)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (Openai)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.3-codex-spark": ModelInfo(
        "GPT-5.3 Codex Spark (Openai)",
        AgentKind.OPENCODE,
        128_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.4": ModelInfo(
        "GPT-5.4 (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.4-fast": ModelInfo(
        "GPT-5.4 Fast (Openai)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openai/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 mini (Openai)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.4-mini-fast": ModelInfo(
        "GPT-5.4 mini Fast (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 nano (Openai)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.4-pro": ModelInfo(
        "GPT-5.4 Pro (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.5": ModelInfo(
        "GPT-5.5 (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.5-pro": ModelInfo(
        "GPT-5.5 Pro (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:openai/gpt-5.6": ModelInfo(
        "GPT-5.6 (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-6-astra": ModelInfo(
        "GPT-6 Astra (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-6-luna": ModelInfo(
        "GPT-6 Luna (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-6-sol": ModelInfo(
        "GPT-6 Sol (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-6.1-terra": ModelInfo(
        "GPT-6.1 Terra (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-daybreak-blue-latest": ModelInfo(
        "Daybreak Blue (Openai)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-daybreak-red-latest": ModelInfo(
        "Daybreak Red (Openai)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openai/gpt-realtime-2.1": ModelInfo(
        "GPT-Realtime-2.1 (Openai)",
        AgentKind.OPENCODE,
        128_000,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openai/o3": ModelInfo(
        "o3 (Openai)",
        AgentKind.OPENCODE,
        200_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openai/o3-pro": ModelInfo(
        "o3-pro (Openai)",
        AgentKind.OPENCODE,
        200_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openai/text-embedding-3-large": ModelInfo(
        "text-embedding-3-large (Openai)", AgentKind.OPENCODE, 8_191
    ),
    "opencode:openai/text-embedding-3-small": ModelInfo(
        "text-embedding-3-small (Openai)", AgentKind.OPENCODE, 8_191
    ),
    "opencode:openai/text-embedding-ada-002": ModelInfo(
        "text-embedding-ada-002 (Openai)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/aion-labs/aion-2.0": ModelInfo(
        "Aion-2.0 (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/aion-labs/aion-3.0": ModelInfo(
        "Aion-3.0 (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/aion-labs/aion-3.0-mini": ModelInfo(
        "Aion-3.0-Mini (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/aion-labs/aion-3.5": ModelInfo(
        "Aion 3.5 (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:openrouter/aion-labs/aion-3.5-mini": ModelInfo(
        "Aion 3.5 Mini (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:openrouter/aion-labs/aion-rp-llama-3.1-8b": ModelInfo(
        "Aion-RP 1.0 (8B) (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/amazon/nova-2-lite-v1": ModelInfo(
        "Nova 2 Lite (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/amazon/nova-lite-v1": ModelInfo(
        "Nova Lite 1.0 (Openrouter)", AgentKind.OPENCODE, 300_000, legacy=True
    ),
    "opencode:openrouter/amazon/nova-micro-v1": ModelInfo(
        "Nova Micro 1.0 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/amazon/nova-pro-v1": ModelInfo(
        "Nova Pro 1.0 (Openrouter)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:openrouter/anthracite-org/magnum-v4-72b": ModelInfo(
        "Magnum v4 72B (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/anthropic/claude-fable-5": ModelInfo(
        "Claude Fable 5 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-fable-5.1": ModelInfo(
        "Claude Fable 5.1 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-haiku-4.5": ModelInfo(
        "Claude Haiku 4.5 (latest) (Openrouter)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:openrouter/anthropic/claude-haiku-5.5": ModelInfo(
        "Claude Haiku 5.5 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-opus-4.1": ModelInfo(
        "Claude Opus 4.1 (latest) (Openrouter)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:openrouter/anthropic/claude-opus-4.5": ModelInfo(
        "Claude Opus 4.5 (latest) (Openrouter)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
    ),
    "opencode:openrouter/anthropic/claude-opus-4.6": ModelInfo(
        "Claude Opus 4.6 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "max"),
    ),
    "opencode:openrouter/anthropic/claude-opus-4.7": ModelInfo(
        "Claude Opus 4.7 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-opus-4.8": ModelInfo(
        "Claude Opus 4.8 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-opus-5": ModelInfo(
        "Claude Opus 5 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-opus-5.5": ModelInfo(
        "Claude Opus 5.5 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4.5": ModelInfo(
        "Claude Sonnet 4.5 (latest) (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4.6": ModelInfo(
        "Claude Sonnet 4.6 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "max"),
    ),
    "opencode:openrouter/anthropic/claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/anthropic/claude-sonnet-5.5": ModelInfo(
        "Claude Sonnet 5.5 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/bytedance-seed/seed-2-1-turbo": ModelInfo(
        "Seed 2.1 Turbo (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/bytedance-seed/seed-2.0-lite": ModelInfo(
        "Seed 2.0 Lite (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/bytedance-seed/seed-2.0-mini": ModelInfo(
        "Seed 2.0 Mini (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/bytedance/ui-tars-1.5-7b": ModelInfo(
        "UI-TARS 7B  (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition": ModelInfo(
        "Uncensored (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/cohere/command-a": ModelInfo(
        "Command A (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/cohere/command-a-plus": ModelInfo(
        "Command A+ (Openrouter)", AgentKind.OPENCODE, 192_000
    ),
    "opencode:openrouter/cohere/command-r-08-2024": ModelInfo(
        "Command R (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/cohere/command-r-plus-08-2024": ModelInfo(
        "Command R+ (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/cohere/command-r7b-12-2024": ModelInfo(
        "Command R7B (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/cohere/north-mini-code:free": ModelInfo(
        "North Mini Code (free) (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/deepseek/deepseek-chat": ModelInfo(
        "DeepSeek Chat (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-chat-v3-0324": ModelInfo(
        "DeepSeek V3 0324 (Openrouter)", AgentKind.OPENCODE, 163_840, legacy=True
    ),
    "opencode:openrouter/deepseek/deepseek-chat-v3.1": ModelInfo(
        "DeepSeek V3.1 (Openrouter)", AgentKind.OPENCODE, 163_840, legacy=True
    ),
    "opencode:openrouter/deepseek/deepseek-r1-0528": ModelInfo(
        "DeepSeek R1 0528 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-v3.1-terminus": ModelInfo(
        "DeepSeek V3.1 Terminus (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-v3.2": ModelInfo(
        "DeepSeek V3.2 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-v3.2-exp": ModelInfo(
        "DeepSeek V3.2 Exp (Openrouter)", AgentKind.OPENCODE, 163_840, legacy=True
    ),
    "opencode:openrouter/deepseek/deepseek-v4-flash": ModelInfo(
        "DeepSeek V4 Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("none", "high", "xhigh"),
    ),
    "opencode:openrouter/deepseek/deepseek-v4-flash-0731": ModelInfo(
        "DeepSeek V4 Flash 0731 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/deepseek/deepseek-v4-flash-vision-exp": ModelInfo(
        "DeepSeek V4 Flash Vision Exp (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/deepseek/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "high", "xhigh"),
    ),
    "opencode:openrouter/deepseek/deepseek-v4-pro-0813": ModelInfo(
        "DeepSeek V4 Pro 0813 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/deepseek/deepseek-v4.1-flash": ModelInfo(
        "DeepSeek V4.1 Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/deepseek/deepseek-v4.1-flash-1017": ModelInfo(
        "DeepSeek V4.1 Flash 1017 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/elorian/glimpse": ModelInfo(
        "Glimpse (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/fireworks/ember-1": ModelInfo(
        "Ember-1 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/google/gemini-2.5-flash-image": ModelInfo(
        "Nano Banana (Openrouter)", AgentKind.OPENCODE, 32_768, legacy=True
    ),
    "opencode:openrouter/google/gemini-2.5-pro-preview": ModelInfo(
        "Gemini 2.5 Pro Preview 06-05 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
    ),
    "opencode:openrouter/google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("none", "minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3-pro-image": ModelInfo(
        "Nano Banana Pro (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemini-3-pro-image-preview": ModelInfo(
        "Nano Banana Pro Preview (Openrouter)", AgentKind.OPENCODE, 65_536, legacy=True
    ),
    "opencode:openrouter/google/gemini-3.1-flash-image": ModelInfo(
        "Nano Banana 2 (Openrouter)",
        AgentKind.OPENCODE,
        131_072,
        legacy=True,
        effort_levels=("none", "minimal", "high"),
    ),
    "opencode:openrouter/google/gemini-3.1-flash-image-preview": ModelInfo(
        "Nano Banana 2 Preview (Openrouter)",
        AgentKind.OPENCODE,
        65_536,
        legacy=True,
        effort_levels=("none", "minimal", "high"),
    ),
    "opencode:openrouter/google/gemini-3.1-flash-lite": ModelInfo(
        "Gemini 3.1 Flash Lite (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("none", "minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.1-flash-lite-image": ModelInfo(
        "Nano Banana 2 Lite (Openrouter)",
        AgentKind.OPENCODE,
        65_536,
        effort_levels=("none", "minimal", "high"),
    ),
    "opencode:openrouter/google/gemini-3.1-flash-lite-preview": ModelInfo(
        "Gemini 3.1 Flash Lite Preview (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("none", "minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.7-flash": ModelInfo(
        "Gemini 3.7 Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-4-argon": ModelInfo(
        "Gemini 4 Argon (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/google/gemini-nano-banana-2.1": ModelInfo(
        "Nano Banana 2.1 (Openrouter)",
        AgentKind.OPENCODE,
        65_536,
        effort_levels=("none", "minimal", "high"),
    ),
    "opencode:openrouter/google/gemma-2-27b-it": ModelInfo(
        "Gemma 2 27B (Openrouter)", AgentKind.OPENCODE, 8_192, legacy=True
    ),
    "opencode:openrouter/google/gemma-3-12b-it": ModelInfo(
        "Gemma 3 12B IT (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemma-3-27b-it": ModelInfo(
        "Gemma 3 27B IT (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemma-3-4b-it": ModelInfo(
        "Gemma 3 4B IT (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemma-4-26b-a4b-it": ModelInfo(
        "Gemma 4 26B A4B IT (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/gemma-4-26b-a4b-it:free": ModelInfo(
        "Gemma 4 26B A4B  (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/gemma-4-31b-it": ModelInfo(
        "Gemma 4 31B IT (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/gemma-4-31b-it:free": ModelInfo(
        "Gemma 4 31B (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/lyria-3-clip-preview": ModelInfo(
        "Lyria 3 Clip Preview (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/lyria-3-pro-preview": ModelInfo(
        "Lyria 3 Pro Preview (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/gryphe/mythomax-l2-13b": ModelInfo(
        "MythoMax 13B (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/ibm-granite/granite-4.2-8b": ModelInfo(
        "Granite 4.2 8B (Openrouter)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("none", "low", "high"),
    ),
    "opencode:openrouter/inception/mercury-2": ModelInfo(
        "Mercury 2 (Openrouter)",
        AgentKind.OPENCODE,
        128_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:openrouter/inception/mercury-2.5": ModelInfo(
        "Mercury 2.5 (Openrouter)",
        AgentKind.OPENCODE,
        260_000,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:openrouter/inception/mercury-3": ModelInfo(
        "Mercury 3 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:openrouter/inclusionai/ling-3.0-flash": ModelInfo(
        "Ling 3.0 Flash (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/inclusionai/ling-3.0-flash-vl": ModelInfo(
        "Ling 3.0 Flash VL (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/inclusionai/ling-3.1-flash": ModelInfo(
        "Ling 3.1 Flash (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/inference-net/schematron-v2-small": ModelInfo(
        "Schematron V2 Small (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/inference-net/schematron-v2-turbo": ModelInfo(
        "Schematron V2 Turbo (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/liquid/lfm-2.5-2.6b": ModelInfo(
        "LFM2.5-2.6B (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/liquid/lfm-2.5-2.6b:free": ModelInfo(
        "LFM2.5-2.6B (free) (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/liquid/lfm-2.5-24b-a2b": ModelInfo(
        "LFM2.5-24B-A2B (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/mancer/weaver": ModelInfo(
        "Weaver (alpha) (Openrouter)", AgentKind.OPENCODE, 8_000
    ),
    "opencode:openrouter/meituan/longcat-2.0": ModelInfo(
        "LongCat 2.0 (Openrouter)", AgentKind.OPENCODE, 1_048_756
    ),
    "opencode:openrouter/meta-llama/llama-3.1-70b-instruct": ModelInfo(
        "Llama-3.1-70B-Instruct (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/meta-llama/llama-3.1-8b-instruct": ModelInfo(
        "Llama-3.1-8B-Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/meta-llama/llama-3.2-1b-instruct": ModelInfo(
        "Llama 3.2 1B Instruct (Openrouter)", AgentKind.OPENCODE, 60_000
    ),
    "opencode:openrouter/meta-llama/llama-3.2-3b-instruct": ModelInfo(
        "Llama 3.2 3B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/meta-llama/llama-3.3-70b-instruct": ModelInfo(
        "Llama-3.3-70B-Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/meta-llama/llama-4-maverick": ModelInfo(
        "Llama 4 Maverick (Openrouter)", AgentKind.OPENCODE, 524_288
    ),
    "opencode:openrouter/meta-llama/llama-4-scout": ModelInfo(
        "Llama 4 Scout (Openrouter)", AgentKind.OPENCODE, 1_310_720
    ),
    "opencode:openrouter/meta-llama/llama-guard-4-12b": ModelInfo(
        "Llama Guard 4 12B (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/meta/muse-glimmer-30b": ModelInfo(
        "Muse Glimmer 30B (Openrouter)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/meta/muse-spark-1.1": ModelInfo(
        "Muse Spark 1.1 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/meta/muse-spark-1.2": ModelInfo(
        "Muse Spark 1.2 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/meta/muse-spark-1.2-contributor": ModelInfo(
        "Muse Spark 1.2 Contributor (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/meta/muse-spark-1.3": ModelInfo(
        "Muse Spark 1.3 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/meta/muse-spark-1.3-contributor": ModelInfo(
        "Muse Spark 1.3 Contributor (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/meta/muse-spark-open": ModelInfo(
        "Muse Spark Open (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/meta/muse-wonder": ModelInfo(
        "Muse Wonder (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/microsoft/phi-4": ModelInfo(
        "Phi 4 (Openrouter)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:openrouter/minimax/minimax-01": ModelInfo(
        "MiniMax-01 (Openrouter)", AgentKind.OPENCODE, 1_000_192
    ),
    "opencode:openrouter/minimax/minimax-m1": ModelInfo(
        "MiniMax M1 (Openrouter)", AgentKind.OPENCODE, 1_000_000, legacy=True
    ),
    "opencode:openrouter/minimax/minimax-m2": ModelInfo(
        "MiniMax-M2 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/minimax/minimax-m2-her": ModelInfo(
        "MiniMax-M2 Her (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/minimax/minimax-m2.1": ModelInfo(
        "MiniMax-M2.1 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/minimax/minimax-m2.5": ModelInfo(
        "MiniMax-M2.5 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/minimax/minimax-m2.7": ModelInfo(
        "MiniMax-M2.7 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/minimax/minimax-m3": ModelInfo(
        "MiniMax-M3 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/minimax/minimax-m3.1-flash": ModelInfo(
        "MiniMax-M3.1-Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/mistralai/codestral-2508": ModelInfo(
        "Codestral 25.08 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/mistralai/devstral-2512": ModelInfo(
        "Devstral 2 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/ministral-14b-2512": ModelInfo(
        "Ministral 3 14B 2512 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/ministral-3b-2512": ModelInfo(
        "Ministral 3 3B 2512 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/ministral-8b-2512": ModelInfo(
        "Ministral 3 8B 2512 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/mistral-large": ModelInfo(
        "Mistral Large (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/mistralai/mistral-large-2407": ModelInfo(
        "Mistral Large 2407 (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/mistralai/mistral-large-2512": ModelInfo(
        "Mistral Large 3 (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/mistralai/mistral-large-4-0": ModelInfo(
        "Mistral Large 4 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "high"),
    ),
    "opencode:openrouter/mistralai/mistral-medium-3": ModelInfo(
        "Mistral Medium 3 (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/mistralai/mistral-medium-3-5": ModelInfo(
        "Mistral Medium 3.5 (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "high"),
    ),
    "opencode:openrouter/mistralai/mistral-medium-3.1": ModelInfo(
        "Mistral Medium 3.1 (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/mistralai/mistral-nemo": ModelInfo(
        "Mistral Nemo (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/mistral-saba": ModelInfo(
        "Saba (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/mistralai/mistral-small-24b-instruct-2501": ModelInfo(
        "Mistral Small 3 (Openrouter)", AgentKind.OPENCODE, 32_768, legacy=True
    ),
    "opencode:openrouter/mistralai/mistral-small-2603": ModelInfo(
        "Mistral Small 4 (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "high"),
    ),
    "opencode:openrouter/mistralai/mistral-small-3.1-24b-instruct": ModelInfo(
        "Mistral Small 3.1 24B (Openrouter)", AgentKind.OPENCODE, 128_000, legacy=True
    ),
    "opencode:openrouter/mistralai/mistral-small-3.2-24b-instruct": ModelInfo(
        "Mistral Small 3.2 24B (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/mistralai/mixtral-8x22b-instruct": ModelInfo(
        "Mixtral 8x22B Instruct (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/mistralai/voxtral-small-24b-2507": ModelInfo(
        "Voxtral Small 24B 2507 (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/moondream/moondream3-preview": ModelInfo(
        "Moondream 3 Preview (Openrouter)", AgentKind.OPENCODE, 32_000
    ),
    "opencode:openrouter/moondream/moondream3.1-9b-a2b": ModelInfo(
        "Moondream 3.1 (Openrouter)", AgentKind.OPENCODE, 32_000
    ),
    "opencode:openrouter/moonshotai/kimi-k2": ModelInfo(
        "Kimi K2 0711 (Openrouter)", AgentKind.OPENCODE, 131_072, legacy=True
    ),
    "opencode:openrouter/moonshotai/kimi-k2-0905": ModelInfo(
        "Kimi K2 Instruct 0905 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2-thinking": ModelInfo(
        "Kimi K2 Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2.5": ModelInfo(
        "Kimi K2.5 (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/moonshotai/kimi-k2.6": ModelInfo(
        "Kimi K2.6 (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/moonshotai/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k3": ModelInfo(
        "Kimi K3 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/moonshotai/kimi-k3.1-pro": ModelInfo(
        "Kimi K3.1 Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/morph/morph-v3-fast": ModelInfo(
        "Morph V3 Fast (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/morph/morph-v3-large": ModelInfo(
        "Morph V3 Large (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nex-agi/nex-n2.5-mini": ModelInfo(
        "Nex-N2.5-Mini (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "medium", "high"),
    ),
    "opencode:openrouter/nex-agi/nex-n2.5-pro": ModelInfo(
        "Nex-N2.5-Pro (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "medium", "high"),
    ),
    "opencode:openrouter/nousresearch/hermes-4-405b": ModelInfo(
        "Hermes 4 405B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nvidia/nemotron-3-nano-30b-a3b": ModelInfo(
        "Nemotron 3 Nano 30B A3B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": ModelInfo(
        "Nemotron 3 Nano Omni (free) (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/nvidia/nemotron-3-super-120b-a12b": ModelInfo(
        "Nemotron 3 Super 120B A12B (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "low", "medium"),
    ),
    "opencode:openrouter/nvidia/nemotron-3-super-120b-a12b:free": ModelInfo(
        "Nemotron 3 Super (free) (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "low", "medium"),
    ),
    "opencode:openrouter/nvidia/nemotron-3-ultra-550b-a55b": ModelInfo(
        "Nemotron 3 Ultra 550B A55B (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "medium", "high"),
    ),
    "opencode:openrouter/nvidia/nemotron-3-ultra-550b-a55b:free": ModelInfo(
        "Nemotron 3 Ultra (free) (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("none", "medium", "high"),
    ),
    "opencode:openrouter/nvidia/nemotron-3.5-content-safety": ModelInfo(
        "Nemotron 3.5 Content Safety (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nvidia/nemotron-3.5-content-safety:free": ModelInfo(
        "Nemotron 3.5 Content Safety (free) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/nvidia/nemotron-3.5-lightning": ModelInfo(
        "Nemotron 3.5 Lightning 30B A3B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nvidia/nemotron-3.5-lightning:free": ModelInfo(
        "Nemotron 3.5 Lightning (free) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/nvidia/nemotron-3.5-super-vl": ModelInfo(
        "Nemotron 3.5 Super VL (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/nvidia/nemotron-3.5-super-vl:free": ModelInfo(
        "Nemotron 3.5 Super VL (free) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/openai/gpt-3.5-turbo-0613": ModelInfo(
        "GPT-3.5 Turbo (older v0613) (Openrouter)",
        AgentKind.OPENCODE,
        4_095,
        legacy=True,
    ),
    "opencode:openrouter/openai/gpt-3.5-turbo-16k": ModelInfo(
        "GPT-3.5 Turbo 16k (Openrouter)", AgentKind.OPENCODE, 16_385
    ),
    "opencode:openrouter/openai/gpt-4": ModelInfo(
        "GPT-4 (Openrouter)", AgentKind.OPENCODE, 8_191, legacy=True
    ),
    "opencode:openrouter/openai/gpt-4-turbo": ModelInfo(
        "GPT-4 Turbo (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4.1": ModelInfo(
        "GPT-4.1 (Openrouter)", AgentKind.OPENCODE, 1_047_576, legacy=True
    ),
    "opencode:openrouter/openai/gpt-4.1-mini": ModelInfo(
        "GPT-4.1 mini (Openrouter)", AgentKind.OPENCODE, 1_047_576, legacy=True
    ),
    "opencode:openrouter/openai/gpt-4.1-nano": ModelInfo(
        "GPT-4.1 nano (Openrouter)", AgentKind.OPENCODE, 1_047_576, legacy=True
    ),
    "opencode:openrouter/openai/gpt-4o": ModelInfo(
        "GPT-4o (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4o-2024-05-13": ModelInfo(
        "GPT-4o (2024-05-13) (Openrouter)", AgentKind.OPENCODE, 128_000, legacy=True
    ),
    "opencode:openrouter/openai/gpt-4o-2024-08-06": ModelInfo(
        "GPT-4o (2024-08-06) (Openrouter)", AgentKind.OPENCODE, 128_000, legacy=True
    ),
    "opencode:openrouter/openai/gpt-4o-2024-11-20": ModelInfo(
        "GPT-4o (2024-11-20) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4o-mini": ModelInfo(
        "GPT-4o mini (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4o-mini-2024-07-18": ModelInfo(
        "GPT-4o-mini (2024-07-18) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-5": ModelInfo(
        "GPT-5 (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-5-image": ModelInfo(
        "GPT-5 Image (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-image-mini": ModelInfo(
        "GPT-5 Image Mini (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-mini": ModelInfo(
        "GPT-5 Mini (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-5-nano": ModelInfo(
        "GPT-5 Nano (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-5-pro": ModelInfo(
        "GPT-5 Pro (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("high",),
    ),
    "opencode:openrouter/openai/gpt-5.1": ModelInfo(
        "GPT-5.1 (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-5.1-codex": ModelInfo(
        "GPT-5.1 Codex (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-5.1-codex-max": ModelInfo(
        "GPT-5.1 Codex Max (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.1-codex-mini": ModelInfo(
        "GPT-5.1 Codex mini (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-5.2": ModelInfo(
        "GPT-5.2 (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.2-chat": ModelInfo(
        "GPT-5.2 Chat (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-5.2-codex": ModelInfo(
        "GPT-5.2 Codex (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.2-pro": ModelInfo(
        "GPT-5.2 Pro (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        legacy=True,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.4": ModelInfo(
        "GPT-5.4 (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.4-image-2": ModelInfo(
        "GPT-5.4 Image 2 (Openrouter)",
        AgentKind.OPENCODE,
        272_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 mini (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 nano (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.4-pro": ModelInfo(
        "GPT-5.4 Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.5": ModelInfo(
        "GPT-5.5 (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.5-pro": ModelInfo(
        "GPT-5.5 Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("medium", "high", "xhigh"),
    ),
    "opencode:openrouter/openai/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-5.6-luna-pro": ModelInfo(
        "GPT-5.6 Luna Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-5.6-sol-pro": ModelInfo(
        "GPT-5.6 Sol Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-5.6-terra-pro": ModelInfo(
        "GPT-5.6 Terra Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6-astra": ModelInfo(
        "GPT-6 Astra (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6-astra-pro": ModelInfo(
        "GPT-6 Astra Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6-luna": ModelInfo(
        "GPT-6 Luna (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6-luna-pro": ModelInfo(
        "GPT-6 Luna Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6-sol": ModelInfo(
        "GPT-6 Sol (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6-sol-pro": ModelInfo(
        "GPT-6 Sol Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6.1-sol-pro": ModelInfo(
        "GPT-6.1 Sol Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6.1-terra": ModelInfo(
        "GPT-6.1 Terra (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-6.1-terra-pro": ModelInfo(
        "GPT-6.1 Terra Pro (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/openai/gpt-audio": ModelInfo(
        "GPT Audio (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-audio-mini": ModelInfo(
        "GPT Audio Mini (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-chat-latest": ModelInfo(
        "GPT Chat Latest (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-oss-120b": ModelInfo(
        "GPT OSS 120B (Openrouter)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-oss-20b": ModelInfo(
        "GPT OSS 20B (Openrouter)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/openai/gpt-oss-safeguard-20b": ModelInfo(
        "GPT OSS Safeguard 20B (Openrouter)",
        AgentKind.OPENCODE,
        131_072,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/openai/o1": ModelInfo(
        "o1 (Openrouter)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:openrouter/openai/o1-pro": ModelInfo(
        "o1-pro (Openrouter)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:openrouter/openai/o3": ModelInfo(
        "o3 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o3-mini": ModelInfo(
        "o3-mini (Openrouter)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:openrouter/openai/o3-mini-high": ModelInfo(
        "o3 Mini High (Openrouter)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("high",),
    ),
    "opencode:openrouter/openai/o3-pro": ModelInfo(
        "o3-pro (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o4-mini": ModelInfo(
        "o4-mini (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o4-mini-high": ModelInfo(
        "o4 Mini High (Openrouter)",
        AgentKind.OPENCODE,
        200_000,
        effort_levels=("high",),
    ),
    "opencode:openrouter/openrouter/auto": ModelInfo(
        "Auto Router (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/openrouter/bodybuilder": ModelInfo(
        "Body Builder (beta) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openrouter/free": ModelInfo(
        "Free Models Router (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openrouter/fusion": ModelInfo(
        "Fusion (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/openrouter/pareto-code": ModelInfo(
        "Pareto Code Router (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/perceptron/perceptron-mk1": ModelInfo(
        "Perceptron Mk1 (Openrouter)", AgentKind.OPENCODE, 32_768, legacy=True
    ),
    "opencode:openrouter/perceptron/perceptron-mk1.5": ModelInfo(
        "Perceptron Mk1.5 (Openrouter)",
        AgentKind.OPENCODE,
        36_864,
        effort_levels=("none", "minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/perplexity/sonar": ModelInfo(
        "Sonar (Openrouter)", AgentKind.OPENCODE, 127_072
    ),
    "opencode:openrouter/perplexity/sonar-deep-research": ModelInfo(
        "Sonar Deep Research (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/perplexity/sonar-pro": ModelInfo(
        "Sonar Pro (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/perplexity/sonar-pro-search": ModelInfo(
        "Sonar Pro Search (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/perplexity/sonar-reasoning-pro": ModelInfo(
        "Sonar Reasoning Pro (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/prism-ml/ternary-bonsai-2-27b": ModelInfo(
        "Ternary Bonsai 2 27B (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "medium", "xhigh"),
    ),
    "opencode:openrouter/qwen/qwen-2.5-72b-instruct": ModelInfo(
        "Qwen2.5 72B Instruct (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/qwen/qwen-2.5-7b-instruct": ModelInfo(
        "Qwen2.5 7B Instruct (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/qwen/qwen-2.5-coder-32b-instruct": ModelInfo(
        "Qwen2.5 Coder 32B Instruct (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/qwen/qwen-plus": ModelInfo(
        "Qwen Plus (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen2.5-vl-72b-instruct": ModelInfo(
        "Qwen2.5 VL 72B Instruct (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/qwen/qwen3-14b": ModelInfo(
        "Qwen3 14B (Openrouter)", AgentKind.OPENCODE, 40_960
    ),
    "opencode:openrouter/qwen/qwen3-235b-a22b-2507": ModelInfo(
        "Qwen3 235B A22B Instruct 2507 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-235b-a22b-thinking-2507": ModelInfo(
        "Qwen3 235B A22B Thinking 2507 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/qwen/qwen3-30b-a3b": ModelInfo(
        "Qwen3 30B A3B (Openrouter)", AgentKind.OPENCODE, 40_960
    ),
    "opencode:openrouter/qwen/qwen3-30b-a3b-instruct-2507": ModelInfo(
        "Qwen3 30B A3B Instruct 2507 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-32b": ModelInfo(
        "Qwen3 32B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-coder": ModelInfo(
        "Qwen3 Coder 480B A35B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-coder-30b-a3b-instruct": ModelInfo(
        "Qwen3-Coder 30B-A3B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-coder-flash": ModelInfo(
        "Qwen3 Coder Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3-coder-next": ModelInfo(
        "Qwen3 Coder Next (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-next-80b-a3b-instruct": ModelInfo(
        "Qwen3-Next 80B-A3B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-next-80b-a3b-thinking": ModelInfo(
        "Qwen3-Next 80B-A3B (Thinking) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-vl-235b-a22b-instruct": ModelInfo(
        "Qwen3 VL 235B A22B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-vl-30b-a3b-instruct": ModelInfo(
        "Qwen3 VL 30B A3B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-vl-30b-a3b-thinking": ModelInfo(
        "Qwen3 VL 30B A3B Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-vl-8b-instruct": ModelInfo(
        "Qwen3 VL 8B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-122b-a10b": ModelInfo(
        "Qwen3.5 122B-A10B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-27b": ModelInfo(
        "Qwen3.5 27B (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.5-35b-a3b": ModelInfo(
        "Qwen3.5 35B-A3B (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.5-397b-a17b": ModelInfo(
        "Qwen3.5 397B-A17B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-flash-02-23": ModelInfo(
        "Qwen3.5-Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.5-plus-02-15": ModelInfo(
        "Qwen3.5 Plus 2026-02-15 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
    ),
    "opencode:openrouter/qwen/qwen3.5-plus-20260420": ModelInfo(
        "Qwen3.5 Plus 2026-04-20 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
    ),
    "opencode:openrouter/qwen/qwen3.6-27b": ModelInfo(
        "Qwen3.6 27B (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.6-35b-a3b": ModelInfo(
        "Qwen3.6 35B-A3B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.6-flash": ModelInfo(
        "Qwen3.6 Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.6-plus": ModelInfo(
        "Qwen3.6 Plus (Openrouter)", AgentKind.OPENCODE, 1_000_000, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.7-flash": ModelInfo(
        "Qwen3.7 Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.7-max": ModelInfo(
        "Qwen3.7 Max (Openrouter)", AgentKind.OPENCODE, 1_000_000, legacy=True
    ),
    "opencode:openrouter/qwen/qwen3.7-plus": ModelInfo(
        "Qwen3.7 Plus (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.8-2.4t-a95b": ModelInfo(
        "Qwen3.8 2.4T A95B (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "xhigh"),
    ),
    "opencode:openrouter/qwen/qwen3.8-27b": ModelInfo(
        "Qwen3.8 27B (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("none", "low", "medium", "xhigh"),
    ),
    "opencode:openrouter/qwen/qwen3.8-flash": ModelInfo(
        "Qwen3.8 Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.8-max-0902": ModelInfo(
        "Qwen3.8 Max 0902 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/qwen/qwen3.8-max-prime": ModelInfo(
        "Qwen 3.8 Max Prime (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("minimal", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/qwen/qwen3.8-omni-flash": ModelInfo(
        "Qwen3.8 Omni Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/recursive/flint-v1.0:free": ModelInfo(
        "Flint (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/reflection/beam-1.0-501b-a23b": ModelInfo(
        "Beam 1.0 501B A23B (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/rekaai/reka-edge": ModelInfo(
        "Reka Edge (Openrouter)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:openrouter/rekaai/reka-flash-3": ModelInfo(
        "Reka Flash 3 (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/relace/relace-apply-3": ModelInfo(
        "Relace Apply 3 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/relace/relace-search": ModelInfo(
        "Relace Search (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/sakana/fugu-max": ModelInfo(
        "Fugu Max (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("high", "xhigh", "max"),
    ),
    "opencode:openrouter/sakana/fugu-ultra": ModelInfo(
        "Fugu Ultra (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("high", "xhigh", "max"),
    ),
    "opencode:openrouter/sakana/fugu-ultra-v2": ModelInfo(
        "Fugu Ultra v2 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("high", "xhigh", "max"),
    ),
    "opencode:openrouter/sakana/sakana-namazu": ModelInfo(
        "Sakana Namazu (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("none", "high"),
    ),
    "opencode:openrouter/sao10k/l3-lunaris-8b": ModelInfo(
        "Llama 3 8B Lunaris (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/sao10k/l3.1-euryale-70b": ModelInfo(
        "Llama 3.1 Euryale 70B v2.2 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/scaledown/extract": ModelInfo(
        "Extract (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/scaledown/summarize": ModelInfo(
        "Summarize (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/stepfun/step-3.5-flash": ModelInfo(
        "Step 3.5 Flash (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/stepfun/step-3.7-flash": ModelInfo(
        "Step 3.7 Flash (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/stepfun/step-5-preview": ModelInfo(
        "Step 5 Preview (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/tencent/hunyuan-a13b-instruct": ModelInfo(
        "Hunyuan A13B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/tencent/hy-mt2-1.8b": ModelInfo(
        "Hy-MT2-1.8B (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/tencent/hy-mt2-30b-a3b": ModelInfo(
        "Hy-MT2-30B-A3B (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/tencent/hy-mt2-7b": ModelInfo(
        "Hy-MT2-7B (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/tencent/hy3": ModelInfo(
        "Hy3 (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        legacy=True,
        effort_levels=("none", "low", "high"),
    ),
    "opencode:openrouter/tencent/hy3-preview": ModelInfo(
        "Hy3 preview (Openrouter)",
        AgentKind.OPENCODE,
        262_144,
        legacy=True,
        effort_levels=("none", "low", "high"),
    ),
    "opencode:openrouter/tencent/hy4-preview": ModelInfo(
        "Hy4 preview (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high"),
    ),
    "opencode:openrouter/thedrummer/cydonia-24b-v4.1": ModelInfo(
        "Cydonia 24B V4.1 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/thedrummer/skyfall-36b-v2": ModelInfo(
        "Skyfall 36B V2 (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/thedrummer/unslopnemo-12b": ModelInfo(
        "UnslopNemo 12B (Openrouter)", AgentKind.OPENCODE, 1_024_000
    ),
    "opencode:openrouter/thinkingmachines/inkling": ModelInfo(
        "Inkling (Openrouter)",
        AgentKind.OPENCODE,
        524_288,
        effort_levels=("none", "minimal", "low", "medium", "high", "max"),
    ),
    "opencode:openrouter/thinkingmachines/inkling-small": ModelInfo(
        "Inkling Small (Openrouter)",
        AgentKind.OPENCODE,
        524_288,
        effort_levels=("none", "minimal", "low", "medium", "high", "max"),
    ),
    "opencode:openrouter/thinkingmachines/inkling-small:free": ModelInfo(
        "Inkling Small (free) (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "minimal", "low", "medium", "high", "max"),
    ),
    "opencode:openrouter/thinkingmachines/inkling:free": ModelInfo(
        "Inkling (free) (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "minimal", "low", "medium", "high", "max"),
    ),
    "opencode:openrouter/unbiased/pareto-26.10": ModelInfo(
        "Pareto 26.10 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/unbiased/pareto-26.9": ModelInfo(
        "Pareto 26.9 (Openrouter)", AgentKind.OPENCODE, 262_144, legacy=True
    ),
    "opencode:openrouter/undi95/remm-slerp-l2-13b": ModelInfo(
        "ReMM SLERP 13B (Openrouter)", AgentKind.OPENCODE, 6_144
    ),
    "opencode:openrouter/upstage/solar-mini4": ModelInfo(
        "Solar Mini 4 (Openrouter)",
        AgentKind.OPENCODE,
        524_288,
        effort_levels=("none", "minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/upstage/solar-pro-3": ModelInfo(
        "Solar Pro 3 (Openrouter)",
        AgentKind.OPENCODE,
        131_072,
        legacy=True,
        effort_levels=("none", "minimal", "low", "medium", "high"),
    ),
    "opencode:openrouter/upstage/solar-pro4": ModelInfo(
        "Solar Pro 4 (Openrouter)",
        AgentKind.OPENCODE,
        524_288,
        effort_levels=("none", "minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/writer/palmyra-x5": ModelInfo(
        "Palmyra X5 (Openrouter)", AgentKind.OPENCODE, 1_040_000
    ),
    "opencode:openrouter/x-ai/grok-4.20": ModelInfo(
        "Grok 4.20 (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/x-ai/grok-4.20-multi-agent": ModelInfo(
        "Grok 4.20 Multi-Agent (Openrouter)",
        AgentKind.OPENCODE,
        2_000_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/x-ai/grok-4.3": ModelInfo(
        "Grok 4.3 (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        legacy=True,
        effort_levels=("none", "low", "medium", "high"),
    ),
    "opencode:openrouter/x-ai/grok-4.5": ModelInfo(
        "Grok 4.5 (Openrouter)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/x-ai/grok-4.6": ModelInfo(
        "Grok 4.6 (Openrouter)",
        AgentKind.OPENCODE,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/x-ai/grok-4.7": ModelInfo(
        "Grok 4.7 (Openrouter)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/x-ai/grok-build-0.1": ModelInfo(
        "Grok Build 0.1 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/xiaomi/mimo-v2.6-flash": ModelInfo(
        "MiMo-V2.6-Flash (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/xiaomi/mimo-v2.6-pro": ModelInfo(
        "MiMo-V2.6-Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/xiaomi/mimo-v2.6-pro-ultraspeed": ModelInfo(
        "MiMo-V2.6-Pro-UltraSpeed (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/xingchen-agi/xing4.0-29b-a4b:free": ModelInfo(
        "Xing4.0 29B A4B (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/z-ai/glm-4.5-air": ModelInfo(
        "GLM-4.5-Air (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/z-ai/glm-4.5v": ModelInfo(
        "GLM-4.5V (Openrouter)", AgentKind.OPENCODE, 65_536, legacy=True
    ),
    "opencode:openrouter/z-ai/glm-4.6": ModelInfo(
        "GLM-4.6 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/z-ai/glm-4.6v": ModelInfo(
        "GLM-4.6V (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/z-ai/glm-4.7": ModelInfo(
        "GLM-4.7 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/z-ai/glm-4.7-flash": ModelInfo(
        "GLM-4.7-Flash (Openrouter)", AgentKind.OPENCODE, 200_000, legacy=True
    ),
    "opencode:openrouter/z-ai/glm-5": ModelInfo(
        "GLM-5 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/z-ai/glm-5-turbo": ModelInfo(
        "GLM-5-Turbo (Openrouter)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:openrouter/z-ai/glm-5.1": ModelInfo(
        "GLM-5.1 (Openrouter)", AgentKind.OPENCODE, 204_800, legacy=True
    ),
    "opencode:openrouter/z-ai/glm-5.2": ModelInfo(
        "GLM-5.2 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        legacy=True,
        effort_levels=("none", "high", "xhigh"),
    ),
    "opencode:openrouter/z-ai/glm-5.3": ModelInfo(
        "GLM-5.3 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:openrouter/z-ai/glm-5.3-flash": ModelInfo(
        "GLM-5.3-Flash (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:openrouter/z-ai/glm-5.3-flashx": ModelInfo(
        "GLM 5.3 FlashX (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:openrouter/z-ai/glm-5.3-prime": ModelInfo(
        "GLM 5.3 Prime (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:openrouter/z-ai/glm-5v-turbo": ModelInfo(
        "GLM-5V-Turbo (Openrouter)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:openrouter/~anthropic/claude-fable-latest": ModelInfo(
        "Claude Fable Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~anthropic/claude-haiku-latest": ModelInfo(
        "Claude Haiku Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~anthropic/claude-opus-latest": ModelInfo(
        "Claude Opus Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~anthropic/claude-sonnet-latest": ModelInfo(
        "Claude Sonnet Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~deepseek/deepseek-flash-latest": ModelInfo(
        "DeepSeek Flash Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/~deepseek/deepseek-pro-latest": ModelInfo(
        "DeepSeek Pro Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/~deepseek/deepseek-v4-flash-latest": ModelInfo(
        "DeepSeek V4 Flash Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/~google/gemini-flash-latest": ModelInfo(
        "Gemini Flash Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/~google/gemini-pro-latest": ModelInfo(
        "Gemini Pro Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:openrouter/~moonshotai/kimi-latest": ModelInfo(
        "Kimi Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("none", "low", "high", "max"),
    ),
    "opencode:openrouter/~openai/gpt-astra-latest": ModelInfo(
        "GPT Astra Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~openai/gpt-luna-latest": ModelInfo(
        "GPT Luna Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~openai/gpt-mini-latest": ModelInfo(
        "GPT Mini Latest (Openrouter)",
        AgentKind.OPENCODE,
        400_000,
        effort_levels=("none", "low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/~openai/gpt-sol-latest": ModelInfo(
        "GPT Sol Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~openai/gpt-terra-latest": ModelInfo(
        "GPT Terra Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("none", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:openrouter/~unbiased/pareto-latest": ModelInfo(
        "Pareto Latest (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/~x-ai/grok-latest": ModelInfo(
        "Grok Latest (Openrouter)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:openrouter/~z-ai/glm-flash-latest": ModelInfo(
        "GLM Flash Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:openrouter/~z-ai/glm-latest": ModelInfo(
        "GLM Latest (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-fable-5": ModelInfo(
        "Claude Fable 5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-fable-5-1": ModelInfo(
        "Claude Fable 5.1 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-haiku-4-5": ModelInfo(
        "Claude Haiku 4.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        200_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-haiku-5-5": ModelInfo(
        "Claude Haiku 5.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-4-5": ModelInfo(
        "Claude Opus 4.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-4-6": ModelInfo(
        "Claude Opus 4.6 (Perplexity Agent)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-5": ModelInfo(
        "Claude Opus 5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-5-5": ModelInfo(
        "Claude Opus 5.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-sonnet-4-5": ModelInfo(
        "Claude Sonnet 4.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        200_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Perplexity Agent)",
        AgentKind.OPENCODE,
        200_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/anthropic/claude-sonnet-5-5": ModelInfo(
        "Claude Sonnet 5.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/google/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/google/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high"),
    ),
    "opencode:perplexity-agent/google/gemini-3.7-flash": ModelInfo(
        "Gemini 3.7 Flash (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:perplexity-agent/google/gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:perplexity-agent/google/gemini-4-argon": ModelInfo(
        "Gemini 4 Argon (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high"),
    ),
    "opencode:perplexity-agent/openai/gpt-5.5": ModelInfo(
        "GPT-5.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/openai/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/openai/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/openai/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/openai/gpt-6-astra": ModelInfo(
        "GPT-6 Astra (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/openai/gpt-6-luna": ModelInfo(
        "GPT-6 Luna (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/openai/gpt-6-sol": ModelInfo(
        "GPT-6 Sol (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/openai/gpt-6.1-sol": ModelInfo(
        "GPT-6.1 Sol (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_050_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/perplexity/deepseek-v4-pro-0813": ModelInfo(
        "DeepSeek V4 Pro 0813 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:perplexity-agent/perplexity/glm-5.3": ModelInfo(
        "GLM-5.3 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:perplexity-agent/perplexity/glm-5.3-flash": ModelInfo(
        "GLM-5.3-Flash (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:perplexity-agent/perplexity/kimi-k3": ModelInfo(
        "Kimi K3 (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/perplexity/nemotron-3.5-super-120b-a12b": ModelInfo(
        "Nemotron 3.5 Super 120B A12B (Perplexity Agent)",
        AgentKind.OPENCODE,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "opencode:perplexity-agent/perplexity/sonar": ModelInfo(
        "Sonar (Perplexity Agent)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:perplexity-agent/xai/grok-4.5": ModelInfo(
        "Grok 4.5 (Perplexity Agent)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:perplexity-agent/xai/grok-4.6": ModelInfo(
        "Grok 4.6 (Perplexity Agent)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:perplexity-agent/xai/grok-4.7": ModelInfo(
        "Grok 4.7 (Perplexity Agent)",
        AgentKind.OPENCODE,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "opencode:zai-coding-plan/glm-5.3": ModelInfo(
        "GLM-5.3 (Zai Coding Plan)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:zai-coding-plan/glm-5.3-flash": ModelInfo(
        "GLM-5.3-Flash (Zai Coding Plan)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
    "opencode:zai-coding-plan/glm-5.3-highspeed": ModelInfo(
        "GLM-5.3 Highspeed (Zai Coding Plan)",
        AgentKind.OPENCODE,
        1_000_000,
        effort_levels=("low", "high", "max"),
    ),
}

# Built-in slash commands per agent kind for the frontend. Claude/Codex lists
# are filtered ACP-exposed subsets (not full CLI/TUI chrome); skills are runtime.
# Codex omits logout — too easy to hit from chat autocomplete.
BUILTIN_SLASH_COMMANDS: dict[AgentKind, list[dict[str, str]]] = {
    AgentKind.ANTIGRAVITY: [],
    AgentKind.CLAUDE: [
        {
            "value": "/compact",
            "label": "Compact",
            "description": "Free up context by summarizing the conversation so far. Optional: /compact [instructions for summarization]",
        },
        {
            "value": "/clear",
            "label": "Clear",
            "description": "Start a new session with empty context; previous session stays on disk (resumable with /resume)",
        },
        {
            "value": "/review",
            "label": "Review",
            "description": "Review a GitHub pull request; for your working diff use /code-review",
        },
        {
            "value": "/code-review",
            "label": "Code Review",
            "description": "Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups. Optional: /code-review [low|medium|high|xhigh|max] [--fix] [--comment] [target]",
        },
        {
            "value": "/security-review",
            "label": "Security Review",
            "description": "Complete a security review of the pending changes on the current branch",
        },
        {
            "value": "/simplify",
            "label": "Simplify",
            "description": "Review changed code for reuse, simplification, efficiency, and altitude cleanups, then apply the fixes",
        },
        {
            "value": "/init",
            "label": "Init",
            "description": "Initialize a new CLAUDE.md file with codebase documentation",
        },
        {
            "value": "/debug",
            "label": "Debug",
            "description": "Enable debug logging for this session and help diagnose issues",
        },
        {
            "value": "/doctor",
            "label": "Doctor",
            "description": "Health-check the Claude Code setup and fix installation, settings, and configuration issues",
        },
        {
            "value": "/insights",
            "label": "Insights",
            "description": "Generate a report analyzing your Claude Code sessions",
        },
        {
            "value": "/recap",
            "label": "Recap",
            "description": "Generate a one-line session recap now",
        },
        {
            "value": "/loop",
            "label": "Loop",
            "description": "Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)",
        },
        {
            "value": "/batch",
            "label": "Batch",
            "description": "Research and plan a large-scale change, then execute it in parallel across isolated worktree agents that each open a PR",
        },
        {
            "value": "/deep-research",
            "label": "Deep Research",
            "description": "Fan out web searches, fetch and cross-check sources, and synthesize a cited report",
        },
        {
            "value": "/verify",
            "label": "Verify",
            "description": "Verify a code change end-to-end by driving the affected flow, not just tests or typecheck",
        },
        {
            "value": "/run",
            "label": "Run",
            "description": "Launch and drive this project's app to see a change working",
        },
        {
            "value": "/run-skill-generator",
            "label": "Run Skill Generator",
            "description": "Author or improve a per-project run skill that tells agents how to build, launch, and drive this app",
        },
        {
            "value": "/goal",
            "label": "Goal",
            "description": "Set a goal — keep working until the condition is met",
        },
        {
            "value": "/update-config",
            "label": "Update Config",
            "description": "Configure Claude Code settings via settings.json (permissions, hooks, env vars)",
        },
        {
            "value": "/claude-api",
            "label": "Claude API",
            "description": "Build apps with the Claude API or Anthropic SDK",
        },
        {
            "value": "/dataviz",
            "label": "Data Viz",
            "description": "Design guidance for charts, graphs, and dashboards",
        },
        {
            "value": "/fewer-permission-prompts",
            "label": "Fewer Permission Prompts",
            "description": "Scan transcripts for common read-only tool calls and add a project allowlist to reduce permission prompts",
        },
        {
            "value": "/team-onboarding",
            "label": "Team Onboarding",
            "description": "Help teammates ramp on Claude Code with a guide from your usage",
        },
        {
            "value": "/reload-skills",
            "label": "Reload Skills",
            "description": "Pick up skills added or changed on disk during this session",
        },
    ],
    AgentKind.CODEX: [
        {
            "value": "/review",
            "label": "Review",
            "description": "Review uncommitted changes, or review with custom instructions",
        },
        {
            "value": "/review-branch",
            "label": "Review Branch",
            "description": "Review changes relative to a base branch",
        },
        {
            "value": "/review-commit",
            "label": "Review Commit",
            "description": "Review a specific commit",
        },
        {
            "value": "/compact",
            "label": "Compact",
            "description": "Summarize conversation to avoid hitting the context limit",
        },
        {
            "value": "/status",
            "label": "Status",
            "description": "Display session configuration and token usage",
        },
        {
            "value": "/goal",
            "label": "Goal",
            "description": "Set, pause, resume, or clear a task goal",
        },
        {
            "value": "/mcp",
            "label": "MCP",
            "description": "List configured Model Context Protocol (MCP) tools",
        },
        {
            "value": "/skills",
            "label": "Skills",
            "description": "List available skills",
        },
    ],
    AgentKind.COPILOT: [
        {"value": "/model", "label": "Model", "description": "Select the active model"},
        {
            "value": "/compact",
            "label": "Compact",
            "description": "Clear conversation history but keep a summary in context",
        },
        {
            "value": "/context",
            "label": "Context",
            "description": "Show context window token usage and visualization",
        },
        {
            "value": "/usage",
            "label": "Usage",
            "description": "Display session usage metrics and statistics",
        },
        {"value": "/review", "label": "Review", "description": "Review a pull request"},
        {
            "value": "/diff",
            "label": "Diff",
            "description": "Review the changes made in the current directory",
        },
        {
            "value": "/pr",
            "label": "PR",
            "description": "Operate on pull requests for the current branch",
        },
        {
            "value": "/init",
            "label": "Init",
            "description": "Initialize project configuration",
        },
        {
            "value": "/agent",
            "label": "Agent",
            "description": "Browse and select from available agents",
        },
        {
            "value": "/skills",
            "label": "Skills",
            "description": "Manage skills for enhanced capabilities",
        },
        {
            "value": "/mcp",
            "label": "MCP",
            "description": "Manage MCP server configuration",
        },
        {
            "value": "/plugin",
            "label": "Plugin",
            "description": "Manage plugins and plugin marketplaces",
        },
        {
            "value": "/session",
            "label": "Session",
            "description": "View and manage sessions",
        },
        {
            "value": "/tasks",
            "label": "Tasks",
            "description": "View and manage background tasks",
        },
        {
            "value": "/delegate",
            "label": "Delegate",
            "description": "Send this session to GitHub and create a PR",
        },
        {
            "value": "/fleet",
            "label": "Fleet",
            "description": "Enable parallel subagent execution",
        },
        {
            "value": "/allow-all",
            "label": "Allow All",
            "description": "Enable all permissions for the session",
        },
    ],
    # Cursor slash commands are TUI-only; ACP would treat them as prompt text.
    AgentKind.CURSOR: [],
    # Grok advertises commands via availableCommands — runtime discovery only.
    AgentKind.GROK: [],
    # OpenCode slash commands are TUI-only; ACP surfaces user-defined ones.
    AgentKind.OPENCODE: [],
}
