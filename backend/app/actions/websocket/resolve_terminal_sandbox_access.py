from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.websocket.types import SandboxAccessResult
from app.constants import WS_CLOSE_API_KEY_REQUIRED, WS_CLOSE_SANDBOX_NOT_FOUND
from app.models.db_models import Chat, User
from app.services.sandbox_providers import SandboxProviderType


class ResolveTerminalSandboxAccessAction:
    def __init__(self, session_factory: Callable[[], AsyncSession]) -> None:
        self._session_factory = session_factory

    async def execute(
        self,
        sandbox_id: str,
        user: User,
        e2b_api_key: str | None,
        modal_api_key: str | None,
        user_sandbox_provider: str,
    ) -> SandboxAccessResult:
        async with self._session_factory() as db:
            query = select(Chat.sandbox_provider).where(
                Chat.sandbox_id == sandbox_id,
                Chat.user_id == user.id,
                Chat.deleted_at.is_(None),
            )
            result = await db.execute(query)
            row = result.one_or_none()
            if not row:
                return SandboxAccessResult(
                    provider_type=None,
                    api_key=None,
                    close_code=WS_CLOSE_SANDBOX_NOT_FOUND,
                    close_reason="Sandbox not found",
                )

            sandbox_provider_type = row.sandbox_provider or user_sandbox_provider

        provider_type = SandboxProviderType(sandbox_provider_type)
        if provider_type == SandboxProviderType.E2B and not e2b_api_key:
            return SandboxAccessResult(
                provider_type=None,
                api_key=None,
                close_code=WS_CLOSE_API_KEY_REQUIRED,
                close_reason="E2B API key is required. Please configure your E2B API key in Settings.",
            )

        if provider_type == SandboxProviderType.MODAL and not modal_api_key:
            return SandboxAccessResult(
                provider_type=None,
                api_key=None,
                close_code=WS_CLOSE_API_KEY_REQUIRED,
                close_reason="Modal API key is required. Please configure your Modal API key in Settings.",
            )

        api_key = None
        if provider_type == SandboxProviderType.E2B:
            api_key = e2b_api_key
        elif provider_type == SandboxProviderType.MODAL:
            api_key = modal_api_key

        return SandboxAccessResult(provider_type=provider_type, api_key=api_key)
