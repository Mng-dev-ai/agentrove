from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import User
from app.models.schemas.integrations import OAuthClientResponse
from app.services.exceptions import UserException
from app.services.user import UserService


class DeleteOAuthClientAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(
        self, current_user: User, db: AsyncSession
    ) -> OAuthClientResponse:
        try:
            user_settings = await self._user_service.get_user_settings(
                current_user.id, db=db, for_update=True
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        user_settings.gmail_oauth_client = None
        user_settings.gmail_oauth_tokens = None
        user_settings.gmail_connected_at = None
        user_settings.gmail_email = None
        flag_modified(user_settings, "gmail_oauth_client")
        flag_modified(user_settings, "gmail_oauth_tokens")

        await self._user_service.commit_settings_and_invalidate_cache(
            user_settings, db, current_user.id
        )

        return OAuthClientResponse(
            success=True, message="OAuth client configuration removed"
        )
