from dataclasses import dataclass

from app.models.db_models import User
from app.services.sandbox_providers import SandboxProviderType


@dataclass(frozen=True)
class AuthenticatedTerminalUser:
    user: User | None
    e2b_api_key: str | None
    modal_api_key: str | None
    sandbox_provider: str


@dataclass(frozen=True)
class SandboxAccessResult:
    provider_type: SandboxProviderType | None
    api_key: str | None
    close_code: int | None = None
    close_reason: str | None = None
