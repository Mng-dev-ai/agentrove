from __future__ import annotations

import logging
import math
from calendar import monthrange
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_celery_session
from app.models.db_models import (
    RecurrenceType,
    ScheduledTask,
    TaskExecution,
    TaskExecutionStatus,
    TaskStatus,
    UserSettings,
)
from app.models.schemas import (
    PaginatedTaskExecutions,
    PaginationParams,
    ScheduledTaskBase,
    ScheduledTaskUpdate,
    TaskExecutionResponse,
    TaskToggleResponse,
)
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import SchedulerException
from app.services.user import UserService

logger = logging.getLogger(__name__)


class SchedulerService(BaseDbService[ScheduledTask]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)

    def _tz(self, name: str | None) -> ZoneInfo:
        if not name:
            return ZoneInfo("UTC")
        try:
            return ZoneInfo(name)
        except ZoneInfoNotFoundError:
            return ZoneInfo("UTC")

    def _parse_time(self, value: str) -> tuple[int, int, int]:
        parts = value.split(":")
        if len(parts) < 2:
            raise SchedulerException("Invalid scheduled_time format")
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2]) if len(parts) == 3 else 0
        if not 0 <= hour <= 23 or not 0 <= minute <= 59 or not 0 <= second <= 59:
            raise SchedulerException("Invalid scheduled_time value")
        return hour, minute, second

    def _next_run_utc(
        self,
        recurrence_type: RecurrenceType,
        scheduled_time: str,
        scheduled_day: int | None,
        from_time_utc: datetime,
        timezone_name: str | None,
        allow_once: bool,
    ) -> datetime | None:
        local_now = from_time_utc.astimezone(self._tz(timezone_name))
        hour, minute, second = self._parse_time(scheduled_time)

        if recurrence_type == RecurrenceType.ONCE:
            if not allow_once:
                return None
            target = local_now.replace(
                hour=hour, minute=minute, second=second, microsecond=0
            )
            next_local = target if target > local_now else target + timedelta(days=1)
            return next_local.astimezone(timezone.utc)

        if recurrence_type == RecurrenceType.DAILY:
            target = local_now.replace(
                hour=hour, minute=minute, second=second, microsecond=0
            )
            next_local = target if target > local_now else target + timedelta(days=1)
            return next_local.astimezone(timezone.utc)

        if recurrence_type == RecurrenceType.WEEKLY:
            if scheduled_day is None or scheduled_day < 0 or scheduled_day > 6:
                raise SchedulerException("Weekly tasks require scheduled_day (0-6)")
            days_ahead = (scheduled_day - local_now.weekday()) % 7
            target_date = local_now.date() + timedelta(days=days_ahead)
            target = datetime(
                target_date.year,
                target_date.month,
                target_date.day,
                hour,
                minute,
                second,
                tzinfo=local_now.tzinfo,
            )
            next_local = target if target > local_now else target + timedelta(days=7)
            return next_local.astimezone(timezone.utc)

        if recurrence_type == RecurrenceType.MONTHLY:
            if scheduled_day is None or scheduled_day < 1 or scheduled_day > 31:
                raise SchedulerException("Monthly tasks require scheduled_day (1-31)")
            year = local_now.year
            month = local_now.month
            max_day = monthrange(year, month)[1]
            day = min(scheduled_day, max_day)
            target = datetime(
                year, month, day, hour, minute, second, tzinfo=local_now.tzinfo
            )
            if target <= local_now:
                if month == 12:
                    year += 1
                    month = 1
                else:
                    month += 1
                max_day = monthrange(year, month)[1]
                day = min(scheduled_day, max_day)
                target = datetime(
                    year, month, day, hour, minute, second, tzinfo=local_now.tzinfo
                )
            return target.astimezone(timezone.utc)

        raise SchedulerException(f"Unexpected recurrence type: {recurrence_type}")

    def validate_recurrence_constraints(
        self, recurrence_type: RecurrenceType, scheduled_day: int | None
    ) -> None:
        if recurrence_type == RecurrenceType.WEEKLY:
            if scheduled_day is None or not 0 <= scheduled_day <= 6:
                raise SchedulerException(
                    "Weekly tasks require scheduled_day between 0 (Monday) and 6 (Sunday)"
                )
        elif recurrence_type == RecurrenceType.MONTHLY:
            if scheduled_day is None or not 1 <= scheduled_day <= 31:
                raise SchedulerException(
                    "Monthly tasks require scheduled_day between 1 and 31"
                )

    async def _user_tz(self, user_id: UUID, db: AsyncSession) -> str:
        user_settings = await UserService().get_user_settings(user_id, db=db)
        return user_settings.timezone

    async def _get_user_task(
        self, task_id: UUID, user_id: UUID, db: AsyncSession
    ) -> ScheduledTask | None:
        result = await db.execute(
            select(ScheduledTask).where(
                ScheduledTask.id == task_id,
                ScheduledTask.user_id == user_id,
            )
        )
        return cast(ScheduledTask | None, result.scalar_one_or_none())

    async def _activate_task(
        self,
        task: ScheduledTask,
        user_id: UUID,
        db: AsyncSession,
        timezone_name: str,
        recalc_next: bool,
        skip_validation: bool = False,
    ) -> None:
        if not skip_validation:
            self.validate_recurrence_constraints(
                task.recurrence_type, task.scheduled_day
            )
        task.status = TaskStatus.ACTIVE

        if recalc_next or task.next_execution is None:
            task.next_execution = self._next_run_utc(
                task.recurrence_type,
                task.scheduled_time,
                task.scheduled_day,
                datetime.now(timezone.utc),
                timezone_name,
                allow_once=True,
            )

    async def create_task(
        self, user_id: UUID, task_data: ScheduledTaskBase, db: AsyncSession
    ) -> ScheduledTask:
        self.validate_recurrence_constraints(
            task_data.recurrence_type, task_data.scheduled_day
        )

        timezone_name = await self._user_tz(user_id, db)
        next_execution = self._next_run_utc(
            task_data.recurrence_type,
            task_data.scheduled_time,
            task_data.scheduled_day,
            datetime.now(timezone.utc),
            timezone_name,
            allow_once=True,
        )
        if next_execution is None:
            raise SchedulerException("Could not calculate next execution")

        task = ScheduledTask(
            user_id=user_id,
            task_name=task_data.task_name,
            prompt_message=task_data.prompt_message,
            recurrence_type=task_data.recurrence_type,
            scheduled_time=task_data.scheduled_time,
            scheduled_day=task_data.scheduled_day,
            next_execution=next_execution,
            model_id=task_data.model_id,
            status=TaskStatus.ACTIVE,
        )

        db.add(task)
        await db.commit()
        await db.refresh(task)
        return task

    async def get_tasks(self, user_id: UUID, db: AsyncSession) -> list[ScheduledTask]:
        result = await db.execute(
            select(ScheduledTask)
            .where(ScheduledTask.user_id == user_id)
            .order_by(ScheduledTask.next_execution.asc().nulls_last())
        )
        return list(result.scalars().all())

    async def get_task(
        self, task_id: UUID, user_id: UUID, db: AsyncSession
    ) -> ScheduledTask:
        task = await self._get_user_task(task_id, user_id, db)
        if not task:
            raise SchedulerException("Scheduled task not found")
        return task

    async def update_task(
        self,
        task_id: UUID,
        user_id: UUID,
        task_update: ScheduledTaskUpdate,
        db: AsyncSession,
    ) -> ScheduledTask:
        task = await self._get_user_task(task_id, user_id, db)
        if not task:
            raise SchedulerException("Scheduled task not found")

        update_data = task_update.model_dump(exclude_unset=True)
        old_status = task.status

        recalc_next = False
        for field, value in update_data.items():
            if field in {"recurrence_type", "scheduled_time", "scheduled_day"}:
                recalc_next = True
            setattr(task, field, value)

        if recalc_next:
            self.validate_recurrence_constraints(
                task.recurrence_type, task.scheduled_day
            )
            timezone_name = await self._user_tz(user_id, db)
            task.next_execution = self._next_run_utc(
                task.recurrence_type,
                task.scheduled_time,
                task.scheduled_day,
                datetime.now(timezone.utc),
                timezone_name,
                allow_once=True,
            )

        # If status changed to ACTIVE, recalculate next execution
        if task.status == TaskStatus.ACTIVE and old_status != TaskStatus.ACTIVE:
            timezone_name = await self._user_tz(user_id, db)
            await self._activate_task(
                task,
                user_id,
                db,
                timezone_name=timezone_name,
                recalc_next=recalc_next,
                skip_validation=old_status == TaskStatus.ACTIVE,
            )

        db.add(task)
        await db.commit()
        await db.refresh(task)
        return task

    async def delete_task(self, task_id: UUID, user_id: UUID, db: AsyncSession) -> None:
        task = await self._get_user_task(task_id, user_id, db)
        if not task:
            raise SchedulerException("Scheduled task not found")
        await db.delete(task)
        await db.commit()

    async def toggle_task(
        self, task_id: UUID, user_id: UUID, db: AsyncSession
    ) -> TaskToggleResponse:
        task = await self._get_user_task(task_id, user_id, db)
        if not task:
            raise SchedulerException("Scheduled task not found")

        is_active = task.status == TaskStatus.ACTIVE
        if not is_active:
            timezone_name = await self._user_tz(user_id, db)
            await self._activate_task(
                task,
                user_id,
                db,
                timezone_name=timezone_name,
                recalc_next=True,
            )
        else:
            task.status = TaskStatus.PAUSED

        db.add(task)
        await db.commit()
        await db.refresh(task)

        is_now_active = task.status == TaskStatus.ACTIVE
        return TaskToggleResponse(
            id=task.id,
            enabled=is_now_active,
            message=f"Task {'enabled' if is_now_active else 'disabled'} successfully",
        )

    async def get_execution_history(
        self,
        task_id: UUID,
        user_id: UUID,
        pagination: PaginationParams,
        db: AsyncSession,
    ) -> PaginatedTaskExecutions:
        task = await self._get_user_task(task_id, user_id, db)
        if not task:
            raise SchedulerException("Scheduled task not found")

        count_result = await db.execute(
            select(func.count(TaskExecution.id)).where(TaskExecution.task_id == task_id)
        )
        total = count_result.scalar() or 0

        offset = (pagination.page - 1) * pagination.per_page
        result = await db.execute(
            select(TaskExecution)
            .where(TaskExecution.task_id == task_id)
            .order_by(TaskExecution.executed_at.desc())
            .offset(offset)
            .limit(pagination.per_page)
        )
        executions = result.scalars().all()

        return PaginatedTaskExecutions(
            items=[TaskExecutionResponse.model_validate(e) for e in executions],
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            pages=math.ceil(total / pagination.per_page) if total > 0 else 0,
        )

    async def _claim_due_tasks(
        self,
        db: AsyncSession,
        now: datetime,
        limit: int,
    ) -> list[tuple[UUID, UUID]]:
        task_result = await db.execute(
            select(ScheduledTask)
            .where(
                ScheduledTask.status == TaskStatus.ACTIVE,
                ScheduledTask.next_execution <= now,
                ScheduledTask.next_execution.isnot(None),
            )
            .order_by(ScheduledTask.next_execution)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        tasks = list(task_result.scalars().all())

        if not tasks:
            return []

        user_ids = [task.user_id for task in tasks]
        tz_result = await db.execute(
            select(UserSettings.user_id, UserSettings.timezone).where(
                UserSettings.user_id.in_(user_ids)
            )
        )
        user_timezones = {row.user_id: row.timezone for row in tz_result.all()}

        claimed: list[tuple[UUID, UUID]] = []
        for task in tasks:
            timezone_name = user_timezones.get(task.user_id)

            if task.recurrence_type == RecurrenceType.ONCE:
                task.next_execution = None
            else:
                task.next_execution = self._next_run_utc(
                    task.recurrence_type,
                    task.scheduled_time,
                    task.scheduled_day,
                    now,
                    timezone_name,
                    allow_once=False,
                )

            task.status = TaskStatus.PENDING

            execution = TaskExecution(
                task_id=task.id,
                executed_at=now,
                status=TaskExecutionStatus.RUNNING,
            )
            db.add(execution)
            db.add(task)
            await db.flush()

            claimed.append((task.id, execution.id))

        return claimed

    async def check_due_tasks(
        self,
        execute_task_trigger: Callable[[str, str], Any],
        limit: int = 100,
    ) -> dict[str, Any]:
        async with get_celery_session() as (session_factory, _):
            try:
                async with session_factory() as db:
                    now = datetime.now(timezone.utc)
                    claimed = await self._claim_due_tasks(db, now=now, limit=limit)
                    await db.commit()

                    for task_id, execution_id in claimed:
                        execute_task_trigger(str(task_id), str(execution_id))

                    return {"tasks_triggered": len(claimed)}

            except Exception as e:
                logger.error("Error checking scheduled tasks: %s", e)
                return {"error": str(e)}
