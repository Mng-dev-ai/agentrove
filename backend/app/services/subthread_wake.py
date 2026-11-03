import asyncio
import logging
import re
from dataclasses import dataclass
from operator import attrgetter
from typing import cast
from uuid import UUID

from pydantic import ValidationError
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
from app.services.exceptions import ChatException
from app.services.user import UserService

logger = logging.getLogger(__name__)

WAKE_DEBOUNCE_SECONDS = 5.0
RESULT_EXCERPT_CHARS = 4000
MAX_WAKE_CHILDREN = 10


@dataclass(frozen=True)
class ChildResult:
    chat_id: str
    title: str
    outcome: str
    response: str


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
        from app.services.chat import ChatService
        from app.services.streaming.runtime import ChatStreamRuntime

        if ChatStreamRuntime.has_active_chat(parent_id):
            return
        if ChatStreamRuntime.has_pending_start(parent_id):
            self._schedule(parent_id)
            return
        async with SessionLocal() as db:
            parent = await db.get(
                Chat, UUID(parent_id), options=[selectinload(Chat.user)]
            )
            if parent is None or parent.deleted_at is not None:
                self._pending.pop(parent_id, None)
                return
            pending = self._pending.pop(parent_id, set())
            starting = {
                child_id
                for child_id in pending
                if ChatStreamRuntime.has_pending_start(child_id)
                and not ChatStreamRuntime.has_active_chat(child_id)
            }
            running = starting | {
                child_id
                for child_id in pending
                if ChatStreamRuntime.has_active_chat(child_id)
            }
            if running:
                self._pending[parent_id] = running
            if starting:
                self._schedule(parent_id)
            finished = pending - running
            if not finished:
                return
            children = sorted(
                [await self._load_child(db, child_id) for child_id in finished],
                key=attrgetter("title"),
            )
        batch = children[:MAX_WAKE_CHILDREN]
        self._requeue(parent_id, children[MAX_WAKE_CHILDREN:])
        model_id = parent.last_model_id
        if model_id is None or model_id not in MODELS:
            logger.warning(
                "Parent chat %s has no usable model to wake with; dropping %d results",
                parent_id,
                len(batch),
            )
            return
        try:
            request = ChatRequest(
                prompt=self._build_prompt(batch),
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
            await ChatService(UserService()).initiate_chat_completion(
                request, parent.user, user_app_notice=self._build_notice(batch)
            )
        except ValidationError:
            self._requeue(parent_id, batch)
            raise
        except ChatException as exc:
            if exc.status_code != 409:
                raise
            self._requeue(parent_id, batch)

    def _requeue(self, parent_id: str, children: list[ChildResult]) -> None:
        if children:
            self._pending.setdefault(parent_id, set()).update(
                child.chat_id for child in children
            )

    @staticmethod
    async def _load_child(db: AsyncSession, child_id: str) -> ChildResult:
        title = await db.scalar(select(Chat.title).where(Chat.id == UUID(child_id)))
        message = await db.scalar(
            select(Message)
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
            title=title or "Untitled",
            outcome=message.stream_status.value if message else "unknown",
            response=message.content_text if message else "",
        )

    @staticmethod
    def _excerpt(text: str) -> str:
        text = text.strip()
        if len(text) <= RESULT_EXCERPT_CHARS:
            return text
        cut = text[:RESULT_EXCERPT_CHARS]
        if not text[RESULT_EXCERPT_CHARS].isspace():
            cut = re.sub(r"\s+\S*$", "", cut) or cut
        omitted = len(text) - len(cut)
        return (
            f"{cut.rstrip()}\n\n[truncated: {omitted} more characters in the "
            "sub-thread's full response]"
        )

    @classmethod
    def _build_prompt(cls, children: list[ChildResult]) -> str:
        sections = [
            f"Sub-thread: {child.title}\n"
            f"chat_id: {child.chat_id}\n"
            f"Outcome: {child.outcome}\n"
            f"Final response:\n{cls._excerpt(child.response) or '(no final response)'}"
            for child in children
        ]
        return (
            "This message was sent automatically by Agentrove, not typed by the "
            "user. These sub-threads you delegated have finished.\n\n"
            + "\n\n---\n\n".join(sections)
            + "\n\nReport each result to the user in your own words, including "
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
