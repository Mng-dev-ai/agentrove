import logging
from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.websocket.types import AuthenticatedTerminalUser
from app.core.security import get_user_from_token
from app.services.exceptions import UserException
from app.services.sandbox_providers import SandboxProviderType
from app.services.user import UserService

logger = logging.getLogger(__name__)


class AuthenticateTerminalUserAction:
    def __init__(self, session_factory: Callable[[], AsyncSession]) -> None:
        self._session_factory = session_factory
        self._user_service = UserService(session_factory=session_factory)

    async def execute(self, token: str) -> AuthenticatedTerminalUser:
        try:
            async with self._session_factory() as db:
                user = await get_user_from_token(token, db)
                if not user:
                    return AuthenticatedTerminalUser(
                        user=None,
                        e2b_api_key=None,
                        modal_api_key=None,
                        sandbox_provider=SandboxProviderType.DOCKER.value,
                    )

                try:
                    user_settings = await self._user_service.get_user_settings(
                        user.id, db=db
                    )
                    return AuthenticatedTerminalUser(
                        user=user,
                        e2b_api_key=user_settings.e2b_api_key,
                        modal_api_key=user_settings.modal_api_key,
                        sandbox_provider=user_settings.sandbox_provider,
                    )
                except UserException:
                    return AuthenticatedTerminalUser(
                        user=user,
                        e2b_api_key=None,
                        modal_api_key=None,
                        sandbox_provider=SandboxProviderType.DOCKER.value,
                    )
        except Exception as exc:
            logger.warning("WebSocket authentication failed: %s", exc)
            return AuthenticatedTerminalUser(
                user=None,
                e2b_api_key=None,
                modal_api_key=None,
                sandbox_provider=SandboxProviderType.DOCKER.value,
            )
