from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants import MODELS
from app.models.db_models.chat import Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.types import AgentKind
from app.services.db import SessionFactoryType
from app.services.streaming.types import PROMPT_SUGGESTIONS_RE

# ~4 chars per token, so this spends about a quarter of the target window.
HANDOFF_CHARS_PER_WINDOW_TOKEN = 1
DEFAULT_HANDOFF_MAX_CHARS = 200_000


@dataclass(frozen=True)
class Handoff:
    resume_session_id: str | None
    transcript: str | None


class HandoffService:
    """Lets any agent kind pick up a chat other agent kinds have been running.

    Each kind resumes its own native session from its latest settled assistant
    message; turns other kinds ran since then are replayed as a transcript.
    """

    def __init__(self, session_factory: SessionFactoryType) -> None:
        self.session_factory = session_factory

    async def build(
        self,
        *,
        chat_id: UUID,
        model_id: str,
        assistant_message_id: UUID,
        resume: bool = True,
    ) -> Handoff:
        agent_kind = MODELS[model_id].agent_kind
        async with self.session_factory() as db:
            current = await db.get(Message, assistant_message_id)
            assert current is not None
            anchor = (
                await self._latest_settled_turn(db, chat_id, agent_kind, current)
                if resume
                else None
            )
            history_query = (
                select(Message)
                .options(selectinload(Message.attachments))
                .where(
                    Message.chat_id == chat_id,
                    Message.deleted_at.is_(None),
                    Message.created_at < current.created_at,
                )
                .order_by(Message.created_at)
            )
            if anchor is not None:
                history_query = history_query.where(
                    Message.created_at > anchor.created_at
                )
            history = list((await db.execute(history_query)).scalars())

        # The trailing user message is this turn's own prompt.
        if history and history[-1].role == MessageRole.USER:
            history.pop()

        turns = self._other_kind_turns(history, agent_kind) if anchor else history
        return Handoff(
            resume_session_id=anchor.session_id if anchor else None,
            transcript=self._render(turns, MODELS[model_id].context_window),
        )

    @classmethod
    async def _latest_settled_turn(
        cls,
        db: AsyncSession,
        chat_id: UUID,
        agent_kind: AgentKind,
        current: Message,
    ) -> Message | None:
        result = await db.execute(
            select(Message)
            .where(
                Message.chat_id == chat_id,
                Message.role == MessageRole.ASSISTANT,
                Message.deleted_at.is_(None),
                Message.session_id.is_not(None),
                # A cancel before any reply may never have reached the agent.
                or_(
                    Message.stream_status == MessageStreamStatus.COMPLETED,
                    and_(
                        Message.stream_status == MessageStreamStatus.INTERRUPTED,
                        Message.content_text != "",
                    ),
                ),
                Message.model_id.in_(cls._model_ids(agent_kind)),
                Message.created_at < current.created_at,
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        return cast(Message | None, result.scalar_one_or_none())

    @staticmethod
    def _model_ids(agent_kind: AgentKind) -> list[str]:
        return [
            model_id
            for model_id, info in MODELS.items()
            if info.agent_kind is agent_kind
        ]

    @staticmethod
    def _other_kind_turns(
        history: list[Message], agent_kind: AgentKind
    ) -> list[Message]:
        # Same-kind turns after the anchor never settled; the native session
        # already holds whatever they got through, as before handoff existed.
        kept: list[Message] = []
        pending_user: list[Message] = []
        for message in history:
            if message.role == MessageRole.USER:
                pending_user.append(message)
                continue
            info = MODELS.get(message.model_id or "")
            if info is None or info.agent_kind is not agent_kind:
                kept.extend(pending_user)
                kept.append(message)
            pending_user = []
        return kept + pending_user

    @classmethod
    def _render(cls, messages: list[Message], context_window: int | None) -> str | None:
        blocks = [block for block in map(cls._render_message, messages) if block]
        if not blocks:
            return None
        budget = (
            context_window * HANDOFF_CHARS_PER_WINDOW_TOKEN
            if context_window
            else DEFAULT_HANDOFF_MAX_CHARS
        )
        kept: list[str] = []
        used = 0
        for block in reversed(blocks):
            if used + len(block) > budget:
                if not kept:
                    kept.append(block[-budget:])
                break
            kept.append(block)
            used += len(block)
        omitted = len(blocks) - len(kept)
        body = "\n\n".join(reversed(kept))
        if omitted:
            body = f"[{omitted} earlier messages omitted]\n\n{body}"
        return (
            "<previous_conversation>\n"
            "Earlier turns of this chat ran on a different agent. They are "
            "history for context only — do not redo their tool calls; the "
            "workspace already reflects their changes.\n\n"
            f"{body}\n"
            "</previous_conversation>"
        )

    @classmethod
    def _render_message(cls, message: Message) -> str:
        if message.role == MessageRole.USER:
            lines = [f"[user]: {message.content_text}"]
            lines.extend(
                f"[attachment: {attachment.filename or attachment.file_path}]"
                for attachment in message.attachments
            )
            return "\n".join(lines)
        info = MODELS.get(message.model_id or "")
        label = info.display_name if info else message.model_id or "assistant"
        parts = [
            part
            for event in message.content_render.get("events", [])
            if (part := cls._render_event(event))
        ]
        if not parts:
            return ""
        return f"[assistant ({label})]: " + "\n".join(parts)

    @staticmethod
    def _render_event(event: dict[str, Any]) -> str:
        kind = event.get("type")
        if kind in ("assistant_text", "app_notice"):
            text = str(event.get("text") or "")
            return PROMPT_SUGGESTIONS_RE.sub("", text).strip()
        if kind in ("tool_completed", "tool_failed"):
            tool = event.get("tool") or {}
            title = tool.get("title") or tool.get("name") or "tool"
            outcome = "failed" if kind == "tool_failed" else "completed"
            return f"[tool {title}: {outcome}]"
        return ""
