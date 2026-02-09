from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.skills import DeleteSkillAction, UploadSkillAction
from app.core.deps import get_db, get_delete_skill_action, get_upload_skill_action
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas import SkillDeleteResponse, SkillResponse
from app.models.types import CustomSkillDict

router = APIRouter()


@router.post(
    "/upload", response_model=SkillResponse, status_code=status.HTTP_201_CREATED
)
async def upload_skill(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    upload_skill_action: UploadSkillAction = Depends(get_upload_skill_action),
) -> CustomSkillDict:
    return await upload_skill_action.execute(current_user.id, file, db)


@router.delete("/{skill_name}", response_model=SkillDeleteResponse)
async def delete_skill(
    skill_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    delete_skill_action: DeleteSkillAction = Depends(get_delete_skill_action),
) -> SkillDeleteResponse:
    return await delete_skill_action.execute(current_user.id, skill_name, db)
