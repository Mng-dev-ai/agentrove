import logging
import re
from datetime import datetime, timedelta, timezone
from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from sqlalchemy import select, update

from app.constants import MODELS
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageStreamStatus, SubThreadReportStatus
from app.models.db_models.subthread_report import SubThreadReport
from app.models.db_models.user import User
from app.models.schemas.chat import ChatRequest
from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import NORMAL_SESSION_MODE
from app.services.chat import ChatService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException
from app.services.message import MessageService
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.subthread_report_ledger import (
    acknowledge_parent_reports,
    notify_reports,
    defer_reports,
)

logger = logging.getLogger(__name__)

DISPATCH_INTERVAL_SECONDS = 5.0
# A parent that released its results uncovered this many times gets them posted
# as a message instead of another turn.
FALLBACK_AFTER_ATTEMPTS = 2
RESULT_EXCERPT_CHARS = 4000
# Whole-prompt budget, below ChatRequest's 100000-character prompt limit.
PROMPT_BUDGET_CHARS = 80000
MAX_RUNNING_LISTED = 20
MAX_BATCH_REPORTS = 10
# A wake turn that is still running after this is treated as wedged and cancelled.
WAKE_TURN_DEADLINE_SECONDS = 600.0
CANCEL_UNWIND_TIMEOUT_SECONDS = 10.0
DELIVERED_NOTICES_IN_PROMPT = 5
Status = SubThreadReportStatus


def _outcome(report: SubThreadReport) -> str:
    return report.outcome.value if report.outcome else "unknown"


def _wake_permission_mode(parent: Chat, model_id: str) -> PermissionMode:
    # Never more permissive than the parent's last turn; chats that predate the
    # saved mode fall back to the agent's normal mode.
    return cast(
        PermissionMode,
        parent.last_permission_mode or NORMAL_SESSION_MODE[MODELS[model_id].agent_kind],
    )


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
        await self._cancel_wedged_wakes(now)
        async with self.session_factory() as db:
            parent_ids = (
                await db.scalars(
                    select(SubThreadReport.parent_chat_id)
                    .where(
                        SubThreadReport.status == Status.PENDING,
                        SubThreadReport.next_attempt_at <= now,
                    )
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

    async def _cancel_wedged_wakes(self, now: datetime) -> None:
        # The cancelled turn lands interrupted, which releases its rows for retry.
        async with self.session_factory() as db:
            wedged = (
                await db.execute(
                    select(Message.chat_id, Message.id)
                    .where(
                        Message.id.in_(
                            select(SubThreadReport.wake_message_id).where(
                                SubThreadReport.status.in_(
                                    (Status.WAKING, Status.COVERED)
                                )
                            )
                        ),
                        Message.stream_status == MessageStreamStatus.IN_PROGRESS,
                        Message.created_at
                        < now - timedelta(seconds=WAKE_TURN_DEADLINE_SECONDS),
                    )
                    .distinct()
                )
            ).all()
        for chat_id, message_id in wedged:
            try:
                if await ChatStreamRuntime.cancel_chat_turn_if_current(
                    str(chat_id), str(message_id), CANCEL_UNWIND_TIMEOUT_SECONDS
                ):
                    logger.warning("Cancelled wedged wake turn %s", message_id)
                    continue
                # No runtime owns the turn (e.g. its terminal write failed), so
                # nothing will ever settle it; finalizing releases its reports.
                await ChatStreamRuntime.finalize_dead_stream(
                    assistant_message_id=str(message_id),
                    session_factory=self.session_factory,
                    stream_status=MessageStreamStatus.INTERRUPTED,
                    record_activity=False,
                )
            except Exception:
                logger.exception("Failed to cancel wake turn %s", message_id)

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
                await acknowledge_parent_reports(db, parent_chat_id=parent_id)
                await db.commit()
                return 0
            user = await db.get(User, parent.user_id)
            # Every finished, unreported child rides along, not only the due ones.
            finished = (
                await db.scalars(
                    select(SubThreadReport)
                    .where(
                        SubThreadReport.parent_chat_id == parent_id,
                        SubThreadReport.status == Status.PENDING,
                    )
                    .order_by(SubThreadReport.created_at)
                )
            ).all()
            running = (
                await db.scalars(
                    select(SubThreadReport).where(
                        SubThreadReport.parent_chat_id == parent_id,
                        SubThreadReport.status == Status.RUNNING,
                    )
                )
            ).all()
            delivered = (
                await db.scalars(
                    select(SubThreadReport)
                    .where(
                        SubThreadReport.parent_chat_id == parent_id,
                        SubThreadReport.status == Status.NOTIFIED,
                    )
                    .order_by(SubThreadReport.updated_at.desc())
                    .limit(DELIVERED_NOTICES_IN_PROMPT)
                )
            ).all()
            child_ids = {r.child_chat_id for r in [*finished, *running, *delivered]}
            titles = dict(
                (
                    await db.execute(
                        select(Chat.id, Chat.title).where(Chat.id.in_(child_ids))
                    )
                ).all()
            )
            # Results whose wakes already failed are posted directly; the rest
            # still get a model turn.
            exhausted = [r for r in finished if r.attempts >= FALLBACK_AFTER_ATTEMPTS]
            pool = (exhausted or finished)[:MAX_BATCH_REPORTS]
            results = dict(
                (
                    await db.execute(
                        select(Message.id, Message.content_text).where(
                            Message.id.in_([r.child_message_id for r in pool])
                        )
                    )
                ).all()
            )
        if not finished or user is None:
            return 0
        if exhausted:
            batch = self._fit_batch(
                exhausted,
                lambda picked: self._build_results_message(
                    picked, titles, results, len(exhausted) - len(picked)
                ),
            )
            try:
                return await self._post_results(
                    parent_id,
                    user.id,
                    batch,
                    titles,
                    results,
                    len(exhausted) - len(batch),
                )
            except Exception:
                await self._defer(batch)
                raise

        # Only the reports whose entries fit the prompt are linked to the wake;
        # the rest stay pending for the next one.
        batch = self._fit_batch(
            finished,
            lambda picked: self._build_prompt(
                picked, running, titles, results, delivered, len(finished) - len(picked)
            ),
        )
        try:
            model_id = parent.last_model_id
            if model_id is None or model_id not in MODELS:
                await self._defer(batch)
                return 0
            request = ChatRequest(
                prompt=self._build_prompt(
                    batch,
                    running,
                    titles,
                    results,
                    delivered,
                    len(finished) - len(batch),
                ),
                chat_id=parent_id,
                model_id=model_id,
                permission_mode=_wake_permission_mode(parent, model_id),
                thinking_mode=parent.last_thinking_mode,
                selected_persona_name=parent.last_persona_name or DEFAULT_PERSONA_NAME,
            )
            await self._chat_service.initiate_chat_completion(
                request, user, wake_report_ids=[r.id for r in batch]
            )
        except ChatException as exc:
            if exc.status_code == 409:
                return 0
            await self._defer(batch)
            raise
        except Exception:
            await self._defer(batch)
            raise
        return 1

    @staticmethod
    def _fit_batch(
        reports: list[SubThreadReport],
        render: Callable[[list[SubThreadReport]], str],
    ) -> list[SubThreadReport]:
        # The oldest is always taken so it can't starve; its capped excerpt plus the
        # capped running and delivered lists stay far below the budget.
        batch: list[SubThreadReport] = []
        for report in reports[:MAX_BATCH_REPORTS]:
            if batch and len(render([*batch, report])) > PROMPT_BUDGET_CHARS:
                break
            batch.append(report)
        return batch

    async def _defer(self, reports: list[SubThreadReport]) -> None:
        async with self.session_factory() as db:
            await defer_reports(
                db,
                reports=[(r.id, r.attempts) for r in reports],
                now=datetime.now(timezone.utc),
            )
            await db.commit()

    async def _post_results(
        self,
        parent_id: UUID,
        user_id: UUID,
        finished: list[SubThreadReport],
        titles: dict[UUID, str],
        results: dict[UUID, str],
        more: int,
    ) -> int:
        text = self._build_results_message(finished, titles, results, more)
        # Same guard a user's send takes, so the notice never lands mid-start.
        async with ChatStreamRuntime.chat_start_slot(str(parent_id)) as reserved:
            if not reserved:
                return 0
            async with self.session_factory() as db:
                message = await MessageService.add_app_message(
                    db, chat_id=parent_id, text=text
                )
                # New activity for the user: flags the parent unread.
                await db.execute(
                    update(Chat)
                    .where(Chat.id == parent_id)
                    .values(updated_at=datetime.now(timezone.utc))
                )
                await notify_reports(
                    db,
                    report_ids=[r.id for r in finished],
                    notice_message_id=message.id,
                )
                await db.commit()
        # Open sessions refetch the parent's messages; best-effort after commit.
        await ChatService.publish_user_chat_event(
            user_id,
            {"kind": "message_appended", "chat_id": str(parent_id)},
        )
        return 1

    @staticmethod
    def _excerpt(text: str) -> str:
        text = text.strip()
        if len(text) <= RESULT_EXCERPT_CHARS:
            return text
        cut = text[:RESULT_EXCERPT_CHARS]
        if not text[RESULT_EXCERPT_CHARS].isspace():
            # Back up to a word boundary rather than cutting mid-word.
            cut = re.sub(r"\s+\S*$", "", cut) or cut
        omitted = len(text) - len(cut)
        return (
            f"{cut.rstrip()}\n\n[truncated: {omitted} more characters in the "
            "sub-thread's full response]"
        )

    @classmethod
    def _build_results_message(
        cls,
        finished: list[SubThreadReport],
        titles: dict[UUID, str],
        results: dict[UUID, str],
        more: int,
    ) -> str:
        sections = ["Sub-thread results that could not be summarised automatically:"]
        for report in finished:
            title = titles.get(report.child_chat_id, "Untitled")
            body = cls._excerpt(results.get(report.child_message_id, ""))
            label = title.replace("[", "\\[").replace("]", "\\]")
            sections.append(
                f"**[{label}](/chat/{report.child_chat_id})** ({_outcome(report)})\n\n"
                f"{body or '(no final response)'}"
            )
        if more:
            sections.append(f"{more} more sub-thread results are still pending.")
        return "\n\n".join(sections)

    @classmethod
    def _build_prompt(
        cls,
        finished: list[SubThreadReport],
        running: list[SubThreadReport],
        titles: dict[UUID, str],
        results: dict[UUID, str],
        delivered: list[SubThreadReport],
        more: int,
    ) -> str:
        lines = [
            "[Automated sub-thread update] The sub-threads you delegated finished. "
            "None of these results has been reported to the user yet.",
            "",
            "Finished:",
        ]
        for r in finished:
            lines += [
                f'- "{titles.get(r.child_chat_id, "Untitled")}" '
                f"(message_id {r.child_message_id}): "
                f"{_outcome(r)}",
                "  Final response:",
                cls._excerpt(results.get(r.child_message_id, "")) or "(none)",
            ]
        if running:
            lines += ["", "Still running:"]
            lines += [
                f'- "{titles.get(r.child_chat_id, "Untitled")}" '
                f"(chat_id {r.child_chat_id})"
                for r in running[:MAX_RUNNING_LISTED]
            ]
            if len(running) > MAX_RUNNING_LISTED:
                lines.append(f"- and {len(running) - MAX_RUNNING_LISTED} more")
        if delivered:
            lines += [
                "",
                "Already delivered to the user as an automated notice in this chat "
                "(do not report these again):",
            ]
            lines += [
                f'- "{titles.get(r.child_chat_id, "Untitled")}" '
                f"({_outcome(r)})"
                for r in delivered
            ]
        if more:
            lines += [
                "",
                f"{more} more finished results are not listed here and will arrive in "
                "a later update. Do not present this list as everything that finished.",
            ]
        lines += [
            "",
            "Reply to the user with a brief summary of what finished, and in the "
            "same turn call report_subthreads_covered with the message_ids your reply "
            "covers. Results you do not cover are re-delivered later.",
        ]
        return "\n".join(lines)
