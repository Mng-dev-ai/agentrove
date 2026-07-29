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
    # 1M via model_context_window in ~/.codex/config.toml (registry default 372k).
    # Live-reported window still wins over these fallbacks.
    "gpt-5.6-sol": ModelInfo("GPT 5.6 Sol", AgentKind.CODEX, 1_050_000),
    "gpt-5.6-terra": ModelInfo("GPT 5.6 Terra", AgentKind.CODEX, 1_050_000),
    "gpt-5.6-luna": ModelInfo("GPT 5.6 Luna", AgentKind.CODEX, 1_050_000),
    "gpt-5.5": ModelInfo("GPT 5.5", AgentKind.CODEX, 1_000_000),
    "gpt-5.4": ModelInfo("GPT 5.4", AgentKind.CODEX, 1_000_000),
    "gpt-5.4-mini": ModelInfo("GPT 5.4 Mini", AgentKind.CODEX, 400_000),
    "gpt-5.3-codex": ModelInfo("GPT 5.3 Codex", AgentKind.CODEX, 400_000),
    "gpt-5.2-codex": ModelInfo("GPT 5.2 Codex", AgentKind.CODEX, 400_000),
    "gpt-5.2": ModelInfo("GPT 5.2", AgentKind.CODEX, 400_000),
    "gpt-5.1-codex-max": ModelInfo("GPT 5.1 Codex Max", AgentKind.CODEX, 400_000),
    "gpt-5.1-codex-mini": ModelInfo("GPT 5.1 Codex Mini", AgentKind.CODEX, 400_000),
    "copilot:claude-sonnet-4.6": ModelInfo("Sonnet 4.6", AgentKind.COPILOT, 160_000),
    "copilot:claude-sonnet-4.5": ModelInfo("Sonnet 4.5", AgentKind.COPILOT, 160_000),
    "copilot:claude-opus-4.6": ModelInfo("Opus 4.6", AgentKind.COPILOT, 160_000),
    "copilot:claude-opus-4.5": ModelInfo("Opus 4.5", AgentKind.COPILOT, 160_000),
    "copilot:claude-haiku-4.5": ModelInfo("Haiku 4.5", AgentKind.COPILOT, 160_000),
    "copilot:claude-sonnet-4": ModelInfo("Sonnet 4", AgentKind.COPILOT, 144_000),
    "copilot:gpt-5.4": ModelInfo("GPT 5.4", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.4-mini": ModelInfo("GPT 5.4 Mini", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.3-codex": ModelInfo("GPT 5.3 Codex", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.2-codex": ModelInfo("GPT 5.2 Codex", AgentKind.COPILOT, 304_000),
    "copilot:gpt-5.2": ModelInfo("GPT 5.2", AgentKind.COPILOT, 160_000),
    "copilot:gpt-5.1": ModelInfo("GPT 5.1", AgentKind.COPILOT, 160_000),
    "copilot:gpt-5-mini": ModelInfo("GPT 5 Mini", AgentKind.COPILOT, 160_000),
    "copilot:gpt-4.1": ModelInfo("GPT 4.1", AgentKind.COPILOT, 80_000),
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
    "grok:grok-4.5": ModelInfo("Grok 4.5", AgentKind.GROK, 500_000),
    "grok:grok-composer-2.5-fast": ModelInfo(
        "Composer 2.5 (Grok)", AgentKind.GROK, 200_000
    ),
    "opencode:opencode/big-pickle": ModelInfo(
        "Big Pickle (OpenCode)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:opencode/gpt-5-nano": ModelInfo(
        "GPT-5 Nano (OpenCode)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:opencode/minimax-m2.5-free": ModelInfo(
        "MiniMax M2.5 Free (OpenCode)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode/nemotron-3-super-free": ModelInfo(
        "Nemotron 3 Super Free (OpenCode)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode-go/deepseek-v4-flash": ModelInfo(
        "DeepSeek V4 Flash (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/deepseek-v4-pro": ModelInfo(
        "DeepSeek V4 Pro (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/glm-5": ModelInfo(
        "GLM-5 (Opencode Go)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:opencode-go/glm-5.1": ModelInfo(
        "GLM-5.1 (Opencode Go)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:opencode-go/glm-5.2": ModelInfo(
        "GLM-5.2 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/grok-4.5": ModelInfo(
        "Grok 4.5 (Opencode Go)", AgentKind.OPENCODE, 500_000
    ),
    "opencode:opencode-go/hy3-preview": ModelInfo(
        "Hy3 Preview (Opencode Go)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:opencode-go/kimi-k2.5": ModelInfo(
        "Kimi K2.5 (Opencode Go)", AgentKind.OPENCODE, 262_144
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
    "opencode:opencode-go/mimo-v2-omni": ModelInfo(
        "MiMo V2 Omni (Opencode Go)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/mimo-v2-pro": ModelInfo(
        "MiMo V2 Pro (Opencode Go)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode-go/mimo-v2.5": ModelInfo(
        "MiMo V2.5 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/mimo-v2.5-pro": ModelInfo(
        "MiMo V2.5 Pro (Opencode Go)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:opencode-go/minimax-m2.5": ModelInfo(
        "MiniMax M2.5 (Opencode Go)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode-go/minimax-m2.7": ModelInfo(
        "MiniMax M2.7 (Opencode Go)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:opencode-go/minimax-m3": ModelInfo(
        "MiniMax M3 (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/qwen3.5-plus": ModelInfo(
        "Qwen3.5 Plus (Opencode Go)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/qwen3.6-plus": ModelInfo(
        "Qwen3.6 Plus (Opencode Go)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:opencode-go/qwen3.7-max": ModelInfo(
        "Qwen3.7 Max (Opencode Go)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:opencode-go/qwen3.7-plus": ModelInfo(
        "Qwen3.7 Plus (Opencode Go)", AgentKind.OPENCODE, 1_000_000
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
    "opencode:amazon-bedrock/amazon.nova-premier-v1:0": ModelInfo(
        "Nova Premier (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/amazon.nova-pro-v1:0": ModelInfo(
        "Nova Pro (Amazon Bedrock)", AgentKind.OPENCODE, 300_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-3-5-haiku-20241022-v1:0": ModelInfo(
        "Claude Haiku 3.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0": ModelInfo(
        "Claude Sonnet 3.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0": ModelInfo(
        "Claude Sonnet 3.5 v2 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0": ModelInfo(
        "Claude Sonnet 3.7 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-3-haiku-20240307-v1:0": ModelInfo(
        "Claude Haiku 3 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-1-20250805-v1:0": ModelInfo(
        "Claude Opus 4.1 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-opus-4-20250514-v1:0": ModelInfo(
        "Claude Opus 4 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
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
    "opencode:amazon-bedrock/anthropic.claude-sonnet-4-20250514-v1:0": ModelInfo(
        "Claude Sonnet 4 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
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
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-4-20250514-v1:0": ModelInfo(
        "Claude Sonnet 4 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/eu.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (EU) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
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
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-4-20250514-v1:0": ModelInfo(
        "Claude Sonnet 4 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/global.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (Global) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
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
    "opencode:amazon-bedrock/meta.llama3-1-405b-instruct-v1:0": ModelInfo(
        "Llama 3.1 405B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/meta.llama3-1-70b-instruct-v1:0": ModelInfo(
        "Llama 3.1 70B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/meta.llama3-1-8b-instruct-v1:0": ModelInfo(
        "Llama 3.1 8B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/meta.llama3-2-11b-instruct-v1:0": ModelInfo(
        "Llama 3.2 11B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:amazon-bedrock/meta.llama3-2-1b-instruct-v1:0": ModelInfo(
        "Llama 3.2 1B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 131_000
    ),
    "opencode:amazon-bedrock/meta.llama3-2-3b-instruct-v1:0": ModelInfo(
        "Llama 3.2 3B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 131_000
    ),
    "opencode:amazon-bedrock/meta.llama3-2-90b-instruct-v1:0": ModelInfo(
        "Llama 3.2 90B Instruct (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
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
        "Kimi K2 Thinking (Amazon Bedrock)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:amazon-bedrock/moonshotai.kimi-k2.5": ModelInfo(
        "Kimi K2.5 (Amazon Bedrock)", AgentKind.OPENCODE, 256_000
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
    "opencode:amazon-bedrock/openai.gpt-oss-120b-1:0": ModelInfo(
        "gpt-oss-120b (Amazon Bedrock)", AgentKind.OPENCODE, 128_000
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
    "opencode:amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0": ModelInfo(
        "Claude Haiku 4.5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-1-20250805-v1:0": ModelInfo(
        "Claude Opus 4.1 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-opus-4-20250514-v1:0": ModelInfo(
        "Claude Opus 4 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
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
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0": ModelInfo(
        "Claude Sonnet 4 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0": ModelInfo(
        "Claude Sonnet 4.5 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:amazon-bedrock/us.anthropic.claude-sonnet-4-6": ModelInfo(
        "Claude Sonnet 4.6 (US) (Amazon Bedrock)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:amazon-bedrock/writer.palmyra-x4-v1:0": ModelInfo(
        "Palmyra X4 (Amazon Bedrock)", AgentKind.OPENCODE, 122_880
    ),
    "opencode:amazon-bedrock/writer.palmyra-x5-v1:0": ModelInfo(
        "Palmyra X5 (Amazon Bedrock)", AgentKind.OPENCODE, 1_040_000
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
        "DeepSeek Chat (Deepseek)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:deepseek/deepseek-reasoner": ModelInfo(
        "DeepSeek Reasoner (Deepseek)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/claude-haiku-4.5": ModelInfo(
        "Claude Haiku 4.5 (Github Copilot)", AgentKind.OPENCODE, 144_000
    ),
    "opencode:github-copilot/claude-opus-4.5": ModelInfo(
        "Claude Opus 4.5 (Github Copilot)", AgentKind.OPENCODE, 160_000
    ),
    "opencode:github-copilot/claude-opus-4.6": ModelInfo(
        "Claude Opus 4.6 (Github Copilot)", AgentKind.OPENCODE, 144_000
    ),
    "opencode:github-copilot/claude-sonnet-4": ModelInfo(
        "Claude Sonnet 4 (Github Copilot)", AgentKind.OPENCODE, 216_000
    ),
    "opencode:github-copilot/claude-sonnet-4.5": ModelInfo(
        "Claude Sonnet 4.5 (Github Copilot)", AgentKind.OPENCODE, 144_000
    ),
    "opencode:github-copilot/claude-sonnet-4.6": ModelInfo(
        "Claude Sonnet 4.6 (Github Copilot)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:github-copilot/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gpt-4.1": ModelInfo(
        "GPT-4.1 (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gpt-4o": ModelInfo(
        "GPT-4o (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:github-copilot/gpt-5-mini": ModelInfo(
        "GPT-5-mini (Github Copilot)", AgentKind.OPENCODE, 264_000
    ),
    "opencode:github-copilot/gpt-5.2": ModelInfo(
        "GPT-5.2 (Github Copilot)", AgentKind.OPENCODE, 264_000
    ),
    "opencode:github-copilot/gpt-5.2-codex": ModelInfo(
        "GPT-5.2-Codex (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.3-codex": ModelInfo(
        "GPT-5.3-Codex (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.4": ModelInfo(
        "GPT-5.4 (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 Mini (Github Copilot)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:github-copilot/grok-code-fast-1": ModelInfo(
        "Grok Code Fast 1 (Github Copilot)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:google/gemini-1.5-flash": ModelInfo(
        "Gemini 1.5 Flash (Google)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google/gemini-1.5-flash-8b": ModelInfo(
        "Gemini 1.5 Flash-8B (Google)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google/gemini-1.5-pro": ModelInfo(
        "Gemini 1.5 Pro (Google)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google/gemini-2.0-flash": ModelInfo(
        "Gemini 2.0 Flash (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.0-flash-lite": ModelInfo(
        "Gemini 2.0 Flash Lite (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-image": ModelInfo(
        "Gemini 2.5 Flash Image (Google)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google/gemini-2.5-flash-image-preview": ModelInfo(
        "Gemini 2.5 Flash Image (Preview) (Google)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google/gemini-2.5-flash-lite": ModelInfo(
        "Gemini 2.5 Flash Lite (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-lite-preview-06-17": ModelInfo(
        "Gemini 2.5 Flash Lite Preview 06-17 (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-lite-preview-09-2025": ModelInfo(
        "Gemini 2.5 Flash Lite Preview 09-25 (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-preview-04-17": ModelInfo(
        "Gemini 2.5 Flash Preview 04-17 (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-preview-05-20": ModelInfo(
        "Gemini 2.5 Flash Preview 05-20 (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-preview-09-2025": ModelInfo(
        "Gemini 2.5 Flash Preview 09-25 (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-flash-preview-tts": ModelInfo(
        "Gemini 2.5 Flash Preview TTS (Google)", AgentKind.OPENCODE, 8000
    ),
    "opencode:google/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-pro-preview-05-06": ModelInfo(
        "Gemini 2.5 Pro Preview 05-06 (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-pro-preview-06-05": ModelInfo(
        "Gemini 2.5 Pro Preview 06-05 (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-2.5-pro-preview-tts": ModelInfo(
        "Gemini 2.5 Pro Preview TTS (Google)", AgentKind.OPENCODE, 8000
    ),
    "opencode:google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3-pro-preview": ModelInfo(
        "Gemini 3 Pro Preview (Google)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:google/gemini-3.1-flash-image-preview": ModelInfo(
        "Gemini 3.1 Flash Image (Preview) (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemini-3.1-flash-lite-preview": ModelInfo(
        "Gemini 3.1 Flash Lite Preview (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-embedding-001": ModelInfo(
        "Gemini Embedding 001 (Google)", AgentKind.OPENCODE, 2048
    ),
    "opencode:google/gemini-flash-latest": ModelInfo(
        "Gemini Flash Latest (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-flash-lite-latest": ModelInfo(
        "Gemini Flash-Lite Latest (Google)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google/gemini-live-2.5-flash": ModelInfo(
        "Gemini Live 2.5 Flash (Google)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:google/gemini-live-2.5-flash-preview-native-audio": ModelInfo(
        "Gemini Live 2.5 Flash Preview Native Audio (Google)",
        AgentKind.OPENCODE,
        131_072,
    ),
    "opencode:google/gemma-3-12b-it": ModelInfo(
        "Gemma 3 12B (Google)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google/gemma-3-27b-it": ModelInfo(
        "Gemma 3 27B (Google)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google/gemma-3-4b-it": ModelInfo(
        "Gemma 3 4B (Google)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:google/gemma-3n-e2b-it": ModelInfo(
        "Gemma 3n 2B (Google)", AgentKind.OPENCODE, 8192
    ),
    "opencode:google/gemma-3n-e4b-it": ModelInfo(
        "Gemma 3n 4B (Google)", AgentKind.OPENCODE, 8192
    ),
    "opencode:google/gemma-4-26b-it": ModelInfo(
        "Gemma 4 26B (Google)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:google/gemma-4-31b-it": ModelInfo(
        "Gemma 4 31B (Google)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:google-vertex/deepseek-ai/deepseek-v3.1-maas": ModelInfo(
        "DeepSeek V3.1 (Google Vertex)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:google-vertex/deepseek-ai/deepseek-v3.2-maas": ModelInfo(
        "DeepSeek V3.2 (Google Vertex)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:google-vertex/gemini-2.0-flash": ModelInfo(
        "Gemini 2.0 Flash (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.0-flash-lite": ModelInfo(
        "Gemini 2.0 Flash Lite (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-flash-lite": ModelInfo(
        "Gemini 2.5 Flash Lite (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-flash-lite-preview-06-17": ModelInfo(
        "Gemini 2.5 Flash Lite Preview 06-17 (Google Vertex)",
        AgentKind.OPENCODE,
        65_536,
    ),
    "opencode:google-vertex/gemini-2.5-flash-lite-preview-09-2025": ModelInfo(
        "Gemini 2.5 Flash Lite Preview 09-25 (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
    ),
    "opencode:google-vertex/gemini-2.5-flash-preview-04-17": ModelInfo(
        "Gemini 2.5 Flash Preview 04-17 (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-flash-preview-05-20": ModelInfo(
        "Gemini 2.5 Flash Preview 05-20 (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-flash-preview-09-2025": ModelInfo(
        "Gemini 2.5 Flash Preview 09-25 (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-pro-preview-05-06": ModelInfo(
        "Gemini 2.5 Pro Preview 05-06 (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-2.5-pro-preview-06-05": ModelInfo(
        "Gemini 2.5 Pro Preview 06-05 (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3-pro-preview": ModelInfo(
        "Gemini 3 Pro Preview (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3.1-pro-preview": ModelInfo(
        "Gemini 3.1 Pro Preview (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-3.1-pro-preview-customtools": ModelInfo(
        "Gemini 3.1 Pro Preview Custom Tools (Google Vertex)",
        AgentKind.OPENCODE,
        1_048_576,
    ),
    "opencode:google-vertex/gemini-embedding-001": ModelInfo(
        "Gemini Embedding 001 (Google Vertex)", AgentKind.OPENCODE, 2048
    ),
    "opencode:google-vertex/gemini-flash-latest": ModelInfo(
        "Gemini Flash Latest (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/gemini-flash-lite-latest": ModelInfo(
        "Gemini Flash-Lite Latest (Google Vertex)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:google-vertex/meta/llama-3.3-70b-instruct-maas": ModelInfo(
        "Llama 3.3 70B Instruct (Google Vertex)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:google-vertex/meta/llama-4-maverick-17b-128e-instruct-maas": ModelInfo(
        "Llama 4 Maverick 17B 128E Instruct (Google Vertex)",
        AgentKind.OPENCODE,
        524_288,
    ),
    "opencode:google-vertex/moonshotai/kimi-k2-thinking-maas": ModelInfo(
        "Kimi K2 Thinking (Google Vertex)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:google-vertex/openai/gpt-oss-120b-maas": ModelInfo(
        "GPT OSS 120B (Google Vertex)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google-vertex/openai/gpt-oss-20b-maas": ModelInfo(
        "GPT OSS 20B (Google Vertex)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:google-vertex/qwen/qwen3-235b-a22b-instruct-2507-maas": ModelInfo(
        "Qwen3 235B A22B Instruct (Google Vertex)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:google-vertex/zai-org/glm-4.7-maas": ModelInfo(
        "GLM-4.7 (Google Vertex)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex/zai-org/glm-5-maas": ModelInfo(
        "GLM-5 (Google Vertex)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:google-vertex-anthropic/claude-3-5-haiku@20241022": ModelInfo(
        "Claude Haiku 3.5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-3-5-sonnet@20241022": ModelInfo(
        "Claude Sonnet 3.5 v2 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-3-7-sonnet@20250219": ModelInfo(
        "Claude Sonnet 3.7 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-haiku-4-5@20251001": ModelInfo(
        "Claude Haiku 4.5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-opus-4-1@20250805": ModelInfo(
        "Claude Opus 4.1 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
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
    "opencode:google-vertex-anthropic/claude-opus-4@20250514": ModelInfo(
        "Claude Opus 4 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-sonnet-4-5@20250929": ModelInfo(
        "Claude Sonnet 4.5 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-sonnet-4-6@default": ModelInfo(
        "Claude Sonnet 4.6 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:google-vertex-anthropic/claude-sonnet-4@20250514": ModelInfo(
        "Claude Sonnet 4 (Google Vertex Anthropic)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openai/gpt-5-codex": ModelInfo(
        "GPT-5-Codex (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.1-codex": ModelInfo(
        "GPT-5.1 Codex (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.1-codex-max": ModelInfo(
        "GPT-5.1 Codex Max (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.1-codex-mini": ModelInfo(
        "GPT-5.1 Codex mini (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.2": ModelInfo(
        "GPT-5.2 (Openai)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openai/gpt-5.2-codex": ModelInfo(
        "GPT-5.2 Codex (Openai)", AgentKind.OPENCODE, 400_000
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
    "opencode:openrouter/anthropic/claude-3.5-haiku": ModelInfo(
        "Claude Haiku 3.5 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-3.7-sonnet": ModelInfo(
        "Claude Sonnet 3.7 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-haiku-4.5": ModelInfo(
        "Claude Haiku 4.5 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4": ModelInfo(
        "Claude Opus 4 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.1": ModelInfo(
        "Claude Opus 4.1 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.5": ModelInfo(
        "Claude Opus 4.5 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.6": ModelInfo(
        "Claude Opus 4.6 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-opus-4.7": ModelInfo(
        "Claude Opus 4.7 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4": ModelInfo(
        "Claude Sonnet 4 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4.5": ModelInfo(
        "Claude Sonnet 4.5 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/anthropic/claude-sonnet-4.6": ModelInfo(
        "Claude Sonnet 4.6 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/arcee-ai/trinity-large-preview:free": ModelInfo(
        "Trinity Large Preview (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/arcee-ai/trinity-large-thinking": ModelInfo(
        "Trinity Large Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/black-forest-labs/flux.2-flex": ModelInfo(
        "FLUX.2 Flex (Openrouter)", AgentKind.OPENCODE, 67_344
    ),
    "opencode:openrouter/black-forest-labs/flux.2-klein-4b": ModelInfo(
        "FLUX.2 Klein 4B (Openrouter)", AgentKind.OPENCODE, 40_960
    ),
    "opencode:openrouter/black-forest-labs/flux.2-max": ModelInfo(
        "FLUX.2 Max (Openrouter)", AgentKind.OPENCODE, 46_864
    ),
    "opencode:openrouter/black-forest-labs/flux.2-pro": ModelInfo(
        "FLUX.2 Pro (Openrouter)", AgentKind.OPENCODE, 46_864
    ),
    "opencode:openrouter/bytedance-seed/seedream-4.5": ModelInfo(
        "Seedream 4.5 (Openrouter)", AgentKind.OPENCODE, 4096
    ),
    "opencode:openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition:free": ModelInfo(
        "Uncensored (free) (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/deepseek/deepseek-chat-v3-0324": ModelInfo(
        "DeepSeek V3 0324 (Openrouter)", AgentKind.OPENCODE, 16_384
    ),
    "opencode:openrouter/deepseek/deepseek-chat-v3.1": ModelInfo(
        "DeepSeek-V3.1 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-r1": ModelInfo(
        "DeepSeek: R1 (Openrouter)", AgentKind.OPENCODE, 64_000
    ),
    "opencode:openrouter/deepseek/deepseek-r1-distill-llama-70b": ModelInfo(
        "DeepSeek R1 Distill Llama 70B (Openrouter)", AgentKind.OPENCODE, 8192
    ),
    "opencode:openrouter/deepseek/deepseek-v3.1-terminus": ModelInfo(
        "DeepSeek V3.1 Terminus (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/deepseek/deepseek-v3.1-terminus:exacto": ModelInfo(
        "DeepSeek V3.1 Terminus (exacto) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/deepseek/deepseek-v3.2": ModelInfo(
        "DeepSeek V3.2 (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/deepseek/deepseek-v3.2-speciale": ModelInfo(
        "DeepSeek V3.2 Speciale (Openrouter)", AgentKind.OPENCODE, 163_840
    ),
    "opencode:openrouter/google/gemini-2.0-flash-001": ModelInfo(
        "Gemini 2.0 Flash (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-flash": ModelInfo(
        "Gemini 2.5 Flash (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-flash-lite": ModelInfo(
        "Gemini 2.5 Flash Lite (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-flash-lite-preview-09-2025": ModelInfo(
        "Gemini 2.5 Flash Lite Preview 09-25 (Openrouter)",
        AgentKind.OPENCODE,
        1_048_576,
    ),
    "opencode:openrouter/google/gemini-2.5-flash-preview-09-2025": ModelInfo(
        "Gemini 2.5 Flash Preview 09-25 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-pro": ModelInfo(
        "Gemini 2.5 Pro (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-pro-preview-05-06": ModelInfo(
        "Gemini 2.5 Pro Preview 05-06 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-2.5-pro-preview-06-05": ModelInfo(
        "Gemini 2.5 Pro Preview 06-05 (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3-flash-preview": ModelInfo(
        "Gemini 3 Flash Preview (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/google/gemini-3-pro-preview": ModelInfo(
        "Gemini 3 Pro Preview (Openrouter)", AgentKind.OPENCODE, 1_050_000
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
    "opencode:openrouter/google/gemma-2-9b-it": ModelInfo(
        "Gemma 2 9B (Openrouter)", AgentKind.OPENCODE, 8192
    ),
    "opencode:openrouter/google/gemma-3-12b-it": ModelInfo(
        "Gemma 3 12B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemma-3-12b-it:free": ModelInfo(
        "Gemma 3 12B (free) (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/google/gemma-3-27b-it": ModelInfo(
        "Gemma 3 27B (Openrouter)", AgentKind.OPENCODE, 96_000
    ),
    "opencode:openrouter/google/gemma-3-27b-it:free": ModelInfo(
        "Gemma 3 27B (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/google/gemma-3-4b-it": ModelInfo(
        "Gemma 3 4B (Openrouter)", AgentKind.OPENCODE, 96_000
    ),
    "opencode:openrouter/google/gemma-3-4b-it:free": ModelInfo(
        "Gemma 3 4B (free) (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/google/gemma-3n-e2b-it:free": ModelInfo(
        "Gemma 3n 2B (free) (Openrouter)", AgentKind.OPENCODE, 8192
    ),
    "opencode:openrouter/google/gemma-3n-e4b-it": ModelInfo(
        "Gemma 3n 4B (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/google/gemma-3n-e4b-it:free": ModelInfo(
        "Gemma 3n 4B (free) (Openrouter)", AgentKind.OPENCODE, 8192
    ),
    "opencode:openrouter/google/gemma-4-26b-a4b-it": ModelInfo(
        "Gemma 4 26B A4B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/gemma-4-26b-a4b-it:free": ModelInfo(
        "Gemma 4 26B A4B (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/gemma-4-31b-it": ModelInfo(
        "Gemma 4 31B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/google/gemma-4-31b-it:free": ModelInfo(
        "Gemma 4 31B (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/inception/mercury-2": ModelInfo(
        "Mercury 2 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/inception/mercury-edit-2": ModelInfo(
        "Mercury Edit 2 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/liquid/lfm-2.5-1.2b-instruct:free": ModelInfo(
        "LFM2.5-1.2B-Instruct (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/liquid/lfm-2.5-1.2b-thinking:free": ModelInfo(
        "LFM2.5-1.2B-Thinking (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/meta-llama/llama-3.2-11b-vision-instruct": ModelInfo(
        "Llama 3.2 11B Vision Instruct (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/meta-llama/llama-3.2-3b-instruct:free": ModelInfo(
        "Llama 3.2 3B Instruct (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/meta-llama/llama-3.3-70b-instruct:free": ModelInfo(
        "Llama 3.3 70B Instruct (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/minimax/minimax-01": ModelInfo(
        "MiniMax-01 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/minimax/minimax-m1": ModelInfo(
        "MiniMax M1 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/minimax/minimax-m2": ModelInfo(
        "MiniMax M2 (Openrouter)", AgentKind.OPENCODE, 196_600
    ),
    "opencode:openrouter/minimax/minimax-m2.1": ModelInfo(
        "MiniMax M2.1 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/minimax/minimax-m2.5": ModelInfo(
        "MiniMax M2.5 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/minimax/minimax-m2.5:free": ModelInfo(
        "MiniMax M2.5 (free) (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/minimax/minimax-m2.7": ModelInfo(
        "MiniMax M2.7 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/mistralai/codestral-2508": ModelInfo(
        "Codestral 2508 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/mistralai/devstral-2512": ModelInfo(
        "Devstral 2 2512 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/devstral-medium-2507": ModelInfo(
        "Devstral Medium (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/devstral-small-2505": ModelInfo(
        "Devstral Small (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/mistralai/devstral-small-2507": ModelInfo(
        "Devstral Small 1.1 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/mistral-medium-3": ModelInfo(
        "Mistral Medium 3 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/mistralai/mistral-medium-3.1": ModelInfo(
        "Mistral Medium 3.1 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/mistral-small-2603": ModelInfo(
        "Mistral Small 4 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/mistralai/mistral-small-3.1-24b-instruct": ModelInfo(
        "Mistral Small 3.1 24B Instruct (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/mistralai/mistral-small-3.2-24b-instruct": ModelInfo(
        "Mistral Small 3.2 24B Instruct (Openrouter)", AgentKind.OPENCODE, 96_000
    ),
    "opencode:openrouter/moonshotai/kimi-k2": ModelInfo(
        "Kimi K2 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/moonshotai/kimi-k2-0905": ModelInfo(
        "Kimi K2 Instruct 0905 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2-0905:exacto": ModelInfo(
        "Kimi K2 Instruct 0905 (exacto) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2-thinking": ModelInfo(
        "Kimi K2 Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/moonshotai/kimi-k2.5": ModelInfo(
        "Kimi K2.5 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nousresearch/hermes-3-llama-3.1-405b:free": ModelInfo(
        "Hermes 3 405B Instruct (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nousresearch/hermes-4-405b": ModelInfo(
        "Hermes 4 405B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nousresearch/hermes-4-70b": ModelInfo(
        "Hermes 4 70B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nvidia/nemotron-3-nano-30b-a3b:free": ModelInfo(
        "Nemotron 3 Nano 30B A3B (free) (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/nvidia/nemotron-3-super-120b-a12b": ModelInfo(
        "Nemotron 3 Super (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nvidia/nemotron-3-super-120b-a12b:free": ModelInfo(
        "Nemotron 3 Super (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/nvidia/nemotron-nano-12b-v2-vl:free": ModelInfo(
        "Nemotron Nano 12B 2 VL (free) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/nvidia/nemotron-nano-9b-v2": ModelInfo(
        "nvidia-nemotron-nano-9b-v2 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/nvidia/nemotron-nano-9b-v2:free": ModelInfo(
        "Nemotron Nano 9B V2 (free) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-4.1": ModelInfo(
        "GPT-4.1 (Openrouter)", AgentKind.OPENCODE, 1_047_576
    ),
    "opencode:openrouter/openai/gpt-4.1-mini": ModelInfo(
        "GPT-4.1 Mini (Openrouter)", AgentKind.OPENCODE, 1_047_576
    ),
    "opencode:openrouter/openai/gpt-4o-mini": ModelInfo(
        "GPT-4o-mini (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-5": ModelInfo(
        "GPT-5 (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-codex": ModelInfo(
        "GPT-5 Codex (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5-image": ModelInfo(
        "GPT-5 Image (Openrouter)", AgentKind.OPENCODE, 400_000
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
        "GPT-5.1-Codex (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.1-codex-max": ModelInfo(
        "GPT-5.1-Codex-Max (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.1-codex-mini": ModelInfo(
        "GPT-5.1-Codex-Mini (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.2": ModelInfo(
        "GPT-5.2 (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.2-chat": ModelInfo(
        "GPT-5.2 Chat (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/openai/gpt-5.2-codex": ModelInfo(
        "GPT-5.2-Codex (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.2-pro": ModelInfo(
        "GPT-5.2 Pro (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.3-codex": ModelInfo(
        "GPT-5.3-Codex (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.4": ModelInfo(
        "GPT-5.4 (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-5.4-mini": ModelInfo(
        "GPT-5.4 Mini (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.4-nano": ModelInfo(
        "GPT-5.4 Nano (Openrouter)", AgentKind.OPENCODE, 400_000
    ),
    "opencode:openrouter/openai/gpt-5.4-pro": ModelInfo(
        "GPT-5.4 Pro (Openrouter)", AgentKind.OPENCODE, 1_050_000
    ),
    "opencode:openrouter/openai/gpt-oss-120b": ModelInfo(
        "GPT OSS 120B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-120b:exacto": ModelInfo(
        "GPT OSS 120B (exacto) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-120b:free": ModelInfo(
        "gpt-oss-120b (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-20b": ModelInfo(
        "GPT OSS 20B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-20b:free": ModelInfo(
        "gpt-oss-20b (free) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/gpt-oss-safeguard-20b": ModelInfo(
        "GPT OSS Safeguard 20B (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/openai/o4-mini": ModelInfo(
        "o4 Mini (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/openrouter/elephant-alpha": ModelInfo(
        "Elephant (free) (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/openrouter/free": ModelInfo(
        "Free Models Router (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/prime-intellect/intellect-3": ModelInfo(
        "Intellect 3 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen-2.5-coder-32b-instruct": ModelInfo(
        "Qwen2.5 Coder 32B Instruct (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/qwen/qwen2.5-vl-72b-instruct": ModelInfo(
        "Qwen2.5 VL 72B Instruct (Openrouter)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:openrouter/qwen/qwen3-235b-a22b-07-25": ModelInfo(
        "Qwen3 235B A22B Instruct 2507 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-235b-a22b-thinking-2507": ModelInfo(
        "Qwen3 235B A22B Thinking 2507 (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-30b-a3b-instruct-2507": ModelInfo(
        "Qwen3 30B A3B Instruct 2507 (Openrouter)", AgentKind.OPENCODE, 262_000
    ),
    "opencode:openrouter/qwen/qwen3-30b-a3b-thinking-2507": ModelInfo(
        "Qwen3 30B A3B Thinking 2507 (Openrouter)", AgentKind.OPENCODE, 262_000
    ),
    "opencode:openrouter/qwen/qwen3-coder": ModelInfo(
        "Qwen3 Coder (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-coder-30b-a3b-instruct": ModelInfo(
        "Qwen3 Coder 30B A3B Instruct (Openrouter)", AgentKind.OPENCODE, 160_000
    ),
    "opencode:openrouter/qwen/qwen3-coder-flash": ModelInfo(
        "Qwen3 Coder Flash (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/qwen/qwen3-coder:exacto": ModelInfo(
        "Qwen3 Coder (exacto) (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/qwen/qwen3-max": ModelInfo(
        "Qwen3 Max (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-next-80b-a3b-instruct": ModelInfo(
        "Qwen3 Next 80B A3B Instruct (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3-next-80b-a3b-thinking": ModelInfo(
        "Qwen3 Next 80B A3B Thinking (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-397b-a17b": ModelInfo(
        "Qwen3.5 397B A17B (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/qwen/qwen3.5-flash-02-23": ModelInfo(
        "Qwen: Qwen3.5-Flash (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.5-plus-02-15": ModelInfo(
        "Qwen3.5 Plus 2026-02-15 (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/qwen/qwen3.6-plus": ModelInfo(
        "Qwen3.6 Plus (Openrouter)", AgentKind.OPENCODE, 1_000_000
    ),
    "opencode:openrouter/sourceful/riverflow-v2-fast-preview": ModelInfo(
        "Riverflow V2 Fast Preview (Openrouter)", AgentKind.OPENCODE, 8192
    ),
    "opencode:openrouter/sourceful/riverflow-v2-max-preview": ModelInfo(
        "Riverflow V2 Max Preview (Openrouter)", AgentKind.OPENCODE, 8192
    ),
    "opencode:openrouter/sourceful/riverflow-v2-standard-preview": ModelInfo(
        "Riverflow V2 Standard Preview (Openrouter)", AgentKind.OPENCODE, 8192
    ),
    "opencode:openrouter/stepfun/step-3.5-flash": ModelInfo(
        "Step 3.5 Flash (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/x-ai/grok-3": ModelInfo(
        "Grok 3 (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/x-ai/grok-3-beta": ModelInfo(
        "Grok 3 Beta (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/x-ai/grok-3-mini": ModelInfo(
        "Grok 3 Mini (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/x-ai/grok-3-mini-beta": ModelInfo(
        "Grok 3 Mini Beta (Openrouter)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:openrouter/x-ai/grok-4": ModelInfo(
        "Grok 4 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/x-ai/grok-4-fast": ModelInfo(
        "Grok 4 Fast (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/x-ai/grok-4.1-fast": ModelInfo(
        "Grok 4.1 Fast (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/x-ai/grok-4.20-beta": ModelInfo(
        "Grok 4.20 Beta (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/x-ai/grok-4.20-multi-agent-beta": ModelInfo(
        "Grok 4.20 Multi - Agent Beta (Openrouter)", AgentKind.OPENCODE, 2_000_000
    ),
    "opencode:openrouter/x-ai/grok-code-fast-1": ModelInfo(
        "Grok Code Fast 1 (Openrouter)", AgentKind.OPENCODE, 256_000
    ),
    "opencode:openrouter/xiaomi/mimo-v2-flash": ModelInfo(
        "MiMo-V2-Flash (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/xiaomi/mimo-v2-omni": ModelInfo(
        "MiMo-V2-Omni (Openrouter)", AgentKind.OPENCODE, 262_144
    ),
    "opencode:openrouter/xiaomi/mimo-v2-pro": ModelInfo(
        "MiMo-V2-Pro (Openrouter)", AgentKind.OPENCODE, 1_048_576
    ),
    "opencode:openrouter/z-ai/glm-4.5": ModelInfo(
        "GLM 4.5 (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/z-ai/glm-4.5-air": ModelInfo(
        "GLM 4.5 Air (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/z-ai/glm-4.5-air:free": ModelInfo(
        "GLM 4.5 Air (free) (Openrouter)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:openrouter/z-ai/glm-4.5v": ModelInfo(
        "GLM 4.5V (Openrouter)", AgentKind.OPENCODE, 64_000
    ),
    "opencode:openrouter/z-ai/glm-4.6": ModelInfo(
        "GLM 4.6 (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/z-ai/glm-4.6:exacto": ModelInfo(
        "GLM 4.6 (exacto) (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/z-ai/glm-4.7": ModelInfo(
        "GLM-4.7 (Openrouter)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:openrouter/z-ai/glm-4.7-flash": ModelInfo(
        "GLM-4.7-Flash (Openrouter)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:openrouter/z-ai/glm-5": ModelInfo(
        "GLM-5 (Openrouter)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:openrouter/z-ai/glm-5-turbo": ModelInfo(
        "GLM-5-Turbo (Openrouter)", AgentKind.OPENCODE, 202_752
    ),
    "opencode:openrouter/z-ai/glm-5.1": ModelInfo(
        "GLM-5.1 (Openrouter)", AgentKind.OPENCODE, 202_752
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
    "opencode:perplexity-agent/perplexity/sonar": ModelInfo(
        "Sonar (Perplexity Agent)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:perplexity-agent/xai/grok-4-1-fast-non-reasoning": ModelInfo(
        "Grok 4.1 Fast (Non-Reasoning) (Perplexity Agent)",
        AgentKind.OPENCODE,
        2_000_000,
    ),
    "opencode:zai-coding-plan/glm-4.5": ModelInfo(
        "GLM-4.5 (Zai Coding Plan)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:zai-coding-plan/glm-4.5-air": ModelInfo(
        "GLM-4.5-Air (Zai Coding Plan)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:zai-coding-plan/glm-4.5-flash": ModelInfo(
        "GLM-4.5-Flash (Zai Coding Plan)", AgentKind.OPENCODE, 131_072
    ),
    "opencode:zai-coding-plan/glm-4.5v": ModelInfo(
        "GLM-4.5V (Zai Coding Plan)", AgentKind.OPENCODE, 64_000
    ),
    "opencode:zai-coding-plan/glm-4.6": ModelInfo(
        "GLM-4.6 (Zai Coding Plan)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:zai-coding-plan/glm-4.6v": ModelInfo(
        "GLM-4.6V (Zai Coding Plan)", AgentKind.OPENCODE, 128_000
    ),
    "opencode:zai-coding-plan/glm-4.7": ModelInfo(
        "GLM-4.7 (Zai Coding Plan)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:zai-coding-plan/glm-4.7-flash": ModelInfo(
        "GLM-4.7-Flash (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:zai-coding-plan/glm-4.7-flashx": ModelInfo(
        "GLM-4.7-FlashX (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:zai-coding-plan/glm-5": ModelInfo(
        "GLM-5 (Zai Coding Plan)", AgentKind.OPENCODE, 204_800
    ),
    "opencode:zai-coding-plan/glm-5-turbo": ModelInfo(
        "GLM-5-Turbo (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:zai-coding-plan/glm-5.1": ModelInfo(
        "GLM-5.1 (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
    ),
    "opencode:zai-coding-plan/glm-5v-turbo": ModelInfo(
        "glm-5v-turbo (Zai Coding Plan)", AgentKind.OPENCODE, 200_000
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
