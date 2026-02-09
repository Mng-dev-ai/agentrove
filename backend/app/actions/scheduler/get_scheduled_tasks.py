from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import ScheduledTask, User
from app.services.scheduler import SchedulerService


class GetScheduledTasksAction:
    def __init__(self, scheduler_service: SchedulerService) -> None:
        self._scheduler_service = scheduler_service

    async def execute(
        self,
        current_user: User,
        db: AsyncSession,
    ) -> list[ScheduledTask]:
        return await self._scheduler_service.get_tasks(current_user.id, db)
