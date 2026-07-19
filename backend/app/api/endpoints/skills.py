import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_skill_service
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.skills import SkillFilesResponse, SkillUpdateRequest
from app.models.types import CustomSkillDict
from app.services.skill import SkillService

router = APIRouter()


@router.get("", response_model=list[CustomSkillDict])
async def list_skills(
    current_user: User = Depends(get_current_user),
    skill_service: SkillService = Depends(get_skill_service),
) -> list[CustomSkillDict]:
    # Blocking FS walks — offload so streams on the event loop aren't stalled.
    return await asyncio.to_thread(skill_service.list_all)


@router.get("/{source}/{skill_name}/files", response_model=SkillFilesResponse)
async def get_skill_files(
    source: str,
    skill_name: str,
    current_user: User = Depends(get_current_user),
    skill_service: SkillService = Depends(get_skill_service),
) -> SkillFilesResponse:
    try:
        files = await asyncio.to_thread(skill_service.get_files, source, skill_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return SkillFilesResponse(name=skill_name, files=files)


@router.put("/{source}/{skill_name}", response_model=CustomSkillDict)
async def update_skill(
    source: str,
    skill_name: str,
    request: SkillUpdateRequest,
    current_user: User = Depends(get_current_user),
    skill_service: SkillService = Depends(get_skill_service),
) -> CustomSkillDict:
    try:
        return await asyncio.to_thread(
            skill_service.update, source, skill_name, request.files
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
