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
from app.services.refresh_token import RefreshTokenService
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


class MaintenanceService:
    def __init__(self) -> None:
        self._stop_event = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []
        self._automation_service = AutomationService(ChatService(UserService()))

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._run_job_loop(self._refresh_tokens_job())),
            asyncio.create_task(self._run_job_loop(self._idle_session_cleanup_job())),
            asyncio.create_task(self._run_job_loop(self._automation_dispatch_job())),
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
            try:
                result = await job.run()
                if result.get("error"):
                    logger.error(
                        "Maintenance job %s failed: %s", job.name, result["error"]
                    )
            except Exception:
                logger.exception("Maintenance job %s crashed", job.name)
            # Interval sleep; wake immediately on shutdown.
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=job.interval_seconds,
                )
            except asyncio.TimeoutError:
                continue
