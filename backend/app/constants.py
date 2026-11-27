from typing import Final

from app.core.config import get_settings

settings = get_settings()

REDIS_KEY_USER_STREAMS_LIVE: Final[str] = "user:{user_id}:streams:live"
REDIS_KEY_USER_CHATS_LIVE: Final[str] = "user:{user_id}:chats:live"
REDIS_KEY_USER_SETTINGS: Final[str] = "user_settings:{user_id}"
REDIS_KEY_CHAT_CONTEXT_USAGE: Final[str] = "chat:{chat_id}:context_usage"
REDIS_KEY_USER_RATE_LIMITS: Final[str] = "user:{user_id}:rate_limits"
REDIS_KEY_CHAT_QUEUE: Final[str] = "chat:{queue_id}:queue"
REDIS_KEY_CHANNEL_QUEUE: Final[str] = "channel:{queue_id}:queue"
REDIS_KEY_CHAT_QUEUE_SEND_NOW: Final[str] = "chat:{chat_id}:queue:send_now"

QUEUE_SEND_NOW_TTL_SECONDS: Final[int] = 3600
# Kept for windows with no reset time; the longest Claude window is seven days.
RATE_LIMITS_FALLBACK_TTL_SECONDS: Final[int] = 7 * 24 * 3600

# JSON-RPC code ACP agents return from load_session for an unknown session.
ACP_RESOURCE_NOT_FOUND: Final[int] = -32002

# Default model for chat title generation — cheap and fast; user-overridable in settings.
DEFAULT_TITLE_MODEL_ID: Final[str] = "haiku"

SANDBOX_DEFAULT_COMMAND_TIMEOUT: Final[int] = 120
PTY_OUTPUT_QUEUE_SIZE: Final[int] = 512
PTY_INPUT_QUEUE_SIZE: Final[int] = 1024

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
