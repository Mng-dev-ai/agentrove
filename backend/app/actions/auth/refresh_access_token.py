from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import get_jwt_strategy
from app.models.schemas import RefreshTokenRequest, Token
from app.services.exceptions import AuthException
from app.services.refresh_token import RefreshTokenService


class RefreshAccessTokenAction:
    def __init__(self, refresh_token_service: RefreshTokenService) -> None:
        self._refresh_token_service = refresh_token_service

    async def execute(
        self,
        request: Request,
        refresh_request: RefreshTokenRequest,
        db: AsyncSession,
    ) -> Token:
        try:
            user_agent = request.headers.get("user-agent")
            client_ip = request.client.host if request.client else None

            user, new_refresh_token = await self._refresh_token_service.validate_and_rotate(
                token=refresh_request.refresh_token,
                db=db,
                user_agent=user_agent,
                ip_address=client_ip,
            )

            strategy = get_jwt_strategy()
            access_token = await strategy.write_token(user)

            return Token(
                access_token=access_token,
                refresh_token=new_refresh_token,
                token_type="bearer",
            )
        except AuthException:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token",
            )
