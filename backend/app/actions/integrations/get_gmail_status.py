from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import User
from app.models.schemas.integrations import GmailStatusResponse
from app.services.exceptions import UserException
from app.services.user import UserService


class GetGmailStatusAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(
        self, current_user: User, db: AsyncSession
    ) -> GmailStatusResponse:
        try:
            user_settings = await self._user_service.get_user_settings(
                current_user.id, db=db
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        return GmailStatusResponse(
            connected=user_settings.gmail_oauth_tokens is not None,
            email=user_settings.gmail_email,
            connected_at=user_settings.gmail_connected_at,
            has_oauth_client=user_settings.gmail_oauth_client is not None,
        )
