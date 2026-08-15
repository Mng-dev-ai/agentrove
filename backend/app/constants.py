from typing import Final, NamedTuple

from app.core.config import get_settings
from app.services.acp.adapters import AgentKind

settings = get_settings()


class ModelInfo(NamedTuple):
    display_name: str
    agent_kind: AgentKind
    context_window: int | None


REDIS_KEY_USER_STREAMS_LIVE: Final[str] = "user:{user_id}:streams:live"
REDIS_KEY_USER_CHATS_LIVE: Final[str] = "user:{user_id}:chats:live"
REDIS_KEY_USER_SETTINGS: Final[str] = "user_settings:{user_id}"
REDIS_KEY_CHAT_CONTEXT_USAGE: Final[str] = "chat:{chat_id}:context_usage"
REDIS_KEY_CHAT_QUEUE: Final[str] = "chat:{chat_id}:queue"
REDIS_KEY_CHAT_QUEUE_SEND_NOW: Final[str] = "chat:{chat_id}:queue:send_now"

QUEUE_MESSAGE_TTL_SECONDS: Final[int] = 3600

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
    "sonnet": ModelInfo("Sonnet", AgentKind.CLAUDE, 1_000_000),
    "haiku": ModelInfo("Haiku", AgentKind.CLAUDE, 200_000),
    "claude-fable-5": ModelInfo("Fable 5", AgentKind.CLAUDE, 1_000_000),
    "claude-opus-5": ModelInfo("Opus 5", AgentKind.CLAUDE, 1_000_000),
    # Codex CLI clamps model_context_window to its bundled catalog max — 272k for
    # these slugs — then sessions report ~95% of the resolved window (e.g. 258,400).
    # gpt-5.4's catalog max is 1M via config opt-in; raise it here once a live
    # session verifies the opt-in survives our app-server launch path.
    # Live-reported window still wins over these fallbacks.
    "gpt-5.6-sol": ModelInfo("GPT 5.6 Sol", AgentKind.CODEX, 272_000),
    "gpt-5.6-terra": ModelInfo("GPT 5.6 Terra", AgentKind.CODEX, 272_000),
    "gpt-5.6-luna": ModelInfo("GPT 5.6 Luna", AgentKind.CODEX, 272_000),
    "gpt-5.5": ModelInfo("GPT 5.5", AgentKind.CODEX, 272_000),
    "gpt-5.4": ModelInfo("GPT 5.4", AgentKind.CODEX, 272_000),
    "gpt-5.4-mini": ModelInfo("GPT 5.4 Mini", AgentKind.CODEX, 272_000),
    "gpt-5.3-codex": ModelInfo("GPT 5.3 Codex", AgentKind.CODEX, 400_000),
    "gpt-5.2-codex": ModelInfo("GPT 5.2 Codex", AgentKind.CODEX, 400_000),
    "gpt-5.2": ModelInfo("GPT 5.2", AgentKind.CODEX, 272_000),
    "gpt-5.1-codex-max": ModelInfo("GPT 5.1 Codex Max", AgentKind.CODEX, 400_000),
    "gpt-5.1-codex-mini": ModelInfo("GPT 5.1 Codex Mini", AgentKind.CODEX, 400_000),
    "copilot:auto": ModelInfo("Auto", AgentKind.COPILOT, None),
    "copilot:claude-sonnet-5": ModelInfo("Sonnet 5", AgentKind.COPILOT, 160_000),
    "copilot:claude-fable-5": ModelInfo("Fable 5", AgentKind.COPILOT, 160_000),
    "copilot:claude-opus-5": ModelInfo("Opus 5", AgentKind.COPILOT, 160_000),
    "copilot:claude-opus-4.8": ModelInfo("Opus 4.8", AgentKind.COPILOT, 160_000),
    "copilot:claude-opus-4.8-fast": ModelInfo(
        "Opus 4.8 Fast", AgentKind.COPILOT, 160_000
    ),
    "copilot:claude-opus-4.7": ModelInfo("Opus 4.7", AgentKind.COPILOT, 160_000),
    "copilot:claude-sonnet-4.6": ModelInfo("Sonnet 4.6", AgentKind.COPILOT, 160_000),
    "copilot:claude-opus-4.6": ModelInfo("Opus 4.6", AgentKind.COPILOT, 160_000),
    "copilot:claude-sonnet-4.5": ModelInfo("Sonnet 4.5", AgentKind.COPILOT, 160_000),
    "copilot:claude-opus-4.5": ModelInfo("Opus 4.5", AgentKind.COPILOT, 160_000),
    "copilot:claude-haiku-4.5": ModelInfo("Haiku 4.5", AgentKind.COPILOT, 160_000),
    "copilot:gpt-5.6-sol": ModelInfo("GPT 5.6 Sol", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.6-terra": ModelInfo("GPT 5.6 Terra", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.6-luna": ModelInfo("GPT 5.6 Luna", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.5": ModelInfo("GPT 5.5", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.4": ModelInfo("GPT 5.4", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.4-mini": ModelInfo("GPT 5.4 Mini", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.3-codex": ModelInfo("GPT 5.3 Codex", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5-mini": ModelInfo("GPT 5 Mini", AgentKind.COPILOT, 160_000),
    "copilot:mai-code-1-flash-picker": ModelInfo(
        "MAI Code 1 Flash", AgentKind.COPILOT, 128_000
    ),
    "copilot:gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash", AgentKind.COPILOT, 1_000_000
    ),
    "copilot:gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash", AgentKind.COPILOT, 1_000_000
    ),
    "copilot:gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview", AgentKind.COPILOT, 200_000
    ),
    "copilot:grok-4.5": ModelInfo("Grok 4.5", AgentKind.COPILOT, 256_000),
    "copilot:kimi-k3": ModelInfo("Kimi K3", AgentKind.COPILOT, 256_000),
    "copilot:kimi-k2.7-code": ModelInfo("Kimi K2.7 Code", AgentKind.COPILOT, 256_000),
    "cursor:auto": ModelInfo("Auto", AgentKind.CURSOR, None),
    "cursor:composer-2.5-fast": ModelInfo(
        "Composer 2.5 Fast", AgentKind.CURSOR, 200_000
    ),
    "cursor:composer-2.5": ModelInfo("Composer 2.5", AgentKind.CURSOR, 200_000),
    "cursor:composer-2-fast": ModelInfo("Composer 2", AgentKind.CURSOR, 200_000),
    "cursor:composer-1.5": ModelInfo("Composer 1.5", AgentKind.CURSOR, 200_000),
    "cursor:gpt-5.4-medium": ModelInfo("GPT 5.4", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.4-mini-medium": ModelInfo("GPT 5.4 Mini", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.4-nano-medium": ModelInfo("GPT 5.4 Nano", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.3-codex": ModelInfo("GPT 5.3 Codex", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.3-codex-spark-preview": ModelInfo(
        "Codex 5.3 Spark", AgentKind.CURSOR, 272_000
    ),
    "cursor:gpt-5.2": ModelInfo("GPT 5.2", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.2-codex": ModelInfo("GPT 5.2 Codex", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.1": ModelInfo("GPT 5.1", AgentKind.CURSOR, 272_000),
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
        "Opus 4.6 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:claude-4.5-opus-high-thinking": ModelInfo(
        "Opus 4.5 Thinking", AgentKind.CURSOR, 200_000
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
    "grok:grok-4.6": ModelInfo("Grok 4.6", AgentKind.GROK, 500_000),
    "grok:grok-4.5": ModelInfo("Grok 4.5", AgentKind.GROK, 500_000),
    "opencode:opencode/big-pickle": ModelInfo(
        "Big Pickle (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/claude-fable-5": ModelInfo(
        "Claude Fable 5 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-haiku-4-5": ModelInfo(
        "Claude Haiku 4.5 (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/claude-opus-4-1": ModelInfo(
        "Claude Opus 4.1 (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/claude-opus-4-5": ModelInfo(
        "Claude Opus 4.5 (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/claude-opus-4-6": ModelInfo(
        "Claude Opus 4.6 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-opus-5": ModelInfo(
        "Claude Opus 5 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-sonnet-4": ModelInfo(
        "Claude Sonnet 4 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-sonnet-4-5": ModelInfo(
        "Claude Sonnet 4.5 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/deepseek-v4-flash": ModelInfo(
        "DeepSeek V4 Flash (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/deepseek-v4-flash-free": ModelInfo(
        "DeepSeek V4 Flash Free (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/gemini-3-flash": ModelInfo(
        "Gemini 3 Flash (OpenCode)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode/gemini-3.1-pro": ModelInfo(
        "Gemini 3.1 Pro Preview (OpenCode)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (OpenCode)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (OpenCode)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (OpenCode)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode/glm-5": ModelInfo(
        "GLM-5 (OpenCode)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode/glm-5.1": ModelInfo(
        "GLM-5.1 (OpenCode)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode/glm-5.2": ModelInfo(
        "GLM-5.2 (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/gpt-5": ModelInfo(
        "GPT-5 (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5-codex": ModelInfo(
        "GPT-5 Codex (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5-nano": ModelInfo(
        "GPT-5 Nano (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.1": ModelInfo(
        "GPT-5.1 (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.1-codex": ModelInfo(
        "GPT-5.1 Codex (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.1-codex-max": ModelInfo(
        "GPT-5.1 Codex Max (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.1-codex-mini": ModelInfo(
        "GPT-5.1 Codex Mini (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.2": ModelInfo(
        "GPT-5.2 (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.2-codex": ModelInfo(
        "GPT-5.2 Codex (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.3-codex-spark": ModelInfo(
        "GPT-5.3 Codex Spark (OpenCode)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:opencode/gpt-5.4": ModelInfo(
        "GPT-5.4 (OpenCode)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 Mini (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 Nano (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/gpt-5.4-pro": ModelInfo(
        "GPT-5.4 Pro (OpenCode)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode/gpt-5.5": ModelInfo(
        "GPT-5.5 (OpenCode)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode/gpt-5.5-pro": ModelInfo(
        "GPT-5.5 Pro (OpenCode)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (OpenCode)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (OpenCode)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (OpenCode)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode/grok-4.5": ModelInfo(
        "Grok 4.5 (OpenCode)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:opencode/grok-4.6": ModelInfo(
        "Grok 4.6 (OpenCode)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:opencode/grok-build-0.1": ModelInfo(
        "Grok Build 0.1 (OpenCode)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:opencode/hy3-free": ModelInfo(
        "Hy3 Free (OpenCode)", AgentKind.OPENCODE, 190_000
    ),
    "opencode:opencode/kimi-k2.5": ModelInfo(
        "Kimi K2.5 (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/kimi-k2.6": ModelInfo(
        "Kimi K2.6 (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/kimi-k3": ModelInfo(
        "Kimi K3 (OpenCode)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode/laguna-s-2.1-free": ModelInfo(
        "Laguna S 2.1 Free (OpenCode)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:opencode/ling-3.0-flash-free": ModelInfo(
        "Ling-3.0-flash Free (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/ling-3.0-tiny-free": ModelInfo(
        "Ling-3.0-tiny Free (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/mimo-v2.5-free": ModelInfo(
        "MiMo V2.5 Free (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/minimax-m2.5": ModelInfo(
        "MiniMax-M2.5 (OpenCode)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode/minimax-m2.7": ModelInfo(
        "MiniMax-M2.7 (OpenCode)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode/minimax-m3": ModelInfo(
        "MiniMax-M3 (OpenCode)", AgentKind.OPENCODE, 512_000
    ),
    "opencode:opencode/nemotron-3-ultra-free": ModelInfo(
        "Nemotron 3 Ultra Free (OpenCode)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode/nemotron-3.5-lightning-free": ModelInfo(
        "Nemotron 3.5 Lightning Free (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/north-mini-code-free": ModelInfo(
        "North Mini Code Free (OpenCode)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:opencode/qwen3.5-plus": ModelInfo(
        "Qwen3.5 Plus (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode/qwen3.6-plus": ModelInfo(
        "Qwen3.6 Plus (OpenCode)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/deepseek-v4-flash": ModelInfo(
        "DeepSeek V4 Flash (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/glm-5.1": ModelInfo(
        "GLM-5.1 (Opencode Go)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:opencode-go/glm-5.2": ModelInfo(
        "GLM-5.2 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (2x usage) (Opencode Go)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:opencode-go/grok-4.5": ModelInfo(
        "Grok 4.5 (Opencode Go)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:opencode-go/hy3": ModelInfo(
        "Hy3 (Opencode Go)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:opencode-go/kimi-k2.6": ModelInfo(
        "Kimi K2.6 (Opencode Go)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (Opencode Go)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/kimi-k3": ModelInfo(
        "Kimi K3 (Opencode Go)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode-go/mimo-v2.5": ModelInfo(
        "MiMo V2.5 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/mimo-v2.5-pro": ModelInfo(
        "MiMo V2.5 Pro (Opencode Go)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode-go/minimax-m2.7": ModelInfo(
        "MiniMax-M2.7 (Opencode Go)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode-go/minimax-m3": ModelInfo(
        "MiniMax-M3 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/qwen3.6-plus": ModelInfo(
        "Qwen3.6 Plus (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/qwen3.7-max": ModelInfo(
        "Qwen3.7 Max (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/qwen3.7-plus": ModelInfo(
        "Qwen3.7 Plus (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/qwen3.8-max": ModelInfo(
        "Qwen3.8 Max (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/amazon.nova-2-lite-v1:0": ModelInfo(
        "Nova 2 Lite (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/amazon.nova-lite-v1:0": ModelInfo(
        "Nova Lite (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/amazon.nova-micro-v1:0": ModelInfo(
        "Nova Micro (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/amazon.nova-pro-v1:0": ModelInfo(
        "Nova Pro (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (AU) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-4-6-v1": ModelInfo(
        "AU Anthropic Claude Opus 4.6 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (AU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (AU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (AU) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-sonnet-4-6": ModelInfo(
        "AU Anthropic Claude Sonnet 4.6 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/au.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (AU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/deepseek.r1-v1:0": ModelInfo(
        "DeepSeek-R1 (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/deepseek.v3-v1:0": ModelInfo(
        "DeepSeek-V3.1 (Amazon Bedrock)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:amazon-bedrock/deepseek.v3.2": ModelInfo(
        "DeepSeek-V3.2 (Amazon Bedrock)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/google.gemma-3-12b-it": ModelInfo(
        "Google Gemma 3 12B (Amazon Bedrock)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:amazon-bedrock/google.gemma-3-27b-it": ModelInfo(
        "Google Gemma 3 27B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:amazon-bedrock/google.gemma-3-4b-it": ModelInfo(
        "Gemma 3 4B IT (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (JP) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (JP) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (JP) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (JP) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (JP) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (JP) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/jp.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (JP) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/meta.llama3-1-70b-instruct-v1:0": ModelInfo(
        "Llama 3.1 70B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/meta.llama3-1-8b-instruct-v1:0": ModelInfo(
        "Llama 3.1 8B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/meta.llama3-3-70b-instruct-v1:0": ModelInfo(
        "Llama 3.3 70B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/meta.llama4-maverick-17b-instruct-v1:0": ModelInfo(
        "Llama 4 Maverick 17B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/meta.llama4-scout-17b-instruct-v1:0": ModelInfo(
        "Llama 4 Scout 17B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 3_500_000
    ),
    "opencode:amazon-bedrock/minimax.minimax-m2": ModelInfo(
        "MiniMax M2 (Amazon Bedrock)", AgentKind.OPENCODE, 204_608
    ),
    "opencode:amazon-bedrock/minimax.minimax-m2.1": ModelInfo(
        "MiniMax M2.1 (Amazon Bedrock)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:amazon-bedrock/minimax.minimax-m2.5": ModelInfo(
        "MiniMax M2.5 (Amazon Bedrock)", AgentKind.OPENCODE, 196_608
    ),
    "opencode:amazon-bedrock/mistral.devstral-2-123b": ModelInfo(
        "Devstral 2 123B (Amazon Bedrock)", AgentKind.OPENCODE, 256_000
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
        "Mistral Large 3 (Amazon Bedrock)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:amazon-bedrock/mistral.pixtral-large-2502-v1:0": ModelInfo(
        "Pixtral Large (25.02) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/mistral.voxtral-mini-3b-2507": ModelInfo(
        "Voxtral Mini 3B 2507 (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/mistral.voxtral-small-24b-2507": ModelInfo(
        "Voxtral Small 24B 2507 (Amazon Bedrock)", AgentKind.OPENCODE, 32_000
    ),
    "opencode:amazon-bedrock/moonshot.kimi-k2-thinking": ModelInfo(
        "Kimi K2 Thinking (Amazon Bedrock)", AgentKind.OPENCODE, 262_143
    ),
    "opencode:amazon-bedrock/moonshotai.kimi-k2.5": ModelInfo(
        "Kimi K2.5 (Amazon Bedrock)", AgentKind.OPENCODE, 262_143
    ),
    "opencode:amazon-bedrock/nvidia.nemotron-nano-12b-v2": ModelInfo(
        "NVIDIA Nemotron Nano 12B v2 VL BF16 (Amazon Bedrock)",
        AgentKind.OPENCODE,
        128_000,
    ),
    "opencode:amazon-bedrock/nvidia.nemotron-nano-3-30b": ModelInfo(
        "NVIDIA Nemotron Nano 3 30B (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/nvidia.nemotron-nano-9b-v2": ModelInfo(
        "NVIDIA Nemotron Nano 9B v2 (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/nvidia.nemotron-super-3-120b": ModelInfo(
        "NVIDIA Nemotron 3 Super 120B A12B (Amazon Bedrock)",
        AgentKind.OPENCODE,
        262_144,
    ),
    "opencode:amazon-bedrock/openai.gpt-5.4": ModelInfo(
        "GPT-5.4 (Amazon Bedrock)", AgentKind.OPENCODE, 272_000
    ),
    "opencode:amazon-bedrock/openai.gpt-5.5": ModelInfo(
        "GPT-5.5 (Amazon Bedrock)", AgentKind.OPENCODE, 272_000
    ),
    "opencode:amazon-bedrock/openai.gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Amazon Bedrock)", AgentKind.OPENCODE, 272_000
    ),
    "opencode:amazon-bedrock/openai.gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Amazon Bedrock)", AgentKind.OPENCODE, 272_000
    ),
    "opencode:amazon-bedrock/openai.gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Amazon Bedrock)", AgentKind.OPENCODE, 272_000
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-120b": ModelInfo(
        "gpt-oss-120b (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-120b-1:0": ModelInfo(
        "gpt-oss-120b (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-20b": ModelInfo(
        "gpt-oss-20b (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-20b-1:0": ModelInfo(
        "gpt-oss-20b (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-safeguard-120b": ModelInfo(
        "GPT OSS Safeguard 120B (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/openai.gpt-oss-safeguard-20b": ModelInfo(
        "GPT OSS Safeguard 20B (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/qwen.qwen3-235b-a22b-2507-v1:0": ModelInfo(
        "Qwen3 235B A22B 2507 (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/qwen.qwen3-32b-v1:0": ModelInfo(
        "Qwen3 32B (dense) (Amazon Bedrock)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:amazon-bedrock/qwen.qwen3-coder-30b-a3b-v1:0": ModelInfo(
        "Qwen3 Coder 30B A3B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:amazon-bedrock/qwen.qwen3-coder-480b-a35b-v1:0": ModelInfo(
        "Qwen3 Coder 480B A35B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:amazon-bedrock/qwen.qwen3-coder-next": ModelInfo(
        "Qwen3 Coder Next (Amazon Bedrock)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:amazon-bedrock/qwen.qwen3-next-80b-a3b": ModelInfo(
        "Qwen/Qwen3-Next-80B-A3B-Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 262_000
    ),
    "opencode:amazon-bedrock/qwen.qwen3-vl-235b-a22b": ModelInfo(
        "Qwen/Qwen3-VL-235B-A22B-Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 262_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-fable-5": ModelInfo(
        "Claude Fable 5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-5-20251101-v1:0": ModelInfo(
        "Claude Opus 4.5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-6-v1": ModelInfo(
        "Claude Opus 4.6 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-8": ModelInfo(
        "Claude Opus 4.8 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-5": ModelInfo(
        "Claude Opus 5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/us.deepseek.r1-v1:0": ModelInfo(
        "DeepSeek-R1 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/us.meta.llama4-maverick-17b-instruct-v1:0": ModelInfo(
        "Llama 4 Maverick 17B Instruct (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        1_000_000,
    ),
    "opencode:amazon-bedrock/us.meta.llama4-scout-17b-instruct-v1:0": ModelInfo(
        "Llama 4 Scout 17B Instruct (US) (Amazon Bedrock)",
        AgentKind.OPENCODE,
        3_500_000,
    ),
    "opencode:amazon-bedrock/writer.palmyra-x4-v1:0": ModelInfo(
        "Palmyra X4 (Amazon Bedrock)", AgentKind.OPENCODE, 122_880
    ),
    "opencode:amazon-bedrock/writer.palmyra-x5-v1:0": ModelInfo(
        "Palmyra X5 (Amazon Bedrock)", AgentKind.OPENCODE, 1_040_000
    ),
    "opencode:amazon-bedrock/xai.grok-4.3": ModelInfo(
        "Grok 4.3 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/zai.glm-4.7": ModelInfo(
        "GLM-4.7 (Amazon Bedrock)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:amazon-bedrock/zai.glm-4.7-flash": ModelInfo(
        "GLM-4.7-Flash (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/zai.glm-5": ModelInfo(
        "GLM-5 (Amazon Bedrock)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:deepseek/deepseek-chat": ModelInfo(
        "DeepSeek Chat (Deepseek)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:deepseek/deepseek-reasoner": ModelInfo(
        "DeepSeek Reasoner (Deepseek)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:deepseek/deepseek-v4-flash": ModelInfo(
        "DeepSeek V4 Flash (Deepseek)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:deepseek/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (Deepseek)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:github-copilot/claude-fable-5": ModelInfo(
        "Claude Fable 5 (Github Copilot)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:github-copilot/claude-haiku-4.5": ModelInfo(
        "Claude Haiku 4.5 (latest) (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-4.5": ModelInfo(
        "Claude Opus 4.5 (latest) (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-4.6": ModelInfo(
        "Claude Opus 4.6 (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-4.6-fast": ModelInfo(
        "Claude Opus 4.6 Fast (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-4.7": ModelInfo(
        "Claude Opus 4.7 (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-4.7-fast": ModelInfo(
        "Claude Opus 4.7 Fast (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-4.8": ModelInfo(
        "Claude Opus 4.8 (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-4.8-fast": ModelInfo(
        "Claude Opus 4.8 Fast (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-opus-5": ModelInfo(
        "Claude Opus 5 (Github Copilot)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:github-copilot/claude-sonnet-4": ModelInfo(
        "Claude Sonnet 4 (latest) (Github Copilot)", AgentKind.OPENCODE, 216_000
    ),
    "opencode:github-copilot/claude-sonnet-4.5": ModelInfo(
        "Claude Sonnet 4.5 (latest) (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-sonnet-4.6": ModelInfo(
        "Claude Sonnet 4.6 (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Github Copilot)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:github-copilot/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Github Copilot)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:github-copilot/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (Github Copilot)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:github-copilot/gpt-4.1": ModelInfo(
        "GPT-4.1 (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gpt-5-mini": ModelInfo(
        "GPT-5 Mini (Github Copilot)", AgentKind.OPENCODE, 264_000
    ),
    "opencode:github-copilot/gpt-5.2": ModelInfo(
        "GPT-5.2 (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.2-codex": ModelInfo(
        "GPT-5.2 Codex (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.4": ModelInfo(
        "GPT-5.4 (Github Copilot)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:github-copilot/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 mini (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 nano (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.5": ModelInfo(
        "GPT-5.5 (Github Copilot)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:github-copilot/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Github Copilot)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:github-copilot/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Github Copilot)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:github-copilot/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Github Copilot)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:github-copilot/grok-4.5": ModelInfo(
        "Grok 4.5 (Github Copilot)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:github-copilot/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (Github Copilot)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:github-copilot/kimi-k3": ModelInfo(
        "Kimi K3 (Github Copilot)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:github-copilot/mai-code-1-flash-picker": ModelInfo(
        "MAI-Code-1-Flash (Github Copilot)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:github-copilot/mai-code-1.1-flash": ModelInfo(
        "MAI-Code-1.1-Flash (Github Copilot)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:google/deep-research-max-preview-04-2026": ModelInfo(
        "Deep Research Max Preview (Apr-21-2026) (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/deep-research-preview-04-2026": ModelInfo(
        "Deep Research Preview (Apr-21-2026) (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-2.5-computer-use-preview-10-2025": ModelInfo(
        "Gemini 2.5 Computer Use Preview 10-2025 (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-image": ModelInfo(
        "Nano Banana (Google)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google/gemini-2.5-flash-lite": ModelInfo(
        "Gemini 2.5 Flash-Lite (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-preview-tts": ModelInfo(
        "Gemini 2.5 Flash Preview TTS (Google)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:google/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-pro-preview-tts": ModelInfo(
        "Gemini 2.5 Pro Preview TTS (Google)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3-pro-image": ModelInfo(
        "Nano Banana Pro (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-3-pro-image-preview": ModelInfo(
        "Nano Banana Pro (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-3.1-flash-image": ModelInfo(
        "Nano Banana 2 (Google)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:google/gemini-3.1-flash-image-preview": ModelInfo(
        "Nano Banana 2 (Google)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:google/gemini-3.1-flash-lite": ModelInfo(
        "Gemini 3.1 Flash Lite (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3.1-flash-lite-image": ModelInfo(
        "Nano Banana 2 Lite (Google)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:google/gemini-3.1-flash-live-preview": ModelInfo(
        "Gemini 3.1 Flash Live Preview (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-3.1-flash-tts-preview": ModelInfo(
        "Gemini 3.1 Flash TTS Preview (Google)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:google/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3.5-live-translate-preview": ModelInfo(
        "Gemini 3.5 Live Translate Preview (Google)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:google/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-embedding-001": ModelInfo(
        "Gemini Embedding 001 (Google)", AgentKind.OPENCODE, 2_048
    ),
    "opencode:google/gemini-embedding-2": ModelInfo(
        "Gemini Embedding 2 (Google)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:google/gemini-flash-latest": ModelInfo(
        "Gemini Flash Latest (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-flash-lite-latest": ModelInfo(
        "Gemini Flash-Lite Latest (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-omni-flash-preview": ModelInfo(
        "Gemini Omni Flash Preview (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-robotics-er-1.6-preview": ModelInfo(
        "Gemini Robotics-ER 1.6 Preview (Google)", AgentKind.OPENCODE, 131_072
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
    "opencode:google/veo-3.1-fast-generate-preview": ModelInfo(
        "Veo 3.1 fast (Google)", AgentKind.OPENCODE, 480
    ),
    "opencode:google/veo-3.1-generate-preview": ModelInfo(
        "Veo 3.1 (Google)", AgentKind.OPENCODE, 480
    ),
    "opencode:google/veo-3.1-lite-generate-preview": ModelInfo(
        "Veo 3.1 lite (Google)", AgentKind.OPENCODE, 480
    ),
    "opencode:google-vertex/claude-haiku-4-5@20251001": ModelInfo(
        "Claude Haiku 4.5 (Google Vertex)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex/claude-opus-4-5@20251101": ModelInfo(
        "Claude Opus 4.5 (Google Vertex)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex/claude-opus-4-6@default": ModelInfo(
        "Claude Opus 4.6 (Google Vertex)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex/claude-opus-4-7@default": ModelInfo(
        "Claude Opus 4.7 (Google Vertex)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex/claude-opus-4-8@default": ModelInfo(
        "Claude Opus 4.8 (Google Vertex)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex/claude-opus-5@default": ModelInfo(
        "Claude Opus 5 (Google Vertex)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex/claude-sonnet-4-5@20250929": ModelInfo(
        "Claude Sonnet 4.5 (Google Vertex)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex/claude-sonnet-4-6@default": ModelInfo(
        "Claude Sonnet 4.6 (Google Vertex)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex/claude-sonnet-5@default": ModelInfo(
        "Claude Sonnet 5 (Google Vertex)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-flash-image": ModelInfo(
        "Nano Banana (Google Vertex)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google-vertex/gemini-2.5-flash-lite": ModelInfo(
        "Gemini 2.5 Flash-Lite (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-flash-tts": ModelInfo(
        "Gemini 2.5 Flash TTS (Google Vertex)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google-vertex/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-pro-tts": ModelInfo(
        "Gemini 2.5 Pro TTS (Google Vertex)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google-vertex/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3-pro-image": ModelInfo(
        "Nano Banana Pro (Google Vertex)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:google-vertex/gemini-3.1-flash-image": ModelInfo(
        "Nano Banana 2 (Google Vertex)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google-vertex/gemini-3.1-flash-lite": ModelInfo(
        "Gemini 3.1 Flash Lite (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
    ),
    "opencode:google-vertex/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-embedding-001": ModelInfo(
        "Gemini Embedding 001 (Google Vertex)", AgentKind.OPENCODE, 2_048
    ),
    "opencode:google-vertex/gemini-flash-latest": ModelInfo(
        "Gemini Flash Latest (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-flash-lite-latest": ModelInfo(
        "Gemini Flash-Lite Latest (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/meta/llama-4-maverick-17b-128e-instruct-maas": ModelInfo(
        "Llama 4 Maverick 17B 128E Instruct (Google Vertex)",
        AgentKind.OPENCODE,
        524_288,
    ),
    "opencode:google-vertex/openai/gpt-oss-120b-maas": ModelInfo(
        "GPT OSS 120B (Google Vertex)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google-vertex-anthropic/claude-haiku-4-5@20251001": ModelInfo(
        "Claude Haiku 4.5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-opus-4-5@20251101": ModelInfo(
        "Claude Opus 4.5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-opus-4-6@default": ModelInfo(
        "Claude Opus 4.6 (Google Vertex Anthropic)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex-anthropic/claude-opus-4-7@default": ModelInfo(
        "Claude Opus 4.7 (Google Vertex Anthropic)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex-anthropic/claude-opus-4-8@default": ModelInfo(
        "Claude Opus 4.8 (Google Vertex Anthropic)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex-anthropic/claude-opus-5@default": ModelInfo(
        "Claude Opus 5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex-anthropic/claude-sonnet-4-5@20250929": ModelInfo(
        "Claude Sonnet 4.5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-sonnet-4-6@default": ModelInfo(
        "Claude Sonnet 4.6 (Google Vertex Anthropic)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google-vertex-anthropic/claude-sonnet-5@default": ModelInfo(
        "Claude Sonnet 5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openai/gpt-5.2": ModelInfo(
        "GPT-5.2 (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.3-codex-spark": ModelInfo(
        "GPT-5.3 Codex Spark (Openai)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openai/gpt-5.4": ModelInfo(
        "GPT-5.4 (Openai)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openai/gpt-5.4-fast": ModelInfo(
        "GPT-5.4 Fast (Openai)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openai/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 mini (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.4-mini-fast": ModelInfo(
        "GPT-5.4 mini Fast (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/ai21/jamba-large-1.7": ModelInfo(
        "Jamba Large 1.7 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/aion-labs/aion-2.0": ModelInfo(
        "Aion-2.0 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/aion-labs/aion-3.0": ModelInfo(
        "Aion-3.0 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/aion-labs/aion-3.0-mini": ModelInfo(
        "Aion-3.0-Mini (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/aion-labs/aion-rp-llama-3.1-8b": ModelInfo(
        "Aion-RP 1.0 (8B) (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/allenai/olmo-3-32b-think": ModelInfo(
        "Olmo 3 32B Think (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/amazon/nova-2-lite-v1": ModelInfo(
        "Nova 2 Lite (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/amazon/nova-lite-v1": ModelInfo(
        "Nova Lite 1.0 (Openrouter)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:openrouter/amazon/nova-micro-v1": ModelInfo(
        "Nova Micro 1.0 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/amazon/nova-premier-v1": ModelInfo(
        "Nova Premier 1.0 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/amazon/nova-pro-v1": ModelInfo(
        "Nova Pro 1.0 (Openrouter)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:openrouter/anthracite-org/magnum-v4-72b": ModelInfo(
        "Magnum v4 72B (Openrouter)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:openrouter/anthropic/claude-3-haiku": ModelInfo(
        "Claude 3 Haiku (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-fable-5": ModelInfo(
        "Claude Fable 5 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-haiku-4.5": ModelInfo(
        "Claude Haiku 4.5 (latest) (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4": ModelInfo(
        "Claude Opus 4 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.1": ModelInfo(
        "Claude Opus 4.1 (latest) (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.5": ModelInfo(
        "Claude Opus 4.5 (latest) (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.6": ModelInfo(
        "Claude Opus 4.6 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.7": ModelInfo(
        "Claude Opus 4.7 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.7-fast": ModelInfo(
        "Claude Opus 4.7 (Fast) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.8": ModelInfo(
        "Claude Opus 4.8 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.8-fast": ModelInfo(
        "Claude Opus 4.8 (Fast) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-opus-5": ModelInfo(
        "Claude Opus 5 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-opus-5-fast": ModelInfo(
        "Claude Opus 5 (Fast) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4": ModelInfo(
        "Claude Sonnet 4 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4.5": ModelInfo(
        "Claude Sonnet 4.5 (latest) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4.6": ModelInfo(
        "Claude Sonnet 4.6 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-sonnet-5": ModelInfo(
        "Claude Sonnet 5 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/arcee-ai/trinity-large-thinking": ModelInfo(
        "Trinity Large Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/arcee-ai/virtuoso-large": ModelInfo(
        "Virtuoso Large (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/baidu/ernie-4.5-vl-424b-a47b": ModelInfo(
        "ERNIE 4.5 VL 424B A47B  (Openrouter)", AgentKind.OPENCODE, 123_000
    ),
    "opencode:openrouter/bytedance-seed/seed-1.6": ModelInfo(
        "Seed 1.6 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/bytedance-seed/seed-1.6-flash": ModelInfo(
        "Seed 1.6 Flash (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/bytedance-seed/seed-2.0-lite": ModelInfo(
        "Seed-2.0-Lite (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/bytedance-seed/seed-2.0-mini": ModelInfo(
        "Seed-2.0-Mini (Openrouter)", AgentKind.OPENCODE, 262_144
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
    "opencode:openrouter/deepcogito/cogito-v2.1-671b": ModelInfo(
        "Cogito v2.1 671B (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/deepseek/deepseek-chat": ModelInfo(
        "DeepSeek Chat (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-chat-v3-0324": ModelInfo(
        "DeepSeek V3 0324 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-chat-v3.1": ModelInfo(
        "DeepSeek V3.1 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-r1": ModelInfo(
        "DeepSeek-R1 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-r1-0528": ModelInfo(
        "R1 0528 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-r1-distill-llama-70b": ModelInfo(
        "R1 Distill Llama 70B (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/deepseek/deepseek-v3.1-terminus": ModelInfo(
        "DeepSeek V3.1 Terminus (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-v3.2": ModelInfo(
        "DeepSeek V3.2 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-v3.2-exp": ModelInfo(
        "DeepSeek V3.2 Exp (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-v4-flash": ModelInfo(
        "DeepSeek V4 Flash (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/deepseek/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/deepseek/deepseek-v4-pro-0813": ModelInfo(
        "DeepSeek V4 Pro 0813 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-flash-image": ModelInfo(
        "Nano Banana (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/google/gemini-2.5-flash-lite": ModelInfo(
        "Gemini 2.5 Flash-Lite (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-pro-preview": ModelInfo(
        "Gemini 2.5 Pro Preview 06-05 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-pro-preview-05-06": ModelInfo(
        "Gemini 2.5 Pro Preview 05-06 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3-pro-image": ModelInfo(
        "Nano Banana Pro (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemini-3-pro-image-preview": ModelInfo(
        "Nano Banana Pro (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/google/gemini-3.1-flash-image": ModelInfo(
        "Nano Banana 2 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemini-3.1-flash-image-preview": ModelInfo(
        "Nano Banana 2 (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/google/gemini-3.1-flash-lite": ModelInfo(
        "Gemini 3.1 Flash Lite (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3.1-flash-lite-image": ModelInfo(
        "Nano Banana 2 Lite (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/google/gemini-3.1-flash-lite-preview": ModelInfo(
        "Gemini 3.1 Flash Lite Preview (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
    ),
    "opencode:openrouter/google/gemini-3.5-flash": ModelInfo(
        "Gemini 3.5 Flash (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3.5-flash-lite": ModelInfo(
        "Gemini 3.5 Flash Lite (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3.6-flash": ModelInfo(
        "Gemini 3.6 Flash (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemma-2-27b-it": ModelInfo(
        "Gemma 2 27B (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/google/gemma-3-12b-it": ModelInfo(
        "Gemma 3 12B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemma-3-27b-it": ModelInfo(
        "Gemma 3 27B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/gemma-3-4b-it": ModelInfo(
        "Gemma 3 4B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemma-3n-e4b-it": ModelInfo(
        "Gemma 3n 4B (Openrouter)", AgentKind.OPENCODE, 32_768
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
    "opencode:openrouter/ibm-granite/granite-4.0-h-micro": ModelInfo(
        "Granite 4.0 Micro (Openrouter)", AgentKind.OPENCODE, 131_000
    ),
    "opencode:openrouter/ibm-granite/granite-4.1-8b": ModelInfo(
        "Granite 4.1 8B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/inception/mercury-2": ModelInfo(
        "Mercury 2 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/inclusionai/ling-2.6-1t": ModelInfo(
        "Ling-2.6-1T (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/inclusionai/ling-2.6-flash": ModelInfo(
        "Ling-2.6-flash (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/inclusionai/ling-3.0-flash:free": ModelInfo(
        "Ling-3.0-flash (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/inclusionai/ring-2.6-1t": ModelInfo(
        "Ring-2.6-1T (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/kwaipilot/kat-coder-air-v2.5": ModelInfo(
        "KAT-Coder-Air V2.5 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/kwaipilot/kat-coder-pro-v2": ModelInfo(
        "KAT-Coder-Pro V2 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/kwaipilot/kat-coder-pro-v2.5": ModelInfo(
        "KAT-Coder-Pro V2.5 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/mancer/weaver": ModelInfo(
        "Weaver (alpha) (Openrouter)", AgentKind.OPENCODE, 8_000
    ),
    "opencode:openrouter/meituan/longcat-2.0": ModelInfo(
        "LongCat 2.0 (Openrouter)", AgentKind.OPENCODE, 1_048_756
    ),
    "opencode:openrouter/meta-llama/llama-3.1-70b-instruct": ModelInfo(
        "Llama 3.1 70B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/meta-llama/llama-3.1-8b-instruct": ModelInfo(
        "Llama 3.1 8B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
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
        "Llama 4 Maverick (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/meta-llama/llama-4-scout": ModelInfo(
        "Llama 4 Scout (Openrouter)", AgentKind.OPENCODE, 1_310_720
    ),
    "opencode:openrouter/meta-llama/llama-guard-4-12b": ModelInfo(
        "Llama Guard 4 12B (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/meta/muse-spark-1.1": ModelInfo(
        "Muse Spark 1.1 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/microsoft/phi-4": ModelInfo(
        "Phi 4 (Openrouter)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:openrouter/microsoft/wizardlm-2-8x22b": ModelInfo(
        "WizardLM-2 8x22B (Openrouter)", AgentKind.OPENCODE, 65_535
    ),
    "opencode:openrouter/minimax/minimax-01": ModelInfo(
        "MiniMax-01 (Openrouter)", AgentKind.OPENCODE, 1_000_192
    ),
    "opencode:openrouter/minimax/minimax-m1": ModelInfo(
        "MiniMax M1 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/minimax/minimax-m2": ModelInfo(
        "MiniMax-M2 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/minimax/minimax-m2-her": ModelInfo(
        "MiniMax M2-her (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/minimax/minimax-m2.1": ModelInfo(
        "MiniMax-M2.1 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/minimax/minimax-m2.5": ModelInfo(
        "MiniMax-M2.5 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/minimax/minimax-m2.7": ModelInfo(
        "MiniMax-M2.7 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/minimax/minimax-m3": ModelInfo(
        "MiniMax-M3 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/mistralai/codestral-2508": ModelInfo(
        "Codestral 2508 (Openrouter)", AgentKind.OPENCODE, 256_000
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
        "Mistral Large 2407 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/mistral-large-2512": ModelInfo(
        "Mistral Large 3 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/mistral-medium-3": ModelInfo(
        "Mistral Medium 3 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/mistral-medium-3-5": ModelInfo(
        "Mistral Medium 3.5 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/mistral-medium-3.1": ModelInfo(
        "Mistral Medium 3.1 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/mistral-nemo": ModelInfo(
        "Mistral Nemo (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/mistral-saba": ModelInfo(
        "Saba (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/mistralai/mistral-small-24b-instruct-2501": ModelInfo(
        "Mistral Small 3 (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/mistralai/mistral-small-2603": ModelInfo(
        "Mistral Small 4 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/mistral-small-3.1-24b-instruct": ModelInfo(
        "Mistral Small 3.1 24B (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/mistralai/mistral-small-3.2-24b-instruct": ModelInfo(
        "Mistral Small 3.2 24B (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/mistralai/mixtral-8x22b-instruct": ModelInfo(
        "Mixtral 8x22B Instruct (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/mistralai/voxtral-small-24b-2507": ModelInfo(
        "Voxtral Small 24B 2507 (Openrouter)", AgentKind.OPENCODE, 32_000
    ),
    "opencode:openrouter/moonshotai/kimi-k2": ModelInfo(
        "Kimi K2 0711 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/moonshotai/kimi-k2-0905": ModelInfo(
        "Kimi K2 0905 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2-thinking": ModelInfo(
        "Kimi K2 Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2.5": ModelInfo(
        "Kimi K2.5 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2.6": ModelInfo(
        "Kimi K2.6 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k3": ModelInfo(
        "Kimi K3 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/morph/morph-v3-fast": ModelInfo(
        "Morph V3 Fast (Openrouter)", AgentKind.OPENCODE, 81_920
    ),
    "opencode:openrouter/morph/morph-v3-large": ModelInfo(
        "Morph V3 Large (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nex-agi/nex-n2-mini": ModelInfo(
        "Nex-N2-Mini (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nex-agi/nex-n2-pro": ModelInfo(
        "Nex-N2-Pro (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nousresearch/hermes-3-llama-3.1-405b": ModelInfo(
        "Hermes 3 405B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nousresearch/hermes-3-llama-3.1-70b": ModelInfo(
        "Hermes 3 70B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nousresearch/hermes-4-405b": ModelInfo(
        "Hermes 4 405B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nousresearch/hermes-4-70b": ModelInfo(
        "Hermes 4 70B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nvidia/nemotron-3-nano-30b-a3b": ModelInfo(
        "Nemotron 3 Nano 30B A3B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nvidia/nemotron-3-nano-30b-a3b:free": ModelInfo(
        "Nemotron 3 Nano 30B A3B (free) (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": ModelInfo(
        "Nemotron 3 Nano Omni (free) (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/nvidia/nemotron-3-super-120b-a12b": ModelInfo(
        "Nemotron 3 Super 120B A12B (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/nvidia/nemotron-3-super-120b-a12b:free": ModelInfo(
        "Nemotron 3 Super (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nvidia/nemotron-3-ultra-550b-a55b": ModelInfo(
        "Nemotron 3 Ultra 550B A55B (Openrouter)", AgentKind.OPENCODE, 512_288
    ),
    "opencode:openrouter/nvidia/nemotron-3-ultra-550b-a55b:free": ModelInfo(
        "Nemotron 3 Ultra (free) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/nvidia/nemotron-3.5-content-safety:free": ModelInfo(
        "Nemotron 3.5 Content Safety (free) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/nvidia/nemotron-nano-12b-v2-vl:free": ModelInfo(
        "Nemotron Nano 12B 2 VL (free) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/nvidia/nemotron-nano-9b-v2:free": ModelInfo(
        "Nemotron Nano 9B V2 (free) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-3.5-turbo": ModelInfo(
        "GPT-3.5-turbo (Openrouter)", AgentKind.OPENCODE, 16_385
    ),
    "opencode:openrouter/openai/gpt-3.5-turbo-0613": ModelInfo(
        "GPT-3.5 Turbo (older v0613) (Openrouter)", AgentKind.OPENCODE, 4_095
    ),
    "opencode:openrouter/openai/gpt-3.5-turbo-16k": ModelInfo(
        "GPT-3.5 Turbo 16k (Openrouter)", AgentKind.OPENCODE, 16_385
    ),
    "opencode:openrouter/openai/gpt-3.5-turbo-instruct": ModelInfo(
        "GPT-3.5 Turbo Instruct (Openrouter)", AgentKind.OPENCODE, 4_095
    ),
    "opencode:openrouter/openai/gpt-4": ModelInfo(
        "GPT-4 (Openrouter)", AgentKind.OPENCODE, 8_191
    ),
    "opencode:openrouter/openai/gpt-4-turbo": ModelInfo(
        "GPT-4 Turbo (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4-turbo-preview": ModelInfo(
        "GPT-4 Turbo Preview (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4.1": ModelInfo(
        "GPT-4.1 (Openrouter)", AgentKind.OPENCODE, 1_047_576
    ),
    "opencode:openrouter/openai/gpt-4.1-mini": ModelInfo(
        "GPT-4.1 mini (Openrouter)", AgentKind.OPENCODE, 1_047_576
    ),
    "opencode:openrouter/openai/gpt-4.1-nano": ModelInfo(
        "GPT-4.1 nano (Openrouter)", AgentKind.OPENCODE, 1_047_576
    ),
    "opencode:openrouter/openai/gpt-4o": ModelInfo(
        "GPT-4o (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4o-2024-05-13": ModelInfo(
        "GPT-4o (2024-05-13) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4o-2024-08-06": ModelInfo(
        "GPT-4o (2024-08-06) (Openrouter)", AgentKind.OPENCODE, 128_000
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
        "GPT-5 (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-image": ModelInfo(
        "GPT-5 Image (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-image-mini": ModelInfo(
        "GPT-5 Image Mini (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-mini": ModelInfo(
        "GPT-5 Mini (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-nano": ModelInfo(
        "GPT-5 Nano (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-pro": ModelInfo(
        "GPT-5 Pro (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.1": ModelInfo(
        "GPT-5.1 (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.1-chat": ModelInfo(
        "GPT-5.1 Chat (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-5.1-codex": ModelInfo(
        "GPT-5.1 Codex (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.1-codex-max": ModelInfo(
        "GPT-5.1 Codex Max (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.1-codex-mini": ModelInfo(
        "GPT-5.1 Codex mini (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.2": ModelInfo(
        "GPT-5.2 (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.2-chat": ModelInfo(
        "GPT-5.2 Chat (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-5.2-codex": ModelInfo(
        "GPT-5.2 Codex (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.2-pro": ModelInfo(
        "GPT-5.2 Pro (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.3-chat": ModelInfo(
        "GPT-5.3 Chat (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-5.3-codex": ModelInfo(
        "GPT-5.3 Codex (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.4": ModelInfo(
        "GPT-5.4 (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.4-image-2": ModelInfo(
        "GPT-5.4 Image 2 (Openrouter)", AgentKind.OPENCODE, 272_000
    ),
    "opencode:openrouter/openai/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 mini (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 nano (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.4-pro": ModelInfo(
        "GPT-5.4 Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.5": ModelInfo(
        "GPT-5.5 (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.5-pro": ModelInfo(
        "GPT-5.5 Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.6-luna": ModelInfo(
        "GPT-5.6 Luna (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.6-luna-pro": ModelInfo(
        "GPT-5.6 Luna Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.6-sol": ModelInfo(
        "GPT-5.6 Sol (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.6-sol-pro": ModelInfo(
        "GPT-5.6 Sol Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.6-terra": ModelInfo(
        "GPT-5.6 Terra (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.6-terra-pro": ModelInfo(
        "GPT-5.6 Terra Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
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
        "GPT OSS 120B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-20b": ModelInfo(
        "GPT OSS 20B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-20b:free": ModelInfo(
        "gpt-oss-20b (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-safeguard-20b": ModelInfo(
        "gpt-oss-safeguard-20b (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/o1": ModelInfo(
        "o1 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o1-pro": ModelInfo(
        "o1-pro (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o3": ModelInfo(
        "o3 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o3-mini": ModelInfo(
        "o3-mini (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o3-mini-high": ModelInfo(
        "o3 Mini High (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o3-pro": ModelInfo(
        "o3-pro (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o4-mini": ModelInfo(
        "o4-mini (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openai/o4-mini-high": ModelInfo(
        "o4 Mini High (Openrouter)", AgentKind.OPENCODE, 200_000
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
        "Perceptron Mk1 (Openrouter)", AgentKind.OPENCODE, 32_768
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
    "opencode:openrouter/poolside/laguna-s-2.1": ModelInfo(
        "Laguna S 2.1 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/poolside/laguna-s-2.1:free": ModelInfo(
        "Laguna S 2.1 (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/poolside/laguna-xs-2.1": ModelInfo(
        "Laguna XS 2.1 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/poolside/laguna-xs-2.1:free": ModelInfo(
        "Laguna XS 2.1 (free) (Openrouter)", AgentKind.OPENCODE, 262_144
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
    "opencode:openrouter/qwen/qwen-plus-2025-07-28": ModelInfo(
        "Qwen Plus 0728 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen-plus-2025-07-28:thinking": ModelInfo(
        "Qwen Plus 0728 (thinking) (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen2.5-vl-72b-instruct": ModelInfo(
        "Qwen2.5 VL 72B Instruct (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/qwen/qwen3-14b": ModelInfo(
        "Qwen3 14B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-235b-a22b": ModelInfo(
        "Qwen3 235B-A22B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-235b-a22b-2507": ModelInfo(
        "Qwen3 235B A22B Instruct 2507 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-235b-a22b-thinking-2507": ModelInfo(
        "Qwen3 235B A22B Thinking 2507 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-30b-a3b": ModelInfo(
        "Qwen3 30B A3B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-30b-a3b-instruct-2507": ModelInfo(
        "Qwen3 30B A3B Instruct 2507 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-30b-a3b-thinking-2507": ModelInfo(
        "Qwen3 30B A3B Thinking 2507 (Openrouter)", AgentKind.OPENCODE, 81_920
    ),
    "opencode:openrouter/qwen/qwen3-32b": ModelInfo(
        "Qwen3 32B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-8b": ModelInfo(
        "Qwen3 8B (Openrouter)", AgentKind.OPENCODE, 131_072
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
    "opencode:openrouter/qwen/qwen3-coder-plus": ModelInfo(
        "Qwen3 Coder Plus (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3-max": ModelInfo(
        "Qwen3 Max (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-max-thinking": ModelInfo(
        "Qwen3 Max Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
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
    "opencode:openrouter/qwen/qwen3-vl-235b-a22b-thinking": ModelInfo(
        "Qwen3 VL 235B A22B Thinking (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-vl-30b-a3b-instruct": ModelInfo(
        "Qwen3 VL 30B A3B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-vl-30b-a3b-thinking": ModelInfo(
        "Qwen3 VL 30B A3B Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-vl-32b-instruct": ModelInfo(
        "Qwen3 VL 32B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-vl-8b-instruct": ModelInfo(
        "Qwen3 VL 8B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-vl-8b-thinking": ModelInfo(
        "Qwen3 VL 8B Thinking (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3.5-122b-a10b": ModelInfo(
        "Qwen3.5 122B-A10B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-27b": ModelInfo(
        "Qwen3.5 27B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-35b-a3b": ModelInfo(
        "Qwen3.5 35B-A3B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-397b-a17b": ModelInfo(
        "Qwen3.5 397B-A17B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-9b": ModelInfo(
        "Qwen3.5 9B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-flash-02-23": ModelInfo(
        "Qwen3.5-Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.5-plus-02-15": ModelInfo(
        "Qwen3.5 Plus 2026-02-15 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.5-plus-20260420": ModelInfo(
        "Qwen3.5 Plus 2026-04-20 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.6-27b": ModelInfo(
        "Qwen3.6 27B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.6-35b-a3b": ModelInfo(
        "Qwen3.6 35B-A3B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.6-flash": ModelInfo(
        "Qwen3.6 Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.6-max-preview": ModelInfo(
        "Qwen3.6 Max Preview (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.6-plus": ModelInfo(
        "Qwen3.6 Plus (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.7-flash": ModelInfo(
        "Qwen3.7 Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.7-max": ModelInfo(
        "Qwen3.7 Max (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.7-plus": ModelInfo(
        "Qwen3.7 Plus (Openrouter)", AgentKind.OPENCODE, 1_000_000
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
    "opencode:openrouter/sakana/fugu-ultra": ModelInfo(
        "Fugu Ultra (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/sao10k/l3-lunaris-8b": ModelInfo(
        "Llama 3 8B Lunaris (Openrouter)", AgentKind.OPENCODE, 8_192
    ),
    "opencode:openrouter/sao10k/l3.1-euryale-70b": ModelInfo(
        "Llama 3.1 Euryale 70B v2.2 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/sao10k/l3.3-euryale-70b": ModelInfo(
        "Llama 3.3 Euryale 70B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/stepfun/step-3.5-flash": ModelInfo(
        "Step 3.5 Flash (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/stepfun/step-3.7-flash": ModelInfo(
        "Step 3.7 Flash (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/tencent/hunyuan-a13b-instruct": ModelInfo(
        "Hunyuan A13B Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/tencent/hy3": ModelInfo(
        "Hy3 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/tencent/hy3-preview": ModelInfo(
        "Hy3 preview (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/thedrummer/cydonia-24b-v4.1": ModelInfo(
        "Cydonia 24B V4.1 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/thedrummer/rocinante-12b": ModelInfo(
        "Rocinante 12B (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/thedrummer/skyfall-36b-v2": ModelInfo(
        "Skyfall 36B V2 (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/thedrummer/unslopnemo-12b": ModelInfo(
        "UnslopNemo 12B (Openrouter)", AgentKind.OPENCODE, 1_024_000
    ),
    "opencode:openrouter/thinkingmachines/inkling": ModelInfo(
        "Inkling (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/undi95/remm-slerp-l2-13b": ModelInfo(
        "ReMM SLERP 13B (Openrouter)", AgentKind.OPENCODE, 6_144
    ),
    "opencode:openrouter/upstage/solar-pro-3": ModelInfo(
        "Solar Pro 3 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/writer/palmyra-x5": ModelInfo(
        "Palmyra X5 (Openrouter)", AgentKind.OPENCODE, 1_040_000
    ),
    "opencode:openrouter/x-ai/grok-4.20": ModelInfo(
        "Grok 4.20 (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/x-ai/grok-4.20-multi-agent": ModelInfo(
        "Grok 4.20 Multi-Agent (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/x-ai/grok-4.3": ModelInfo(
        "Grok 4.3 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/x-ai/grok-4.5": ModelInfo(
        "Grok 4.5 (Openrouter)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:openrouter/x-ai/grok-4.6": ModelInfo(
        "Grok 4.6 (Openrouter)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:openrouter/x-ai/grok-build-0.1": ModelInfo(
        "Grok Build 0.1 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/xiaomi/mimo-v2.5": ModelInfo(
        "MiMo-V2.5 (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/xiaomi/mimo-v2.5-pro": ModelInfo(
        "MiMo-V2.5-Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/z-ai/glm-4.5": ModelInfo(
        "GLM-4.5 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/z-ai/glm-4.5-air": ModelInfo(
        "GLM-4.5-Air (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/z-ai/glm-4.5v": ModelInfo(
        "GLM-4.5V (Openrouter)", AgentKind.OPENCODE, 65_536
    ),
    "opencode:openrouter/z-ai/glm-4.6": ModelInfo(
        "GLM-4.6 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/z-ai/glm-4.6v": ModelInfo(
        "GLM-4.6V (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/z-ai/glm-4.7": ModelInfo(
        "GLM-4.7 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/z-ai/glm-4.7-flash": ModelInfo(
        "GLM-4.7-Flash (Openrouter)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:openrouter/z-ai/glm-5": ModelInfo(
        "GLM-5 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/z-ai/glm-5-turbo": ModelInfo(
        "GLM-5-Turbo (Openrouter)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:openrouter/z-ai/glm-5.1": ModelInfo(
        "GLM-5.1 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/z-ai/glm-5.2": ModelInfo(
        "GLM-5.2 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/z-ai/glm-5v-turbo": ModelInfo(
        "GLM-5V-Turbo (Openrouter)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:openrouter/~anthropic/claude-fable-latest": ModelInfo(
        "Claude Fable Latest (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/~anthropic/claude-haiku-latest": ModelInfo(
        "Anthropic Claude Haiku Latest (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/~anthropic/claude-opus-latest": ModelInfo(
        "Claude Opus Latest (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/~anthropic/claude-sonnet-latest": ModelInfo(
        "Anthropic Claude Sonnet Latest (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/~google/gemini-flash-latest": ModelInfo(
        "Google Gemini Flash Latest (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/~google/gemini-pro-latest": ModelInfo(
        "Google Gemini Pro Latest (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/~moonshotai/kimi-latest": ModelInfo(
        "MoonshotAI Kimi Latest (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/~openai/gpt-latest": ModelInfo(
        "OpenAI GPT Latest (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/~openai/gpt-mini-latest": ModelInfo(
        "OpenAI GPT Mini Latest (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/~x-ai/grok-latest": ModelInfo(
        "Grok Latest (Openrouter)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:perplexity/sonar": ModelInfo(
        "Sonar (Perplexity)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:perplexity/sonar-deep-research": ModelInfo(
        "Perplexity Sonar Deep Research (Perplexity)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:perplexity/sonar-pro": ModelInfo(
        "Sonar Pro (Perplexity)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:perplexity/sonar-reasoning-pro": ModelInfo(
        "Sonar Reasoning Pro (Perplexity)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:perplexity-agent/anthropic/claude-haiku-4-5": ModelInfo(
        "Claude Haiku 4.5 (Perplexity Agent)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-4-5": ModelInfo(
        "Claude Opus 4.5 (Perplexity Agent)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-4-6": ModelInfo(
        "Claude Opus 4.6 (Perplexity Agent)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:perplexity-agent/anthropic/claude-opus-4-7": ModelInfo(
        "Claude Opus 4.7 (Perplexity Agent)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:perplexity-agent/anthropic/claude-sonnet-4-5": ModelInfo(
        "Claude Sonnet 4.5 (Perplexity Agent)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:perplexity-agent/anthropic/claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Perplexity Agent)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:perplexity-agent/google/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Perplexity Agent)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:perplexity-agent/google/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Perplexity Agent)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:perplexity-agent/google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Perplexity Agent)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:perplexity-agent/google/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Perplexity Agent)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:perplexity-agent/moonshot-ai/kimi-k2.7-code": ModelInfo(
        "Kimi K2.7 Code (Perplexity Agent)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:perplexity-agent/moonshot-ai/kimi-k3": ModelInfo(
        "Kimi K3 (Perplexity Agent)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:perplexity-agent/nvidia/nemotron-3-super-120b-a12b": ModelInfo(
        "Nemotron 3 Super 120B (Perplexity Agent)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:perplexity-agent/openai/gpt-5-mini": ModelInfo(
        "GPT-5 Mini (Perplexity Agent)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:perplexity-agent/openai/gpt-5.1": ModelInfo(
        "GPT-5.1 (Perplexity Agent)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:perplexity-agent/openai/gpt-5.2": ModelInfo(
        "GPT-5.2 (Perplexity Agent)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:perplexity-agent/openai/gpt-5.4": ModelInfo(
        "GPT-5.4 (Perplexity Agent)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:perplexity-agent/openai/gpt-5.5": ModelInfo(
        "GPT-5.5 (Perplexity Agent)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:perplexity-agent/perplexity/sonar": ModelInfo(
        "Sonar (Perplexity Agent)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:perplexity-agent/xai/grok-4-1-fast-non-reasoning": ModelInfo(
        "Grok 4.1 Fast (Non-Reasoning) (Perplexity Agent)",
        AgentKind.OPENCODE,
        2_000_000,
    ),
    "opencode:zai-coding-plan/glm-4.5-air": ModelInfo(
        "GLM-4.5-Air (Zai Coding Plan)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:zai-coding-plan/glm-4.7": ModelInfo(
        "GLM-4.7 (Zai Coding Plan)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:zai-coding-plan/glm-5-turbo": ModelInfo(
        "GLM-5-Turbo (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:zai-coding-plan/glm-5.1": ModelInfo(
        "GLM-5.1 (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:zai-coding-plan/glm-5.2": ModelInfo(
        "GLM-5.2 (Zai Coding Plan)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:zai-coding-plan/glm-5.2-highspeed": ModelInfo(
        "GLM-5.2 Highspeed (Zai Coding Plan)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:zai-coding-plan/glm-5v-turbo": ModelInfo(
        "GLM-5V-Turbo (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
    ),
}

# Built-in slash commands per agent kind for the frontend. Claude/Codex lists
# are filtered ACP-exposed subsets (not full CLI/TUI chrome); skills are runtime.
# Codex omits logout — too easy to hit from chat autocomplete.
BUILTIN_SLASH_COMMANDS: dict[AgentKind, list[dict[str, str]]] = {
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
