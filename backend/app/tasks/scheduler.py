import asyncio
from typing import Any

from app.actions.scheduler.run_scheduled_task import RunScheduledTaskAction
from app.core.celery import celery_app
from app.services.scheduler import SchedulerService


@celery_app.task(name="check_scheduled_tasks")
def check_scheduled_tasks() -> dict[str, Any]:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        scheduler = SchedulerService()
        return loop.run_until_complete(
            scheduler.check_due_tasks(execute_task_trigger=execute_scheduled_task.delay)
        )
    finally:
        loop.close()


@celery_app.task(bind=True, name="execute_scheduled_task")
def execute_scheduled_task(
    self: Any, task_id: str, execution_id: str
) -> dict[str, Any]:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        action = RunScheduledTaskAction()
        return loop.run_until_complete(
            action.execute(task=self, task_id=task_id, execution_id=execution_id)
        )
    finally:
        loop.close()
