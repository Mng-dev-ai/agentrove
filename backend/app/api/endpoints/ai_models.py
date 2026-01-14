from collections.abc import Sequence

from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_ai_model_service
from app.core.security import get_current_user
from app.models.db_models import AIModel, User
from app.models.schemas import AIModelResponse
from app.services.ai_model import AIModelService
from app.services.model_sync_service import ModelSyncService
from app.utils.redis import redis_connection

router = APIRouter()


@router.get("/", response_model=list[AIModelResponse])
async def list_models(
    active_only: bool = True,
    current_user: User = Depends(get_current_user),
    service: AIModelService = Depends(get_ai_model_service),
) -> Sequence[AIModel] | list[AIModelResponse]:
    async with redis_connection() as redis:
        return await service.get_models(active_only=active_only, redis=redis)


@router.post("/sync")
async def sync_models(
    current_user: User = Depends(get_current_user),
) -> dict[str, int | str | list[str]]:
    """
    Sync available models from provider APIs to the database.

    This endpoint fetches the current list of models from provider APIs
    and updates the database. New models are added, existing models are updated.

    Only admin users can sync models.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Only admins can sync models")

    async with ModelSyncService() as sync_service:
        result = await sync_service.sync_all()

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return {
        "added": len(result.get("added", [])),
        "updated": len(result.get("updated", [])),
        "unchanged": len(result.get("unchanged", [])),
        "added_models": result.get("added", []),
        "updated_models": result.get("updated", []),
    }
