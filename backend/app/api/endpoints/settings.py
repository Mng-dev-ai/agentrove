from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_user_service
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.settings import UserSettingsResponse, UserSettingsUpdate
from app.services.exceptions import UserException
from app.services.user import UserService
from app.utils.cache import cache_connection

router = APIRouter()


def _visible_settings(
    user: User, response: UserSettingsResponse
) -> UserSettingsResponse | JSONResponse:
    # Agents only pick personas; the rest holds credentials and user preferences.
    if user.agent_token:
        return JSONResponse(
            response.model_dump(mode="json", include={"personas", "settings_version"})
        )
    return response


@router.get("/", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> UserSettingsResponse | JSONResponse:
    try:
        async with cache_connection() as cache:
            return _visible_settings(
                current_user,
                await user_service.get_user_settings_response(
                    current_user.id, cache=cache
                ),
            )
    except UserException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


# A write its client abandoned may still be applied later: expected_version
# rejects it only if another write landed first, and unversioned writes still race.
@router.patch("/", response_model=UserSettingsResponse)
async def update_user_settings(
    settings_update: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> UserSettingsResponse | JSONResponse:
    update_data = settings_update.model_dump(exclude_unset=True)
    expected_version = update_data.pop("expected_version", None)
    if current_user.agent_token and update_data.keys() - {"personas"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent tokens can only change personas",
        )
    try:
        applied = await user_service.update_user_settings(
            user_id=current_user.id,
            settings_update=update_data,
            db=db,
            expected_version=expected_version,
        )
    except UserException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    async with cache_connection() as cache:
        await user_service.invalidate_settings_cache(cache, current_user.id)
        if not applied:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Settings changed since they were read",
            )
        return _visible_settings(
            current_user,
            await user_service.get_user_settings_response(
                current_user.id, db=db, cache=cache
            ),
        )
