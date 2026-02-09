from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.db_models import User
from app.models.schemas.integrations import (
    OAuthClientResponse,
    OAuthClientUploadRequest,
)
from app.services import gmail_oauth
from app.services.exceptions import UserException
from app.services.user import UserService


class UploadOAuthClientAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(
        self,
        request: OAuthClientUploadRequest,
        current_user: User,
        db: AsyncSession,
    ) -> OAuthClientResponse:
        is_valid, error_msg = gmail_oauth.validate_client_config(request.client_config)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg or "Invalid OAuth client configuration",
            )

        try:
            user_settings = await self._user_service.get_user_settings(
                current_user.id, db=db, for_update=True
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        user_settings.gmail_oauth_client = request.client_config
        user_settings.gmail_oauth_tokens = None
        user_settings.gmail_connected_at = None
        user_settings.gmail_email = None
        flag_modified(user_settings, "gmail_oauth_client")
        flag_modified(user_settings, "gmail_oauth_tokens")

        await self._user_service.commit_settings_and_invalidate_cache(
            user_settings, db, current_user.id
        )

        return OAuthClientResponse(
            success=True, message="OAuth client configuration saved"
        )
