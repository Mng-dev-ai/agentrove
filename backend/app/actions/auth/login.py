from fastapi import HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import verify_password
from app.core.user_manager import UserDatabase, get_jwt_strategy
from app.models.schemas import Token
from app.services.refresh_token import RefreshTokenService

settings = get_settings()


class LoginAction:
    def __init__(self, refresh_token_service: RefreshTokenService) -> None:
        self._refresh_token_service = refresh_token_service

    async def execute(
        self,
        request: Request,
        form_data: OAuth2PasswordRequestForm,
        user_db: UserDatabase,
        db: AsyncSession,
    ) -> Token:
        user = await user_db.get_by_email(form_data.username)

        if not user or not verify_password(form_data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid email or password",
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account is inactive",
            )

        if settings.REQUIRE_EMAIL_VERIFICATION and not user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please verify your email before logging in",
            )

        strategy = get_jwt_strategy()
        access_token = await strategy.write_token(user)

        user_agent = request.headers.get("user-agent")
        client_ip = request.client.host if request.client else None
        refresh_token = await self._refresh_token_service.create_refresh_token(
            user_id=user.id,
            db=db,
            user_agent=user_agent,
            ip_address=client_ip,
        )

        return Token(
            access_token=access_token, refresh_token=refresh_token, token_type="bearer"
        )
