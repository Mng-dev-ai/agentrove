import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError

from app.core.deps import get_automation_service
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.automation import (
    Automation as AutomationSchema,
    AutomationCreate,
    AutomationRunResponse,
    AutomationUpdate,
)
from app.services.automation import AutomationService
from app.services.exceptions import AutomationException, ChatException

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "",
    response_model=AutomationSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_automation(
    data: AutomationCreate,
    current_user: User = Depends(get_current_user),
    automation_service: AutomationService = Depends(get_automation_service),
) -> AutomationSchema:
    try:
        return await automation_service.create_automation(current_user, data)
    except AutomationException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SQLAlchemyError as e:
        logger.error("Database error creating automation: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating automation",
        ) from e


@router.get("", response_model=list[AutomationSchema])
async def list_automations(
    current_user: User = Depends(get_current_user),
    automation_service: AutomationService = Depends(get_automation_service),
) -> list[AutomationSchema]:
    return await automation_service.list_automations(current_user)


@router.patch("/{automation_id}", response_model=AutomationSchema)
async def update_automation(
    automation_id: UUID,
    data: AutomationUpdate,
    current_user: User = Depends(get_current_user),
    automation_service: AutomationService = Depends(get_automation_service),
) -> AutomationSchema:
    try:
        return await automation_service.update_automation(
            automation_id, current_user, data
        )
    except AutomationException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_automation(
    automation_id: UUID,
    current_user: User = Depends(get_current_user),
    automation_service: AutomationService = Depends(get_automation_service),
) -> None:
    try:
        await automation_service.delete_automation(automation_id, current_user)
    except AutomationException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e


@router.post("/{automation_id}/run", response_model=AutomationRunResponse)
async def run_automation(
    automation_id: UUID,
    current_user: User = Depends(get_current_user),
    automation_service: AutomationService = Depends(get_automation_service),
) -> AutomationRunResponse:
    try:
        chat = await automation_service.run_automation(automation_id, current_user)
    except (AutomationException, ChatException) as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    return AutomationRunResponse(chat_id=chat.id)
