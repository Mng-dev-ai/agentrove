from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import LogoutRequest
from app.services.refresh_token import RefreshTokenService


class LogoutAction:
    def __init__(self, refresh_token_service: RefreshTokenService) -> None:
        self._refresh_token_service = refresh_token_service

    async def execute(
        self,
        logout_request: LogoutRequest,
        db: AsyncSession,
    ) -> None:
        await self._refresh_token_service.revoke_token(logout_request.refresh_token, db)
