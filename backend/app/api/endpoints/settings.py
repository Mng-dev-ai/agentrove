import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.settings import (
    DuplicateProviderNameError,
    GetUserSettingsAction,
    UpdateUserSettingsAction,
    UserException,
)
from app.core.deps import (
    get_db,
    get_get_user_settings_action,
    get_update_user_settings_action,
)
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas import UserSettingsBase, UserSettingsResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: User = Depends(get_current_user),
    get_user_settings_action: GetUserSettingsAction = Depends(get_get_user_settings_action),
) -> UserSettingsResponse:
    logger.info(f"[GET_SETTINGS] Fetching settings for user {current_user.id}")
    try:
        return await get_user_settings_action.execute(current_user.id)
    except UserException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.patch("/", response_model=UserSettingsResponse)
async def update_user_settings(
    settings_update: UserSettingsBase,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    update_user_settings_action: UpdateUserSettingsAction = Depends(
        get_update_user_settings_action
    ),
) -> UserSettingsResponse:
    try:
        return await update_user_settings_action.execute(current_user.id, settings_update, db)
    except DuplicateProviderNameError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except UserException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
