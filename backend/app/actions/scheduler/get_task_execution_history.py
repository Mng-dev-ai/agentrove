from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import User
from app.models.schemas import PaginatedTaskExecutions, PaginationParams
from app.services.exceptions import SchedulerException
from app.services.scheduler import SchedulerService

from app.actions.scheduler.error_mapping import scheduler_exception_status


class GetTaskExecutionHistoryAction:
    def __init__(self, scheduler_service: SchedulerService) -> None:
        self._scheduler_service = scheduler_service

    async def execute(
        self,
        task_id: UUID,
        pagination: PaginationParams,
        current_user: User,
        db: AsyncSession,
    ) -> PaginatedTaskExecutions:
        try:
            return await self._scheduler_service.get_execution_history(
                task_id,
                current_user.id,
                pagination,
                db,
            )
        except SchedulerException as exc:
            raise SchedulerException(
                str(exc),
                error_code=exc.error_code,
                details=exc.details,
                status_code=scheduler_exception_status(exc, default=404),
            ) from exc
