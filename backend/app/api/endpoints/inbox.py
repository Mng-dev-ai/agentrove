from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_inbox_service
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.inbox import InboxItem, InboxList, InboxMessageCreate
from app.models.schemas.pagination import CursorPaginationParams
from app.services.exceptions import ServiceException
from app.services.inbox import InboxService

router = APIRouter()


@router.get("", response_model=InboxList)
async def list_inbox(
    pagination: CursorPaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    inbox_service: InboxService = Depends(get_inbox_service),
) -> InboxList:
    try:
        return await inbox_service.list_items(
            current_user, pagination.cursor, pagination.limit
        )
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e


@router.post("/messages", response_model=InboxItem, status_code=status.HTTP_201_CREATED)
async def create_inbox_message(
    data: InboxMessageCreate,
    current_user: User = Depends(get_current_user),
    inbox_service: InboxService = Depends(get_inbox_service),
) -> InboxItem:
    try:
        return await inbox_service.create_message(current_user, data)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    inbox_service: InboxService = Depends(get_inbox_service),
) -> None:
    await inbox_service.mark_all_read(current_user)


@router.delete("/read", status_code=status.HTTP_204_NO_CONTENT)
async def clear_read(
    current_user: User = Depends(get_current_user),
    inbox_service: InboxService = Depends(get_inbox_service),
) -> None:
    await inbox_service.clear_read(current_user)


@router.post("/{item_id}/read", response_model=InboxItem)
async def mark_read(
    item_id: UUID,
    current_user: User = Depends(get_current_user),
    inbox_service: InboxService = Depends(get_inbox_service),
) -> InboxItem:
    try:
        return await inbox_service.mark_read(item_id, current_user)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
