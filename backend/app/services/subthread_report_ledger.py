from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, insert, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.enums import MessageStreamStatus
from app.models.db_models.subthread_report import SubThreadReport

# Lets a burst of child completions land in a single parent turn.
WAKE_DEBOUNCE_SECONDS = 10.0
WAKE_RETRY_SECONDS = 60.0


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
            SubThreadReport.finished_at.is_(None),
        )
        .values(
            outcome=status.value,
            finished_at=now,
            next_attempt_at=now + timedelta(seconds=WAKE_DEBOUNCE_SECONDS),
        )
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
    delivered = status == MessageStreamStatus.COMPLETED and bool(content_text.strip())
    values: dict[str, datetime | None] = (
        {"acknowledged_at": now}
        if delivered
        else {
            "wake_message_id": None,
            "next_attempt_at": now + timedelta(seconds=WAKE_RETRY_SECONDS),
        }
    )
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.wake_message_id == message_id,
            SubThreadReport.acknowledged_at.is_(None),
        )
        .values(**values)
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
        )
    )


async def link_wake_turn(
    db: AsyncSession, *, report_ids: list[UUID], message_id: UUID
) -> None:
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.id.in_(report_ids),
            SubThreadReport.wake_message_id.is_(None),
            SubThreadReport.acknowledged_at.is_(None),
        )
        .values(wake_message_id=message_id, attempts=SubThreadReport.attempts + 1)
    )


async def discard_message_reports(
    db: AsyncSession, *, message_id: UUID, now: datetime
) -> None:
    # A discarded child can never finish, and a discarded wake turn never
    # delivers; leaving either row behind would stall or strand its report.
    await db.execute(
        delete(SubThreadReport).where(SubThreadReport.child_message_id == message_id)
    )
    await db.execute(
        update(SubThreadReport)
        .where(
            SubThreadReport.wake_message_id == message_id,
            SubThreadReport.acknowledged_at.is_(None),
        )
        .values(wake_message_id=None, next_attempt_at=now)
    )
