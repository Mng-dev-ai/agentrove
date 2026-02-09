from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import User
from app.models.schemas.integrations import OAuthUrlResponse
from app.services import gmail_oauth
from app.services.exceptions import UserException
from app.services.user import UserService


class GetOAuthUrlAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(self, current_user: User, db: AsyncSession) -> OAuthUrlResponse:
        try:
            user_settings = await self._user_service.get_user_settings(
                current_user.id, db=db
            )
        except UserException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc

        if not user_settings.gmail_oauth_client:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OAuth client not configured. Upload gcp-oauth.keys.json first.",
            )

        client_id, _ = gmail_oauth.extract_client_credentials(
            user_settings.gmail_oauth_client
        )
        state = gmail_oauth.create_oauth_state(current_user.id)
        url = gmail_oauth.build_authorization_url(client_id, state)

        return OAuthUrlResponse(url=url)
