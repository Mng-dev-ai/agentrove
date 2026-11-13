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
from app.services.pairing import PairingService
from app.services.exceptions import ChatException
from app.services.session_registry import session_registry
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
WAITING_OPENING = (
    "These sub-threads you delegated are blocked waiting for input "
    "(sent automatically by Agentrove, not typed by the user):"
)


@dataclass(frozen=True)
class ChildResult:
    chat_id: str
    title: str
    outcome: str
    device_ids: frozenset[UUID]


@dataclass(frozen=True)
class InputWait:
    requests: dict[str, str | None]
    device_ids: frozenset[UUID]


@dataclass(frozen=True)
class WaitingChild:
    chat_id: str
    title: str
    wait: InputWait


class SubThreadWake:
    def __init__(self) -> None:
        self._pending: dict[str, dict[str, frozenset[UUID]]] = {}
        self._waiting: dict[str, dict[str, InputWait]] = {}
        self._scheduled: set[str] = set()
        self._tasks: set[asyncio.Task[None]] = set()

    def on_chain_end(
        self,
        chat_id: str,
        report_parent_id: str | None,
        device_ids: frozenset[UUID],
    ) -> None:
        if report_parent_id is not None:
            self._add_reports(report_parent_id, {chat_id: device_ids})
        for parent_id, waits in list(self._waiting.items()):
            waits.pop(chat_id, None)
            if not waits:
                del self._waiting[parent_id]
        for parent_id in self._pending.keys() | self._waiting.keys():
            if parent_id == chat_id or chat_id in self._pending.get(parent_id, {}):
                self._schedule(parent_id)

    def on_input_request(
        self,
        chat_id: str,
        report_parent_id: str,
        request_id: str,
        tool_name: str | None,
        device_ids: frozenset[UUID],
    ) -> None:
        self._add_waits(
            report_parent_id,
            {chat_id: InputWait({request_id: tool_name}, device_ids)},
        )
        self._schedule(report_parent_id)

    def _add_reports(self, parent_id: str, reports: dict[str, frozenset[UUID]]) -> None:
        pending = self._pending.setdefault(parent_id, {})
        for child_id, device_ids in reports.items():
            pending[child_id] = pending.get(child_id, frozenset()) | device_ids

    def _add_waits(self, parent_id: str, waits: dict[str, InputWait]) -> None:
        waiting = self._waiting.setdefault(parent_id, {})
        for child_id, wait in waits.items():
            previous = waiting.get(child_id, InputWait({}, frozenset()))
            waiting[child_id] = InputWait(
                {**previous.requests, **wait.requests},
                previous.device_ids | wait.device_ids,
            )

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
        if not mid_turn and (
            ChatStreamRuntime.has_pending_start(parent_id)
            or ChatStreamRuntime.has_pending_restore(parent_id)
        ):
            self._schedule(parent_id)
            return
        async with SessionLocal() as db:
            parent = await db.get(
                Chat, UUID(parent_id), options=[selectinload(Chat.user)]
            )
            if parent is None or parent.deleted_at is not None:
                self._pending.pop(parent_id, None)
                self._waiting.pop(parent_id, None)
                return
            children = await self._take_finished(db, parent)
            waiting = await self._take_waiting(db, parent)
        if not children and not waiting:
            return
        device_ids = frozenset[UUID]().union(
            *(c.device_ids for c in children), *(w.wait.device_ids for w in waiting)
        )
        if mid_turn:
            await self._steer_into_turn(parent_id, children, waiting, device_ids)
        else:
            await self._start_wake_turn(parent, children, waiting, device_ids)

    def _requeue(
        self, parent_id: str, reports: dict[str, frozenset[UUID]], *, schedule: bool
    ) -> None:
        if not reports:
            return
        self._add_reports(parent_id, reports)
        if schedule:
            self._schedule(parent_id)

    def _requeue_waiting(
        self, parent_id: str, waiting: list[WaitingChild], *, schedule: bool
    ) -> None:
        waits = {
            child.chat_id: wait
            for child in waiting
            if (wait := self._still_pending(child.chat_id, child.wait)) is not None
        }
        if not waits:
            return
        self._add_waits(parent_id, waits)
        if schedule:
            self._schedule(parent_id)

    @staticmethod
    def _still_pending(chat_id: str, wait: InputWait) -> InputWait | None:
        pending = set(session_registry.pending_permission_ids(chat_id)) | {
            request["request_id"]
            for request in session_registry.pending_elicitations(chat_id)
        }
        requests = {
            request_id: tool_name
            for request_id, tool_name in wait.requests.items()
            if request_id in pending
        }
        return InputWait(requests, wait.device_ids) if requests else None

    def _hold_busy(
        self, parent_id: str, reports: dict[str, frozenset[UUID]]
    ) -> dict[str, frozenset[UUID]]:
        # Avoid circular import with runtime.py.
        from app.services.streaming.runtime import ChatStreamRuntime

        running = {
            c: d for c, d in reports.items() if ChatStreamRuntime.has_active_chat(c)
        }
        starting = {
            c: d
            for c, d in reports.items()
            if c not in running
            and (
                ChatStreamRuntime.has_pending_start(c)
                or ChatStreamRuntime.has_pending_restore(c)
            )
        }
        self._requeue(parent_id, running, schedule=False)
        self._requeue(parent_id, starting, schedule=True)
        return {
            c: d for c, d in reports.items() if c not in running and c not in starting
        }

    async def _take_finished(self, db: AsyncSession, parent: Chat) -> list[ChildResult]:
        parent_id = str(parent.id)
        finished = self._hold_busy(parent_id, self._pending.pop(parent_id, {}))
        loaded = [
            child
            for child_id, device_ids in finished.items()
            if (child := await self._load_child(db, child_id, device_ids)) is not None
        ]
        active = await PairingService.active_device_ids(
            db,
            parent.user_id,
            frozenset[UUID]().union(*(child.device_ids for child in loaded)),
        )
        idle = self._hold_busy(
            parent_id,
            {
                child.chat_id: child.device_ids
                for child in loaded
                if child.device_ids <= active
            },
        )
        return sorted(
            (child for child in loaded if child.chat_id in idle),
            key=attrgetter("title"),
        )

    async def _take_waiting(self, db: AsyncSession, parent: Chat) -> list[WaitingChild]:
        loaded = []
        for child_id, wait in self._waiting.pop(str(parent.id), {}).items():
            pending = self._still_pending(child_id, wait)
            if pending is None:
                continue
            title = await db.scalar(select(Chat.title).where(Chat.id == UUID(child_id)))
            if title is not None:
                loaded.append(WaitingChild(child_id, title, pending))
        active = await PairingService.active_device_ids(
            db,
            parent.user_id,
            frozenset[UUID]().union(*(child.wait.device_ids for child in loaded)),
        )
        reported = []
        for child in loaded:
            if child.wait.device_ids <= active:
                reported.append(child)
            else:
                logger.warning(
                    "Sub-thread %s waits for input but its device was revoked; "
                    "not notifying parent chat %s",
                    child.chat_id,
                    parent.id,
                )
        return sorted(reported, key=attrgetter("title"))

    async def _steer_into_turn(
        self,
        parent_id: str,
        children: list[ChildResult],
        waiting: list[WaitingChild],
        device_ids: frozenset[UUID],
    ) -> None:
        # Avoid circular import with runtime.py.
        from app.services.streaming.runtime import ChatStreamRuntime

        if not await ChatStreamRuntime.steer_app_notice(
            parent_id,
            self._build_prompt(children, waiting, MID_TURN_OPENING),
            self._build_notice(children, waiting),
            device_ids,
        ):
            schedule = not ChatStreamRuntime.has_active_chat(parent_id)
            self._requeue(
                parent_id,
                {child.chat_id: child.device_ids for child in children},
                schedule=schedule,
            )
            self._requeue_waiting(parent_id, waiting, schedule=schedule)

    async def _start_wake_turn(
        self,
        parent: Chat,
        children: list[ChildResult],
        waiting: list[WaitingChild],
        device_ids: frozenset[UUID],
    ) -> None:
        # Avoid circular import with chat.py.
        from app.services.chat import ChatService

        request = self._wake_request(
            parent, self._build_prompt(children, waiting, IDLE_OPENING)
        )
        if request is None:
            logger.warning(
                "Parent chat %s has no usable model to wake with; dropping %d results",
                parent.id,
                len(children) + len(waiting),
            )
            return
        try:
            await ChatService(UserService()).initiate_chat_completion(
                request,
                parent.user,
                user_app_notice=self._build_notice(children, waiting),
                device_ids=device_ids,
            )
        except Exception as exc:
            busy = isinstance(exc, ChatException) and exc.status_code == 409
            self._requeue(
                str(parent.id),
                {child.chat_id: child.device_ids for child in children},
                schedule=busy,
            )
            self._requeue_waiting(str(parent.id), waiting, schedule=busy)
            if not busy:
                raise

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
    async def _load_child(
        db: AsyncSession, child_id: str, device_ids: frozenset[UUID]
    ) -> ChildResult | None:
        title = await db.scalar(select(Chat.title).where(Chat.id == UUID(child_id)))
        if title is None:
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
            title=title,
            outcome=outcome.value if outcome else "unknown",
            device_ids=device_ids,
        )

    @staticmethod
    def _build_prompt(
        children: list[ChildResult], waiting: list[WaitingChild], opening: str
    ) -> str:
        sections = []
        if children:
            lines = [
                f"- {child.title} (chat_id: {child.chat_id}, outcome: {child.outcome})"
                for child in children
            ]
            sections.append(
                f"{opening}\n\n"
                + "\n".join(lines)
                + "\n\nRead each sub-thread's final response with get_messages "
                "before replying. Report each result to the user in your own words, "
                "including anything they must act on. If you already reported one of "
                "these in this conversation, say so in one line instead of repeating it."
            )
        if waiting:
            lines = [
                f"- {child.title} (chat_id: {child.chat_id}, waiting on: "
                + ", ".join(
                    "a question" if tool_name is None else f"permission for {tool_name}"
                    for tool_name in child.wait.requests.values()
                )
                + ")"
                for child in waiting
            ]
            sections.append(
                f"{WAITING_OPENING}\n\n"
                + "\n".join(lines)
                + "\n\nCall get_pending_requests(chat_id) to read each request and "
                "respond_to_request to answer it. The sub-thread resumes as soon as it "
                "is answered and may ask again. Answer yourself only what your task "
                "context settles; put any question or permission that needs the "
                "user's judgement to the user instead. Use stop_chat to end a "
                "sub-thread that should not continue."
            )
        return "\n\n".join(sections)

    @staticmethod
    def _build_notice(children: list[ChildResult], waiting: list[WaitingChild]) -> str:
        sections = []
        if children:
            lines = ["Finished sub-threads:"]
            for child in children:
                title = SubThreadWake._notice_title(child.title)
                lines.append(
                    f"- **[{title}](/chat/{child.chat_id})** ({child.outcome})"
                )
            sections.append("\n".join(lines))
        if waiting:
            lines = ["Sub-threads waiting for input:"]
            for waiting_child in waiting:
                title = SubThreadWake._notice_title(waiting_child.title)
                lines.append(f"- **[{title}](/chat/{waiting_child.chat_id})**")
            sections.append("\n".join(lines))
        return "\n\n".join(sections)

    @staticmethod
    def _notice_title(title: str) -> str:
        return title.replace("[", "\\[").replace("]", "\\]")


subthread_wake = SubThreadWake()
