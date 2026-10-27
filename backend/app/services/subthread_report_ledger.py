from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import case, delete, insert, literal, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.chat import Message
from app.models.db_models.enums import MessageStreamStatus, SubThreadReportStatus
from app.db.types import UTCDateTime
from app.models.db_models.subthread_report import SubThreadReport

# Every SubThreadReport write lives here. The lifecycle, with each transition a
# guarded UPDATE on the source status:
#   running -> pending      child reached a terminal status
#   pending -> waking       a parent turn was started to report it
#   waking  -> covered      the parent named it as covered by that turn
#   covered -> acknowledged the turn completed with a reply
#   pending -> notified     an app-generated parent message delivered the result
#   waking/covered -> pending   the turn did not deliver; retried after backoff
#                               counted from the end of that turn
Status = SubThreadReportStatus

# Lets a burst of child completions land in a single parent turn.
WAKE_DEBOUNCE_SECONDS = 10.0
WAKE_RETRY_SECONDS = 60.0
WAKE_RETRY_CAP_SECONDS = 900.0


def retry_delay(attempts: int) -> timedelta:
    # Capped rather than bounded in count so a transient failure never strands a
    # finished child.
    return timedelta(
        seconds=min(WAKE_RETRY_SECONDS * 2 ** min(attempts, 10), WAKE_RETRY_CAP_SECONDS)
    )


async def create_report(
    db: AsyncSession,
    *,
    parent_chat_id: UUID,
    child_chat_id: UUID,
    child_message_id: UUID,
) -> None:
    await db.execute(
        insert(SubThreadReport).values(
            id=uuid4(),
            parent_chat_id=parent_chat_id,
            child_chat_id=child_chat_id,
            child_message_id=child_message_id,
            status=Status.RUNNING,
        )
    )


async def record_child_terminal(
    db: AsyncSession,
    *,
    message_id: UUID,
    status: MessageStreamStatus,
    now: datetime,
) -> None:
    # Runs in the same transaction as the child's terminal status, so a finished
    # child can never exist without its report becoming due.
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.child_message_id == message_id,
            SubThreadReport.status == Status.RUNNING,
        )
        .values(
            status=Status.PENDING,
            outcome=status,
            next_attempt_at=now + timedelta(seconds=WAKE_DEBOUNCE_SECONDS),
        )
    )


async def link_wake_turn(
    db: AsyncSession, *, report_ids: list[UUID], message_id: UUID
) -> None:
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.id.in_(report_ids),
            SubThreadReport.status == Status.PENDING,
        )
        .values(
            status=Status.WAKING,
            wake_message_id=message_id,
            attempts=SubThreadReport.attempts + 1,
        )
    )


async def mark_covered(
    db: AsyncSession,
    *,
    parent_chat_id: UUID,
    child_message_ids: list[UUID],
) -> int:
    # Only rows linked to the parent's running wake turn can be covered, so a
    # failed attempt's coverage never carries into a later reply.
    running_turn = select(Message.id).where(
        Message.chat_id == parent_chat_id,
        Message.stream_status == MessageStreamStatus.IN_PROGRESS,
        Message.deleted_at.is_(None),
    )
    result = await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.parent_chat_id == parent_chat_id,
            SubThreadReport.child_message_id.in_(child_message_ids),
            SubThreadReport.status == Status.WAKING,
            SubThreadReport.wake_message_id.in_(running_turn),
        )
        .values(status=Status.COVERED)
    )
    return int(getattr(result, "rowcount", 0))


async def _release_wake_turn(
    db: AsyncSession, message_id: UUID, now: datetime
) -> None:
    # The retry deadline starts when the turn ends, so a long wake never uses up
    # its own backoff. attempts was bumped when the row was linked.
    retry_at = case(
        *(
            (
                SubThreadReport.attempts == attempts,
                literal(now + retry_delay(attempts - 1), UTCDateTime()),
            )
            for attempts in range(1, 6)
        ),
        else_=literal(now + retry_delay(10), UTCDateTime()),
    )
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.wake_message_id == message_id,
            SubThreadReport.status.in_((Status.WAKING, Status.COVERED)),
        )
        .values(status=Status.PENDING, wake_message_id=None, next_attempt_at=retry_at)
    )


async def settle_wake_turn(
    db: AsyncSession,
    *,
    message_id: UUID,
    status: MessageStreamStatus,
    content_text: str,
    now: datetime,
) -> None:
    # Only the results this turn was composed for are touched; anything that
    # finished while it ran has no link to it and stays pending.
    if status == MessageStreamStatus.COMPLETED and content_text.strip():
        await db.execute(
            update(SubThreadReport)
            .where(
                SubThreadReport.wake_message_id == message_id,
                SubThreadReport.status == Status.COVERED,
            )
            .values(status=Status.ACKNOWLEDGED)
        )
    # Whatever the reply did not explicitly cover goes back to the queue.
    await _release_wake_turn(db, message_id, now)


async def discard_message_reports(
    db: AsyncSession, *, message_id: UUID, now: datetime
) -> None:
    # A discarded child can never finish, and a discarded wake turn never
    # delivers; leaving either row behind would stall or strand its report.
    await db.execute(
        delete(SubThreadReport).where(SubThreadReport.child_message_id == message_id)
    )
    await _release_wake_turn(db, message_id, now)


async def notify_reports(
    db: AsyncSession, *, report_ids: list[UUID], notice_message_id: UUID
) -> None:
    # Delivered by an app-generated message, with no parent turn involved.
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.id.in_(report_ids),
            SubThreadReport.status == Status.PENDING,
        )
        .values(status=Status.NOTIFIED, wake_message_id=notice_message_id)
    )


async def defer_reports(
    db: AsyncSession, *, reports: list[tuple[UUID, int]], now: datetime
) -> None:
    for report_id, attempts in reports:
        await db.execute(
            update(SubThreadReport)
            .where(
                SubThreadReport.id == report_id,
                SubThreadReport.status == Status.PENDING,
            )
            .values(
                next_attempt_at=now + retry_delay(attempts),
                attempts=attempts + 1,
            )
        )


async def acknowledge_parent_reports(db: AsyncSession, *, parent_chat_id: UUID) -> None:
    # The parent no longer exists to report to.
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.parent_chat_id == parent_chat_id,
            SubThreadReport.status.not_in((Status.ACKNOWLEDGED, Status.NOTIFIED)),
        )
        .values(status=Status.ACKNOWLEDGED)
    )


async def prune_delivered_reports(
    db: AsyncSession, *, delivered_before: datetime
) -> int:
    # Bookkeeping only: chats and messages are untouched. Kept for a while after
    # delivery so a late wake still sees what was already reported.
    result = await db.execute(
        delete(SubThreadReport).where(
            SubThreadReport.status.in_((Status.ACKNOWLEDGED, Status.NOTIFIED)),
            SubThreadReport.updated_at < delivered_before,
        )
    )
    return int(getattr(result, "rowcount", 0))
