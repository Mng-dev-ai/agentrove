from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import ScheduledTask, User
from app.models.schemas import ScheduledTaskBase
from app.services.exceptions import SchedulerException
from app.services.scheduler import SchedulerService

from app.actions.scheduler.error_mapping import scheduler_exception_status


class CreateScheduledTaskAction:
    def __init__(self, scheduler_service: SchedulerService) -> None:
        self._scheduler_service = scheduler_service

    async def execute(
        self,
        task_data: ScheduledTaskBase,
        current_user: User,
        db: AsyncSession,
    ) -> ScheduledTask:
        try:
            return await self._scheduler_service.create_task(
                current_user.id, task_data, db
            )
        except SchedulerException as exc:
            raise SchedulerException(
                str(exc),
                error_code=exc.error_code,
                details=exc.details,
                status_code=scheduler_exception_status(exc, default=400),
            ) from exc
