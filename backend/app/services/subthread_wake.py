import asyncio
import logging
from dataclasses import dataclass
from operator import attrgetter
from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants import MODELS
from app.db.session import SessionLocal
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageRole
from app.models.schemas.chat import ChatRequest
from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import NORMAL_SESSION_MODE
from app.services.device_session import active_device_ids
from app.services.exceptions import ChatException
from app.services.user import UserService

logger = logging.getLogger(__name__)

WAKE_DEBOUNCE_SECONDS = 5.0
IDLE_OPENING = (
    "This message was sent automatically by Agentrove, not typed by the user. "
    "These sub-threads you delegated have finished:"
)
MID_TURN_OPENING = (
    "While you were working, these sub-threads you delegated finished "
    "(sent automatically by Agentrove, not typed by the user):"
)


@dataclass(frozen=True)
class ChildResult:
    chat_id: str
    title: str
    outcome: str
    device_ids: frozenset[UUID]


class SubThreadWake:
    def __init__(self) -> None:
        self._pending: dict[str, set[str]] = {}
        self._scheduled: set[str] = set()
        self._tasks: set[asyncio.Task[None]] = set()

    def on_chain_end(self, chat_id: str, report_parent_id: str | None) -> None:
        if report_parent_id is not None:
            self._pending.setdefault(report_parent_id, set()).add(chat_id)
        for parent_id, child_ids in list(self._pending.items()):
            if parent_id == chat_id or chat_id in child_ids:
                self._schedule(parent_id)

    def _schedule(self, parent_id: str) -> None:
        if parent_id in self._scheduled:
            return
        self._scheduled.add(parent_id)
        task = asyncio.create_task(self._flush_later(parent_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _flush_later(self, parent_id: str) -> None:
        await asyncio.sleep(WAKE_DEBOUNCE_SECONDS)
        self._scheduled.discard(parent_id)
        try:
            await self._flush(parent_id)
        except Exception:
            logger.exception("Failed to wake parent chat %s", parent_id)

    async def _flush(self, parent_id: str) -> None:
        # Avoid circular import with runtime.py.
        from app.services.streaming.runtime import ChatStreamRuntime

        mid_turn = ChatStreamRuntime.has_active_chat(parent_id)
        if not mid_turn and ChatStreamRuntime.has_pending_start(parent_id):
            self._schedule(parent_id)
            return
        async with SessionLocal() as db:
            parent = await db.get(
                Chat, UUID(parent_id), options=[selectinload(Chat.user)]
            )
            if parent is None or parent.deleted_at is not None:
                self._pending.pop(parent_id, None)
                return
            children = await self._take_finished(db, parent)
        if not children:
            return
        device_ids = frozenset[UUID]().union(*(c.device_ids for c in children))
        if mid_turn:
            await self._steer_into_turn(parent_id, children, device_ids)
        else:
            await self._start_wake_turn(
                parent, children, parent.last_device_ids | device_ids
            )

    def _requeue(self, parent_id: str, child_ids: set[str], *, schedule: bool) -> None:
        if not child_ids:
            return
        self._pending.setdefault(parent_id, set()).update(child_ids)
        if schedule:
            self._schedule(parent_id)

    def _hold_busy(self, parent_id: str, child_ids: set[str]) -> set[str]:
        # Avoid circular import with runtime.py.
        from app.services.streaming.runtime import ChatStreamRuntime

        running = {c for c in child_ids if ChatStreamRuntime.has_active_chat(c)}
        starting = {
            c for c in child_ids - running if ChatStreamRuntime.has_pending_start(c)
        }
        self._requeue(parent_id, running, schedule=False)
        self._requeue(parent_id, starting, schedule=True)
        return child_ids - running - starting

    async def _take_finished(self, db: AsyncSession, parent: Chat) -> list[ChildResult]:
        parent_id = str(parent.id)
        finished = self._hold_busy(parent_id, self._pending.pop(parent_id, set()))
        loaded = [
            child
            for child_id in finished
            if (child := await self._load_child(db, child_id)) is not None
        ]
        active = await active_device_ids(
            db,
            parent.user_id,
            frozenset[UUID]().union(*(child.device_ids for child in loaded)),
        )
        idle = self._hold_busy(
            parent_id,
            {child.chat_id for child in loaded if child.device_ids <= active},
        )
        return sorted(
            (child for child in loaded if child.chat_id in idle),
            key=attrgetter("title"),
        )

    async def _steer_into_turn(
        self, parent_id: str, children: list[ChildResult], device_ids: frozenset[UUID]
    ) -> None:
        # Avoid circular import with runtime.py.
        from app.services.streaming.runtime import ChatStreamRuntime

        if not await ChatStreamRuntime.steer_app_notice(
            parent_id,
            self._build_prompt(children, MID_TURN_OPENING),
            self._build_notice(children),
            device_ids,
        ):
            self._requeue(
                parent_id,
                {child.chat_id for child in children},
                schedule=not ChatStreamRuntime.has_active_chat(parent_id),
            )

    async def _start_wake_turn(
        self, parent: Chat, children: list[ChildResult], device_ids: frozenset[UUID]
    ) -> None:
        # Avoid circular import with chat.py.
        from app.services.chat import ChatService

        request = self._wake_request(parent, self._build_prompt(children, IDLE_OPENING))
        if request is None:
            logger.warning(
                "Parent chat %s has no usable model to wake with; dropping %d results",
                parent.id,
                len(children),
            )
            return
        try:
            await ChatService(UserService()).initiate_chat_completion(
                request,
                parent.user,
                user_app_notice=self._build_notice(children),
                device_ids=device_ids,
            )
        except ChatException as exc:
            if exc.status_code != 409:
                raise
            self._requeue(
                str(parent.id), {child.chat_id for child in children}, schedule=True
            )

    @staticmethod
    def _wake_request(parent: Chat, prompt: str) -> ChatRequest | None:
        model_id = parent.last_model_id
        if model_id is None or model_id not in MODELS:
            return None
        return ChatRequest(
            prompt=prompt,
            chat_id=parent.id,
            model_id=model_id,
            permission_mode=cast(
                PermissionMode,
                parent.last_permission_mode
                or NORMAL_SESSION_MODE[MODELS[model_id].agent_kind],
            ),
            thinking_mode=parent.last_thinking_mode,
            selected_persona_name=parent.last_persona_name or DEFAULT_PERSONA_NAME,
        )

    @staticmethod
    async def _load_child(db: AsyncSession, child_id: str) -> ChildResult | None:
        row = (
            await db.execute(
                select(Chat.title, Chat.last_device_ids).where(
                    Chat.id == UUID(child_id)
                )
            )
        ).one_or_none()
        if row is None:
            return None
        outcome = await db.scalar(
            select(Message.stream_status)
            .where(
                Message.chat_id == UUID(child_id),
                Message.role == MessageRole.ASSISTANT,
                Message.deleted_at.is_(None),
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        return ChildResult(
            chat_id=child_id,
            title=row.title,
            outcome=outcome.value if outcome else "unknown",
            device_ids=row.last_device_ids,
        )

    @staticmethod
    def _build_prompt(children: list[ChildResult], opening: str) -> str:
        lines = [
            f"- {child.title} (chat_id: {child.chat_id}, outcome: {child.outcome})"
            for child in children
        ]
        return (
            f"{opening}\n\n"
            + "\n".join(lines)
            + "\n\nRead each sub-thread's final response with get_messages before "
            "replying. Report each result to the user in your own words, including "
            "anything they must act on. If you already reported one of these in "
            "this conversation, say so in one line instead of repeating it."
        )

    @staticmethod
    def _build_notice(children: list[ChildResult]) -> str:
        lines = ["Finished sub-threads:"]
        for child in children:
            title = child.title.replace("[", "\\[").replace("]", "\\]")
            lines.append(f"- **[{title}](/chat/{child.chat_id})** ({child.outcome})")
        return "\n".join(lines)


subthread_wake = SubThreadWake()
