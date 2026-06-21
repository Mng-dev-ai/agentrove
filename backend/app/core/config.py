import logging
import platform
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings
from pythonjsonlogger import jsonlogger

DEFAULT_STORAGE_PATH = "/data/agentrove/storage"
DEFAULT_DATABASE_URL = f"sqlite+aiosqlite:///{DEFAULT_STORAGE_PATH}/agentrove.db"


def _desktop_data_dir() -> Path:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "com.agentrove.app"
    if system == "Windows":
        return Path.home() / "AppData" / "Roaming" / "com.agentrove.app"
    return Path.home() / ".local" / "share" / "com.agentrove.app"


class Settings(BaseSettings):
    DESKTOP_MODE: bool = False

    BASE_URL: str = "http://localhost:8080"
    FRONTEND_URL: str = "http://localhost:3000"
    PROJECT_NAME: str = "AI Generation API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"  # "development" or "production"
    REQUIRE_EMAIL_VERIFICATION: bool = False
    REGISTRATION_DISABLED: bool = False

    DATABASE_URL: str = DEFAULT_DATABASE_URL
    REDIS_URL: str = "redis://localhost:6379/0"

    SECRET_KEY: str = ""
    SESSION_SECRET_KEY: str | None = None
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    STORAGE_PATH: str = DEFAULT_STORAGE_PATH

    ALLOWED_ORIGINS: str | list[str] = [
        "http://localhost:3000",
        "https://agentrove.pro",
    ]

    TRUSTED_PROXY_HOSTS: str | list[str] = "127.0.0.1"
    DISABLE_PROXY_HEADERS: bool = False

    @field_validator("TRUSTED_PROXY_HOSTS", mode="before")
    @classmethod
    def parse_trusted_hosts(cls, v: str | list[str]) -> str | list[str]:
        if isinstance(v, str):
            if v == "*":
                return "*"
            return [host.strip() for host in v.split(",")]
        return v

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if not v:
            raise ValueError("SECRET_KEY must be set in environment variables")
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long")
        return v

    @model_validator(mode="after")
    def apply_desktop_defaults(self) -> "Settings":
        # Desktop (Tauri) mode redirects the SQLite DB and storage path to a
        # platform-specific user data dir, and adds Tauri origins so the
        # webview can reach the local API.
        if not self.DESKTOP_MODE:
            return self
        data_dir = _desktop_data_dir()
        data_dir.mkdir(parents=True, exist_ok=True)
        default_db = f"sqlite+aiosqlite:///{(data_dir / 'agentrove.db').as_posix()}"
        if self.DATABASE_URL == DEFAULT_DATABASE_URL:
            self.DATABASE_URL = default_db
        if self.STORAGE_PATH == DEFAULT_STORAGE_PATH:
            self.STORAGE_PATH = str(data_dir / "storage")
            Path(self.STORAGE_PATH).mkdir(parents=True, exist_ok=True)
        origins = (
            self.ALLOWED_ORIGINS
            if isinstance(self.ALLOWED_ORIGINS, list)
            else [self.ALLOWED_ORIGINS]
        )
        for origin in [
            "tauri://localhost",
            "https://tauri.localhost",
            "http://tauri.localhost",
        ]:
            if origin not in origins:
                origins.append(origin)
        self.ALLOWED_ORIGINS = origins
        return self

    @field_validator("SESSION_SECRET_KEY", mode="before")
    @classmethod
    def set_session_secret(cls, v: str | None, info: ValidationInfo) -> str | None:
        if v:
            return v
        secret_key = info.data.get("SECRET_KEY")
        if secret_key:
            return f"{secret_key}_session"
        return None

    MAX_UPLOAD_SIZE: int = 5 * 1024 * 1024  # 5MB max file size
    ALLOWED_IMAGE_TYPES: list[str] = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
    ]  # That's what Claude supports for now
    ALLOWED_FILE_TYPES: list[str] = ALLOWED_IMAGE_TYPES + [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]

    # Email configuration
    MAIL_USERNAME: str = "apikey"
    MAIL_PASSWORD: str | None = None
    MAIL_FROM: str = "noreply@agentrove.pro"
    MAIL_FROM_NAME: str = "Agentrove"
    MAIL_PORT: int = 587
    MAIL_SERVER: str = "smtp.sendgrid.net"
    MAIL_STARTTLS: bool = True
    MAIL_SSL_TLS: bool = False

    # Email validation settings
    BLOCK_DISPOSABLE_EMAILS: bool = True

    # Logging configuration
    LOG_LEVEL: str = "INFO"

    # Git configuration
    GIT_AUTHOR_NAME: str = ""
    GIT_AUTHOR_EMAIL: str = ""
    # Resolved once at startup so host-provider subprocesses (which override
    # HOME to the sandbox dir) still read the real user's global git config
    # and GPG keyring for commit signing.
    GIT_CONFIG_GLOBAL: str = str(Path.home() / ".gitconfig")
    GNUPGHOME: str = str(Path.home() / ".gnupg")

    # Docker Sandbox configuration
    DOCKER_IMAGE: str = "ghcr.io/mng-dev-ai/agentrove-sandbox:latest"
    DOCKER_NETWORK: str = "agentrove-sandbox-net"
    DOCKER_HOST: str | None = None
    DOCKER_MEM_LIMIT: str = "4g"
    DOCKER_CPU_PERIOD: int = 100000
    DOCKER_CPU_QUOTA: int = 200000
    DOCKER_PIDS_LIMIT: int = 512

    # Host Sandbox configuration
    HOST_SANDBOX_BASE_DIR: str | None = None
    HOST_PREVIEW_BASE_URL: str = "http://localhost"

    @field_validator("HOST_SANDBOX_BASE_DIR", mode="before")
    @classmethod
    def set_host_sandbox_base_dir(
        cls, v: str | None, info: ValidationInfo
    ) -> str | None:
        if v:
            return v
        storage_path = info.data.get("STORAGE_PATH", DEFAULT_STORAGE_PATH)
        return f"{storage_path.rstrip('/')}/host-sandboxes"

    def get_host_sandbox_base_dir(self) -> str:
        if self.HOST_SANDBOX_BASE_DIR:
            return self.HOST_SANDBOX_BASE_DIR
        return f"{self.STORAGE_PATH.rstrip('/')}/host-sandboxes"

    # Security Headers Configuration
    ENABLE_SECURITY_HEADERS: bool = True
    HSTS_MAX_AGE: int = 31536000
    HSTS_INCLUDE_SUBDOMAINS: bool = True
    HSTS_PRELOAD: bool = False
    FRAME_OPTIONS: str = "DENY"
    CONTENT_TYPE_OPTIONS: str = "nosniff"
    XSS_PROTECTION: str = "1; mode=block"
    REFERRER_POLICY: str = "strict-origin-when-cross-origin"
    PERMISSIONS_POLICY: str = "geolocation=(), microphone=(), camera=()"

    # TTL Configuration (in seconds)
    BACKGROUND_CHAT_SHUTDOWN_TIMEOUT_SECONDS: float = 30.0
    DISPOSABLE_DOMAINS_CACHE_TTL_SECONDS: int = 3600

    USER_SETTINGS_CACHE_TTL_SECONDS: int = 300
    MODELS_CACHE_TTL_SECONDS: int = 3600
    CONTEXT_USAGE_CACHE_TTL_SECONDS: int = 600
    CHAT_PROCESS_IDLE_TTL_SECONDS: float = 1800.0

    class Config:
        env_file = ".env"
        case_sensitive = True


class StructuredJsonFormatter(jsonlogger.JsonFormatter):
    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record["timestamp"] = datetime.now(timezone.utc).isoformat()
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["module"] = record.module
        log_record["function"] = record.funcName
        log_record["line"] = record.lineno

        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)


def _setup_logging(log_level: str, use_json: bool = True) -> None:
    level = getattr(logging, log_level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)

    formatter: logging.Formatter
    if use_json:
        formatter = StructuredJsonFormatter(
            "%(timestamp)s %(level)s %(name)s %(message)s"
        )
    else:
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )

    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    _setup_logging(settings.LOG_LEVEL)
    return settings
