from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings
from app.services.automation import AutomationService
from app.services.chat import ChatService
from app.services.session_registry import (
    IDLE_CHECK_INTERVAL_SECONDS,
    session_registry,
)
from app.services.push import SEND_INTERVAL_SECONDS, PushService
from app.services.refresh_token import RefreshTokenService
from app.services.subthread_report import (
    DISPATCH_INTERVAL_SECONDS as SUBTHREAD_REPORT_INTERVAL_SECONDS,
    SubThreadReportService,
)
from app.services.user import UserService

settings = get_settings()

logger = logging.getLogger(__name__)

# Polling resolution for due automations — a fired run lands within a minute of
# its cron slot, which is plenty for hourly/daily schedules.
AUTOMATION_DISPATCH_INTERVAL_SECONDS = 60.0


@dataclass(frozen=True)
class MaintenanceJob:
    name: str
    interval_seconds: float
    run: Callable[[], Awaitable[dict[str, Any]]]
    # Lets producers run the job before its interval elapses; signals coalesce.
    wake: asyncio.Event | None = None


class MaintenanceService:
    def __init__(self) -> None:
        self._stop_event = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []
        chat_service = ChatService(UserService())
        self._automation_service = AutomationService(chat_service)
        self._subthread_report_service = SubThreadReportService(chat_service)

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._run_job_loop(self._refresh_tokens_job())),
            asyncio.create_task(self._run_job_loop(self._idle_session_cleanup_job())),
            asyncio.create_task(self._run_job_loop(self._automation_dispatch_job())),
            asyncio.create_task(self._run_job_loop(self._push_send_job())),
            asyncio.create_task(
                self._run_job_loop(self._subthread_report_dispatch_job())
            ),
        ]

    async def stop(self) -> None:
        self._stop_event.set()
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()

    def _refresh_tokens_job(self) -> MaintenanceJob:
        return MaintenanceJob(
            name="refresh_token_cleanup",
            interval_seconds=86400.0,
            run=RefreshTokenService.cleanup_expired_tokens_job,
        )

    def _automation_dispatch_job(self) -> MaintenanceJob:
        return MaintenanceJob(
            name="automation_dispatch",
            interval_seconds=AUTOMATION_DISPATCH_INTERVAL_SECONDS,
            run=self._automation_service.run_due_automations,
        )

    def _subthread_report_dispatch_job(self) -> MaintenanceJob:
        return MaintenanceJob(
            name="subthread_report_dispatch",
            interval_seconds=SUBTHREAD_REPORT_INTERVAL_SECONDS,
            run=self._subthread_report_service.dispatch_due,
        )

    @staticmethod
    def _push_send_job() -> MaintenanceJob:
        return MaintenanceJob(
            name="push_send",
            interval_seconds=SEND_INTERVAL_SECONDS,
            run=PushService().send_due,
            wake=PushService.wake,
        )

    def _idle_session_cleanup_job(self) -> MaintenanceJob:
        return MaintenanceJob(
            name="idle_session_cleanup",
            interval_seconds=IDLE_CHECK_INTERVAL_SECONDS,
            run=self._reap_idle_sessions,
        )

    @staticmethod
    async def _reap_idle_sessions() -> dict[str, Any]:
        await session_registry.close_idle_sessions(
            settings.CHAT_PROCESS_IDLE_TTL_SECONDS
        )
        return {}

    async def _run_job_loop(self, job: MaintenanceJob) -> None:
        while not self._stop_event.is_set():
            # Cleared before running so a signal raised during the run isn't lost.
            if job.wake is not None:
                job.wake.clear()
            try:
                result = await job.run()
                if result.get("error"):
                    logger.error(
                        "Maintenance job %s failed: %s", job.name, result["error"]
                    )
            except Exception:
                logger.exception("Maintenance job %s crashed", job.name)
            # Interval sleep; wake immediately on shutdown or the job's signal.
            events = [self._stop_event] + ([job.wake] if job.wake is not None else [])
            waiters = [asyncio.create_task(event.wait()) for event in events]
            try:
                await asyncio.wait(
                    waiters,
                    timeout=job.interval_seconds,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            finally:
                # Also runs when stop() cancels this loop mid-wait.
                for waiter in waiters:
                    waiter.cancel()
                await asyncio.gather(*waiters, return_exceptions=True)
