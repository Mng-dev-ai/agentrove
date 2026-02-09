from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.scheduler.create_scheduled_task import CreateScheduledTaskAction
from app.actions.scheduler.delete_scheduled_task import DeleteScheduledTaskAction
from app.actions.scheduler.get_scheduled_task import GetScheduledTaskAction
from app.actions.scheduler.get_scheduled_tasks import GetScheduledTasksAction
from app.actions.scheduler.get_task_execution_history import (
    GetTaskExecutionHistoryAction,
)
from app.actions.scheduler.toggle_scheduled_task import ToggleScheduledTaskAction
from app.actions.scheduler.update_scheduled_task import UpdateScheduledTaskAction
from app.core.deps import (
    get_create_scheduled_task_action,
    get_delete_scheduled_task_action,
    get_scheduled_task_action,
    get_scheduled_tasks_action,
    get_task_execution_history_action,
    get_toggle_scheduled_task_action,
    get_update_scheduled_task_action,
)
from app.core.security import get_current_user, get_db
from app.models.db_models import ScheduledTask, User
from app.models.schemas import (
    PaginatedTaskExecutions,
    PaginationParams,
    ScheduledTaskBase,
    ScheduledTaskResponse,
    ScheduledTaskUpdate,
    TaskToggleResponse,
)
from app.services.exceptions import SchedulerException

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post(
    "/tasks", response_model=ScheduledTaskResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit("10/minute")
async def create_scheduled_task(
    request: Request,
    task_data: ScheduledTaskBase,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    create_scheduled_task_action: CreateScheduledTaskAction = Depends(
        get_create_scheduled_task_action
    ),
) -> ScheduledTask:
    try:
        return await create_scheduled_task_action.execute(task_data, current_user, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/tasks", response_model=list[ScheduledTaskResponse])
async def get_scheduled_tasks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    get_scheduled_tasks_action: GetScheduledTasksAction = Depends(
        get_scheduled_tasks_action
    ),
) -> list[ScheduledTask]:
    return await get_scheduled_tasks_action.execute(current_user, db)


@router.get("/tasks/{task_id}", response_model=ScheduledTaskResponse)
async def get_scheduled_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    get_scheduled_task_action: GetScheduledTaskAction = Depends(
        get_scheduled_task_action
    ),
) -> ScheduledTask:
    try:
        return await get_scheduled_task_action.execute(task_id, current_user, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.put("/tasks/{task_id}", response_model=ScheduledTaskResponse)
@limiter.limit("20/minute")
async def update_scheduled_task(
    request: Request,
    task_id: UUID,
    task_update: ScheduledTaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    update_scheduled_task_action: UpdateScheduledTaskAction = Depends(
        get_update_scheduled_task_action
    ),
) -> ScheduledTask:
    try:
        return await update_scheduled_task_action.execute(
            task_id,
            task_update,
            current_user,
            db,
        )
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scheduled_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    delete_scheduled_task_action: DeleteScheduledTaskAction = Depends(
        get_delete_scheduled_task_action
    ),
) -> None:
    try:
        await delete_scheduled_task_action.execute(task_id, current_user, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post("/tasks/{task_id}/toggle", response_model=TaskToggleResponse)
@limiter.limit("30/minute")
async def toggle_scheduled_task(
    request: Request,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    toggle_scheduled_task_action: ToggleScheduledTaskAction = Depends(
        get_toggle_scheduled_task_action
    ),
) -> TaskToggleResponse:
    try:
        return await toggle_scheduled_task_action.execute(task_id, current_user, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/tasks/{task_id}/history", response_model=PaginatedTaskExecutions)
async def get_task_execution_history(
    task_id: UUID,
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    get_task_execution_history_action: GetTaskExecutionHistoryAction = Depends(
        get_task_execution_history_action
    ),
) -> PaginatedTaskExecutions:
    try:
        return await get_task_execution_history_action.execute(
            task_id,
            pagination,
            current_user,
            db,
        )
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
