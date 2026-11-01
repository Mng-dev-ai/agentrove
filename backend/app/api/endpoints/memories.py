from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import get_memory_service
from app.core.security import get_current_user
from app.models.db_models.memory import Memory
from app.models.db_models.user import User
from app.models.schemas.memory import Memory as MemorySchema
from app.models.schemas.memory import MemoryCreate, MemoryUpdate
from app.services.exceptions import ServiceException
from app.services.memory import MemoryService

router = APIRouter()


@router.get("", response_model=list[MemorySchema])
async def list_memories(
    workspace_id: UUID | None = Query(None),
    query: str | None = Query(None, max_length=500),
    current_user: User = Depends(get_current_user),
    memory_service: MemoryService = Depends(get_memory_service),
) -> list[Memory]:
    return await memory_service.list_memories(current_user, workspace_id, query)


@router.post("", response_model=MemorySchema, status_code=status.HTTP_201_CREATED)
async def create_memory(
    data: MemoryCreate,
    current_user: User = Depends(get_current_user),
    memory_service: MemoryService = Depends(get_memory_service),
) -> Memory:
    try:
        return await memory_service.create_memory(current_user, data)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e


@router.patch("/{memory_id}", response_model=MemorySchema)
async def update_memory(
    memory_id: UUID,
    data: MemoryUpdate,
    current_user: User = Depends(get_current_user),
    memory_service: MemoryService = Depends(get_memory_service),
) -> Memory:
    try:
        return await memory_service.update_memory(memory_id, current_user, data)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: UUID,
    current_user: User = Depends(get_current_user),
    memory_service: MemoryService = Depends(get_memory_service),
) -> None:
    try:
        await memory_service.delete_memory(memory_id, current_user)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
