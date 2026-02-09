from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.mcps import CreateMcpAction, DeleteMcpAction, UpdateMcpAction
from app.core.deps import (
    get_create_mcp_action,
    get_db,
    get_delete_mcp_action,
    get_update_mcp_action,
)
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas import (
    McpCreateRequest,
    McpDeleteResponse,
    McpResponse,
    McpUpdateRequest,
)
from app.models.types import CustomMcpDict

router = APIRouter()


@router.post("/", response_model=McpResponse, status_code=status.HTTP_201_CREATED)
async def create_mcp(
    request: McpCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    create_mcp_action: CreateMcpAction = Depends(get_create_mcp_action),
) -> CustomMcpDict:
    return await create_mcp_action.execute(current_user.id, request, db)


@router.put("/{mcp_name}", response_model=McpResponse)
async def update_mcp(
    mcp_name: str,
    request: McpUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    update_mcp_action: UpdateMcpAction = Depends(get_update_mcp_action),
) -> CustomMcpDict:
    return await update_mcp_action.execute(current_user.id, mcp_name, request, db)


@router.delete("/{mcp_name}", response_model=McpDeleteResponse)
async def delete_mcp(
    mcp_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    delete_mcp_action: DeleteMcpAction = Depends(get_delete_mcp_action),
) -> McpDeleteResponse:
    return await delete_mcp_action.execute(current_user.id, mcp_name, db)
