import logging
from datetime import datetime, timedelta, timezone
from typing import Any, cast
from uuid import UUID

from sqlalchemy import select, update

from app.constants import MODELS
from app.models.db_models.chat import Chat
from app.models.db_models.subthread_report import SubThreadReport
from app.models.db_models.user import User
from app.models.schemas.chat import ChatRequest
from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.chat import ChatService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.subthread_report_ledger import WAKE_RETRY_SECONDS

logger = logging.getLogger(__name__)

DISPATCH_INTERVAL_SECONDS = 5.0
# Wakes that end without a delivered reply stop being retried past this.
MAX_WAKE_ATTEMPTS = 5


class SubThreadReportService(BaseDbService[SubThreadReport]):
    def __init__(
        self,
        chat_service: ChatService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self._chat_service = chat_service

    async def dispatch_due(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        async with self.session_factory() as db:
            parent_ids = (
                await db.scalars(
                    select(SubThreadReport.parent_chat_id)
                    .where(*self._unreported(), SubThreadReport.next_attempt_at <= now)
                    .distinct()
                )
            ).all()
        woken = 0
        for parent_id in parent_ids:
            try:
                woken += await self._wake_parent(parent_id)
            except Exception:
                logger.exception("Sub-thread report wake failed for chat %s", parent_id)
        return {"woken": woken}

    @staticmethod
    def _unreported() -> list[Any]:
        return [
            SubThreadReport.finished_at.is_not(None),
            SubThreadReport.acknowledged_at.is_(None),
            SubThreadReport.wake_message_id.is_(None),
            SubThreadReport.attempts < MAX_WAKE_ATTEMPTS,
        ]

    async def _wake_parent(self, parent_id: UUID) -> int:
        # Never interrupt a running parent turn; the rows stay due and the next
        # tick retries once it closes.
        if ChatStreamRuntime.has_active_chat(
            str(parent_id)
        ) or ChatStreamRuntime.has_pending_start(str(parent_id)):
            return 0
        async with self.session_factory() as db:
            parent = await db.get(Chat, parent_id)
            if parent is None or parent.deleted_at is not None:
                await db.execute(
                    update(SubThreadReport)
                    .where(
                        SubThreadReport.parent_chat_id == parent_id,
                        SubThreadReport.acknowledged_at.is_(None),
                    )
                    .values(acknowledged_at=datetime.now(timezone.utc))
                )
                await db.commit()
                return 0
            user = await db.get(User, parent.user_id)
            finished = (
                await db.scalars(
                    select(SubThreadReport)
                    .where(
                        SubThreadReport.parent_chat_id == parent_id,
                        *self._unreported(),
                    )
                    .order_by(SubThreadReport.finished_at)
                )
            ).all()
            running = (
                await db.scalars(
                    select(SubThreadReport).where(
                        SubThreadReport.parent_chat_id == parent_id,
                        SubThreadReport.finished_at.is_(None),
                    )
                )
            ).all()
            titles = dict(
                (
                    await db.execute(
                        select(Chat.id, Chat.title).where(
                            Chat.id.in_(
                                {r.child_chat_id for r in [*finished, *running]}
                            )
                        )
                    )
                ).all()
            )
        if not finished or user is None:
            return 0

        report_ids = [report.id for report in finished]
        if parent.last_model_id not in MODELS:
            await self._defer(report_ids)
            return 0
        request = ChatRequest(
            prompt=self._build_prompt(finished, running, titles),
            chat_id=parent_id,
            model_id=cast(str, parent.last_model_id),
            permission_mode=cast(PermissionMode, "bypassPermissions"),
            thinking_mode=parent.last_thinking_mode,
            selected_persona_name=parent.last_persona_name or DEFAULT_PERSONA_NAME,
            wake_report_ids=report_ids,
        )
        try:
            await self._chat_service.initiate_chat_completion(request, user)
        except ChatException as exc:
            if exc.status_code == 409:
                return 0
            await self._defer(report_ids)
            raise
        except Exception:
            await self._defer(report_ids)
            raise
        return 1

    async def _defer(self, report_ids: list[UUID]) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(SubThreadReport)
                .where(
                    SubThreadReport.id.in_(report_ids),
                    SubThreadReport.wake_message_id.is_(None),
                )
                .values(
                    next_attempt_at=datetime.now(timezone.utc)
                    + timedelta(seconds=WAKE_RETRY_SECONDS),
                    attempts=SubThreadReport.attempts + 1,
                )
            )
            await db.commit()

    @staticmethod
    def _build_prompt(
        finished: list[SubThreadReport],
        running: list[SubThreadReport],
        titles: dict[UUID, str],
    ) -> str:
        lines = [
            "[Automated sub-thread update] The sub-threads you delegated finished. "
            "None of these results has been reported to the user yet.",
            "",
            "Finished:",
        ]
        lines += [
            f'- "{titles.get(r.child_chat_id, "Untitled")}" '
            f"(chat_id {r.child_chat_id}): {r.outcome}"
            for r in finished
        ]
        if running:
            lines += ["", "Still running:"]
            lines += [
                f'- "{titles.get(r.child_chat_id, "Untitled")}" '
                f"(chat_id {r.child_chat_id})"
                for r in running
            ]
        lines += [
            "",
            "Read each finished sub-thread's result (get_messages with its chat_id), "
            "then reply to the user with a brief summary of what finished.",
        ]
        return "\n".join(lines)
