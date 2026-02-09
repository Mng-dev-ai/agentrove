from fastapi import APIRouter, Depends

from app.actions.ai_model import ListModelsAction
from app.core.deps import get_list_models_action
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas import AIModelResponse

router = APIRouter()


@router.get("/", response_model=list[AIModelResponse])
async def list_models(
    current_user: User = Depends(get_current_user),
    list_models_action: ListModelsAction = Depends(get_list_models_action),
) -> list[AIModelResponse]:
    return await list_models_action.execute(current_user.id)
