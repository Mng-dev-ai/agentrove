from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import User
from app.models.schemas import TaskToggleResponse
from app.services.exceptions import SchedulerException
from app.services.scheduler import SchedulerService

from app.actions.scheduler.error_mapping import scheduler_exception_status


class ToggleScheduledTaskAction:
    def __init__(self, scheduler_service: SchedulerService) -> None:
        self._scheduler_service = scheduler_service

    async def execute(
        self,
        task_id: UUID,
        current_user: User,
        db: AsyncSession,
    ) -> TaskToggleResponse:
        try:
            return await self._scheduler_service.toggle_task(task_id, current_user.id, db)
        except SchedulerException as exc:
            raise SchedulerException(
                str(exc),
                error_code=exc.error_code,
                details=exc.details,
                status_code=scheduler_exception_status(exc, default=400),
            ) from exc
