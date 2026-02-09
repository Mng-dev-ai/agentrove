from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.agents import DeleteAgentAction, UpdateAgentAction, UploadAgentAction
from app.core.deps import (
    get_db,
    get_delete_agent_action,
    get_update_agent_action,
    get_upload_agent_action,
)
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas import AgentDeleteResponse, AgentResponse, AgentUpdateRequest
from app.models.types import CustomAgentDict

router = APIRouter()


@router.post(
    "/upload", response_model=AgentResponse, status_code=status.HTTP_201_CREATED
)
async def upload_agent(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    upload_agent_action: UploadAgentAction = Depends(get_upload_agent_action),
) -> CustomAgentDict:
    return await upload_agent_action.execute(current_user.id, file, db)


@router.put("/{agent_name}", response_model=AgentResponse)
async def update_agent(
    agent_name: str,
    request: AgentUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    update_agent_action: UpdateAgentAction = Depends(get_update_agent_action),
) -> CustomAgentDict:
    return await update_agent_action.execute(
        current_user.id, agent_name, request.content, db
    )


@router.delete("/{agent_name}", response_model=AgentDeleteResponse)
async def delete_agent(
    agent_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    delete_agent_action: DeleteAgentAction = Depends(get_delete_agent_action),
) -> AgentDeleteResponse:
    return await delete_agent_action.execute(current_user.id, agent_name, db)
