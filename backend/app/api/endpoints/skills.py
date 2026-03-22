import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from app.api.endpoints._shared import (
    prune_installed_component,
    raise_bad_request_from_service,
    validate_name_or_400,
)
from app.core.deps import get_skill_service, get_user_service
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.db_models.enums import DeleteResponseStatus
from app.models.db_models.user import User
from app.models.schemas.skills import (
    SkillDeleteResponse,
    SkillFilesResponse,
    SkillResponse,
    SkillUpdateRequest,
)
from app.models.types import CustomSkillDict
from app.services.exceptions import SkillException
from app.services.skill import SkillService
from app.services.user import UserService
from app.utils.cache import cache_connection

router = APIRouter()


@router.post(
    "/upload", response_model=SkillResponse, status_code=status.HTTP_201_CREATED
)
async def upload_skill(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    skill_service: SkillService = Depends(get_skill_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomSkillDict:
    try:
        skill_data = await skill_service.upload(file)
    except SkillException as e:
        logger.warning("skill upload rejected: %s (file=%s)", e, file.filename)
        raise_bad_request_from_service(e)

    async with cache_connection() as cache:
        await user_service.invalidate_settings_cache(cache, current_user.id)

    return skill_data


@router.delete("/{skill_name}", response_model=SkillDeleteResponse)
async def delete_skill(
    skill_name: str,
    current_user: User = Depends(get_current_user),
    skill_service: SkillService = Depends(get_skill_service),
    user_service: UserService = Depends(get_user_service),
    db: AsyncSession = Depends(get_db),
) -> SkillDeleteResponse:
    validate_name_or_400(skill_service.validate_exact_sanitized_name, skill_name)

    if not skill_service.resource_exists(skill_name):
        return SkillDeleteResponse(status=DeleteResponseStatus.NOT_FOUND.value)

    await skill_service.delete(skill_name)

    await prune_installed_component(
        user_service=user_service,
        user_id=current_user.id,
        db=db,
        component_id=f"skill:{skill_name}",
    )

    return SkillDeleteResponse(status=DeleteResponseStatus.DELETED.value)


@router.get("/{skill_name}/files", response_model=SkillFilesResponse)
async def get_skill_files(
    skill_name: str,
    current_user: User = Depends(get_current_user),
    skill_service: SkillService = Depends(get_skill_service),
) -> SkillFilesResponse:
    validate_name_or_400(skill_service.validate_exact_sanitized_name, skill_name)

    try:
        files = skill_service.get_files(skill_name)
    except SkillException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e

    return SkillFilesResponse(name=skill_name, files=files)


@router.put("/{skill_name}", response_model=SkillResponse)
async def update_skill(
    skill_name: str,
    request: SkillUpdateRequest,
    current_user: User = Depends(get_current_user),
    skill_service: SkillService = Depends(get_skill_service),
    user_service: UserService = Depends(get_user_service),
) -> CustomSkillDict:
    validate_name_or_400(skill_service.validate_exact_sanitized_name, skill_name)

    if not skill_service.resource_exists(skill_name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{skill_name}' not found",
        )

    try:
        files_data: list[dict[str, str | bool]] = [
            {"path": f.path, "content": f.content, "is_binary": f.is_binary}
            for f in request.files
        ]
        updated_skill = skill_service.update(skill_name, files_data)
    except SkillException as e:
        raise_bad_request_from_service(e)

    async with cache_connection() as cache:
        await user_service.invalidate_settings_cache(cache, current_user.id)

    return updated_skill
