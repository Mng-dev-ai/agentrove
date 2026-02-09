from fastapi import APIRouter, Depends, Header

from app.actions.permissions import CreatePermissionRequestAction, GetPermissionResponseAction
from app.core.deps import get_create_permission_request_action, get_get_permission_response_action
from app.models.schemas import (
    PermissionRequest,
    PermissionRequestResponse,
    PermissionResult,
)

router = APIRouter()


@router.post(
    "/chats/{chat_id}/permissions/request",
    response_model=PermissionRequestResponse,
)
async def create_permission_request(
    chat_id: str,
    request: PermissionRequest,
    authorization: str = Header(...),
    create_permission_request_action: CreatePermissionRequestAction = Depends(
        get_create_permission_request_action
    ),
) -> PermissionRequestResponse:
    return await create_permission_request_action.execute(chat_id, request, authorization)


@router.get(
    "/chats/{chat_id}/permissions/response/{request_id}",
    response_model=PermissionResult,
)
async def get_permission_response(
    chat_id: str,
    request_id: str,
    authorization: str = Header(...),
    timeout: int = 300,
    get_permission_response_action: GetPermissionResponseAction = Depends(
        get_get_permission_response_action
    ),
) -> PermissionResult:
    return await get_permission_response_action.execute(
        chat_id=chat_id,
        request_id=request_id,
        authorization=authorization,
        timeout=timeout,
    )
