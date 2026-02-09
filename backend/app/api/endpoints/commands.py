from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.commands import (
    DeleteCommandAction,
    UpdateCommandAction,
    UploadCommandAction,
)
from app.core.deps import (
    get_db,
    get_delete_command_action,
    get_update_command_action,
    get_upload_command_action,
)
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas import (
    CommandDeleteResponse,
    CommandResponse,
    CommandUpdateRequest,
)
from app.models.types import CustomSlashCommandDict

router = APIRouter()


@router.post(
    "/upload", response_model=CommandResponse, status_code=status.HTTP_201_CREATED
)
async def upload_command(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    upload_command_action: UploadCommandAction = Depends(get_upload_command_action),
) -> CustomSlashCommandDict:
    return await upload_command_action.execute(current_user.id, file, db)


@router.put("/{command_name}", response_model=CommandResponse)
async def update_command(
    command_name: str,
    request: CommandUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    update_command_action: UpdateCommandAction = Depends(get_update_command_action),
) -> CustomSlashCommandDict:
    return await update_command_action.execute(
        current_user.id, command_name, request.content, db
    )


@router.delete("/{command_name}", response_model=CommandDeleteResponse)
async def delete_command(
    command_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    delete_command_action: DeleteCommandAction = Depends(get_delete_command_action),
) -> CommandDeleteResponse:
    return await delete_command_action.execute(current_user.id, command_name, db)
