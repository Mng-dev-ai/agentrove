import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import selectinload

from app.constants import MODELS, REDIS_KEY_USER_STREAMS_LIVE
from app.models.db_models.channel import Channel, ChannelMember, ChannelMessage
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.channel import ChannelCreate, ChannelMessageRead
from app.models.schemas.chat import ChatCreate, ChatRequest
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import AgentKind, NORMAL_SESSION_MODE
from app.services.chat import ChatService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException
from app.services.session_registry import session_registry
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.user import UserService
from app.utils.cache import CacheError, cache_connection

logger = logging.getLogger(__name__)
DEBOUNCE_SECONDS = 2.5

INTRODUCTION = (
    "You are {name}, a member of a group chat channel with the user and {others}. "
    "This channel is for discussion only: you may read files in the repository to inform your answers, "
    "but never modify files or run commands that change anything. "
    'You will receive new channel messages as lines of "[author]: text". '
    "After each batch, either post ONE short chat message, or reply with exactly `PASS` (nothing else). "
    "Speak only when you add something new: answering a question nobody has answered well, "
    "disagreeing, correcting, giving a concrete proposal the others missed, "
    "or when the user addresses you or everyone. Otherwise reply `PASS`. "
    "Never echo or agree just to agree. When the discussion has reached a conclusion "
    "and nothing remains for you, reply `PASS`. Your reply is either exactly `PASS` "
    "or a chat message, never both. Write like Slack: short, no headers."
)


@dataclass
class MemberTurn:
    member: ChannelMember
    batch: list[ChannelMessage]
    previous_seen: int
    text: str = ""
    message: ChannelMessage | None = None
    cancelled: bool = False
    finished: bool = False
    provider_task: asyncio.Task[str] | None = None
    task: asyncio.Task[None] | None = None

    def started(self, task: asyncio.Task[str]) -> None:
        self.provider_task = task


@dataclass
class ChannelState:
    channel: Channel
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    control: asyncio.Lock = field(default_factory=asyncio.Lock)
    pending: dict[UUID, list[ChannelMessage]] = field(default_factory=dict)
    turns: dict[UUID, MemberTurn] = field(default_factory=dict)
    timer: asyncio.Task[None] | None = None
    quiet_until: float = 0
    paused: bool = False
    deleted: bool = False


class ChannelService(BaseDbService[Channel]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)
        self.chats = ChatService(
            UserService(self.session_factory), self.session_factory
        )
        self.states: dict[UUID, ChannelState] = {}

    async def get(self, channel_id: UUID, user: User) -> Channel:
        async with self.session_factory() as db:
            channel = await db.scalar(
                select(Channel)
                .where(Channel.id == channel_id, Channel.user_id == user.id)
                .options(selectinload(Channel.members))
            )
        if channel is None:
            raise HTTPException(404, "Channel not found")
        return channel

    async def list_channels(
        self, user: User, workspace_id: UUID | None
    ) -> list[Channel]:
        async with self.session_factory() as db:
            query = (
                select(Channel)
                .where(Channel.user_id == user.id)
                .options(selectinload(Channel.members))
                .order_by(Channel.last_activity_at.desc())
            )
            if workspace_id is not None:
                query = query.where(Channel.workspace_id == workspace_id)
            return list((await db.scalars(query)).all())

    async def create(self, user: User, data: ChannelCreate) -> Channel:
        async with self.session_factory() as db:
            workspace = await db.scalar(
                select(Workspace.id).where(
                    Workspace.id == data.workspace_id,
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            if workspace is None:
                raise HTTPException(404, "Workspace not found")
            channel = Channel(
                user_id=user.id,
                workspace_id=data.workspace_id,
                name=data.name,
                members=[],
            )
            db.add(channel)
            await db.flush()
            counts: dict[str, int] = {}
            for item in data.members:
                name = MODELS[item.model_id].agent_kind.value.lower()
                counts[name] = counts.get(name, 0) + 1
                display_name = name if counts[name] == 1 else f"{name}-{counts[name]}"
                chat = await self.chats.create_chat(
                    user,
                    ChatCreate(
                        title=data.name,
                        workspace_id=data.workspace_id,
                        model_id=item.model_id,
                    ),
                    channel_id=channel.id,
                    session=db,
                )
                channel.members.append(
                    ChannelMember(
                        chat_id=chat.id,
                        model_id=item.model_id,
                        persona=item.persona,
                        thinking_mode=item.thinking_mode,
                        display_name=display_name,
                    )
                )
            await db.commit()
        self.states[channel.id] = ChannelState(channel)
        return channel

    async def messages(self, channel: Channel, after_seq: int) -> list[ChannelMessage]:
        async with self.session_factory() as db:
            return list(
                (
                    await db.scalars(
                        select(ChannelMessage)
                        .where(
                            ChannelMessage.channel_id == channel.id,
                            ChannelMessage.seq > after_seq,
                        )
                        .order_by(ChannelMessage.seq)
                    )
                ).all()
            )

    def state(self, channel: Channel) -> ChannelState:
        state = self.states.get(channel.id)
        if state is None:
            raise HTTPException(404, "Channel not found")
        return state

    async def publish(
        self, channel: Channel, kind: str, payload: dict[str, Any]
    ) -> None:
        try:
            async with cache_connection() as cache:
                await cache.publish(
                    REDIS_KEY_USER_STREAMS_LIVE.format(user_id=channel.user_id),
                    json.dumps(
                        {"channelId": str(channel.id), "kind": kind, "payload": payload}
                    ),
                )
        except CacheError:
            logger.warning("Failed to publish channel event for %s", channel.id)

    @staticmethod
    def serialized(message: ChannelMessage) -> dict[str, Any]:
        return ChannelMessageRead.model_validate(message).model_dump(mode="json")

    async def new_message(
        self, state: ChannelState, content: str, member_id: UUID | None = None
    ) -> ChannelMessage:
        async with self.session_factory() as db:
            seq = (
                await db.scalar(
                    select(func.max(ChannelMessage.seq)).where(
                        ChannelMessage.channel_id == state.channel.id
                    )
                )
                or 0
            ) + 1
            message = ChannelMessage(
                channel_id=state.channel.id,
                seq=seq,
                author_type="agent" if member_id else "user",
                member_id=member_id,
                content=content,
                status="streaming" if member_id else "completed",
            )
            db.add(message)
            now = datetime.now(timezone.utc)
            await db.execute(
                update(Channel)
                .where(Channel.id == state.channel.id)
                .values(last_activity_at=now)
            )
            await db.commit()
            state.channel.last_activity_at = now
        return message

    def fan_out(self, state: ChannelState, message: ChannelMessage) -> None:
        for member in state.channel.members:
            if member.id != message.member_id:
                state.pending.setdefault(member.id, []).append(message)
        state.quiet_until = asyncio.get_running_loop().time() + DEBOUNCE_SECONDS
        self.schedule(state)

    def schedule(self, state: ChannelState) -> None:
        if state.timer is not None:
            state.timer.cancel()
            state.timer = None
        if not state.paused and not state.deleted and any(state.pending.values()):
            state.timer = asyncio.create_task(self.wake(state))
            state.timer.add_done_callback(self.task_done)

    @staticmethod
    def task_done(task: asyncio.Task[None]) -> None:
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.error("Channel task failed", exc_info=error)

    async def post(self, channel: Channel, content: str) -> ChannelMessage:
        state = self.state(channel)
        async with state.control:
            async with state.lock:
                if state.deleted:
                    raise HTTPException(404, "Channel not found")
                state.paused = True
                turns = list(state.turns.values())
                interrupted = [turn for turn in turns if not turn.cancelled]
                for turn in interrupted:
                    turn.cancelled = True
                    await self.finish(state, turn)
                    state.pending.setdefault(turn.member.id, [])[:0] = turn.batch
                async with self.session_factory() as db:
                    for turn in interrupted:
                        turn.member.last_seen_seq = turn.previous_seen
                        await db.execute(
                            update(ChannelMember)
                            .where(ChannelMember.id == turn.member.id)
                            .values(last_seen_seq=turn.previous_seen)
                        )
                    await db.commit()
                message = await self.new_message(state, content)
                await self.publish(
                    channel,
                    "channel_message_created",
                    {"message": self.serialized(message)},
                )
                self.fan_out(state, message)
            try:
                await self.cancel_turns(turns)
            finally:
                async with state.lock:
                    state.paused = False
                    self.schedule(state)
            return message

    async def cancel_turns(self, turns: list[MemberTurn]) -> None:
        await asyncio.gather(
            *(
                ChatStreamRuntime.cancel_chat_turn(str(turn.member.chat_id), timeout=10)
                for turn in turns
            )
        )

    async def wake(self, state: ChannelState) -> None:
        await asyncio.sleep(
            max(0, state.quiet_until - asyncio.get_running_loop().time())
        )
        async with state.lock:
            state.timer = None
            if state.paused or state.deleted:
                return
            for member in state.channel.members:
                batch = state.pending.get(member.id, [])
                if not batch or member.id in state.turns:
                    continue
                turn = MemberTurn(member, batch, member.last_seen_seq)
                async with self.session_factory() as db:
                    last_seen_seq = max(
                        member.last_seen_seq, max(message.seq for message in batch)
                    )
                    await db.execute(
                        update(ChannelMember)
                        .where(ChannelMember.id == member.id)
                        .values(last_seen_seq=last_seen_seq)
                    )
                    await db.commit()
                    member.last_seen_seq = last_seen_seq
                state.pending[member.id] = []
                state.turns[member.id] = turn
                turn.task = asyncio.create_task(self.run_turn(state, turn))
                turn.task.add_done_callback(self.task_done)

    def prompt(self, state: ChannelState, turn: MemberTurn) -> str:
        names = {member.id: member.display_name for member in state.channel.members}
        lines = [
            f"[{names[message.member_id] if message.member_id else 'user'}]: {message.content}"
            for message in turn.batch
        ]
        if turn.previous_seen == 0:
            others = (
                ", ".join(
                    member.display_name
                    for member in state.channel.members
                    if member.id != turn.member.id
                )
                or "no other agents"
            )
            lines.insert(
                0, INTRODUCTION.format(name=turn.member.display_name, others=others)
            )
        return "\n".join(lines)

    async def run_turn(self, state: ChannelState, turn: MemberTurn) -> None:
        member = turn.member
        kind = MODELS[member.model_id].agent_kind
        # Batches combine validated messages and can exceed the single-message limit.
        request = ChatRequest.model_construct(
            chat_id=member.chat_id,
            model_id=member.model_id,
            prompt=self.prompt(state, turn),
            permission_mode="read-only"
            if kind == AgentKind.CODEX
            else NORMAL_SESSION_MODE[kind],
            thinking_mode=member.thinking_mode,
            selected_persona_name=member.persona or DEFAULT_PERSONA_NAME,
        )
        sink = partial(self.handle_event, state, turn)
        try:
            while not turn.cancelled:
                try:
                    await self.chats.initiate_chat_completion(
                        request,
                        User(id=state.channel.user_id),
                        event_sink=sink,
                        task_started=turn.started,
                    )
                    break
                except ChatException as exc:
                    if exc.status_code != 409:
                        raise
                    await asyncio.sleep(0.1)
            if turn.provider_task is not None:
                if turn.cancelled:
                    await ChatStreamRuntime.cancel_chat_turn(
                        str(member.chat_id), timeout=10
                    )
                await turn.provider_task
        except BaseException:
            turn.cancelled = True
            raise
        finally:
            async with state.lock:
                await self.finish(state, turn)
                state.turns.pop(member.id)
                if state.pending.get(member.id):
                    self.schedule(state)

    async def text(self, state: ChannelState, turn: MemberTurn, delta: str) -> None:
        async with state.lock:
            if turn.cancelled:
                return
            turn.text += delta
            if turn.message is None:
                if "PASS".startswith(turn.text.strip()):
                    return
                await self.begin_speaking(state, turn)
            else:
                async with self.session_factory() as db:
                    await db.execute(
                        update(ChannelMessage)
                        .where(ChannelMessage.id == turn.message.id)
                        .values(content=turn.text)
                    )
                    await db.commit()
                await self.publish(
                    state.channel,
                    "channel_message_delta",
                    {"message_id": str(turn.message.id), "delta": delta},
                )

    async def begin_speaking(self, state: ChannelState, turn: MemberTurn) -> None:
        turn.message = await self.new_message(state, "", turn.member.id)
        await self.publish(
            state.channel,
            "member_typing",
            {"member_id": str(turn.member.id), "typing": True},
        )
        await self.publish(
            state.channel,
            "channel_message_created",
            {"message": self.serialized(turn.message)},
        )
        async with self.session_factory() as db:
            await db.execute(
                update(ChannelMessage)
                .where(ChannelMessage.id == turn.message.id)
                .values(content=turn.text)
            )
            await db.commit()
        await self.publish(
            state.channel,
            "channel_message_delta",
            {"message_id": str(turn.message.id), "delta": turn.text},
        )

    async def finish(self, state: ChannelState, turn: MemberTurn) -> None:
        if turn.finished:
            return
        if (
            turn.message is None
            and not turn.cancelled
            and turn.text.strip() not in ("", "PASS")
        ):
            await self.begin_speaking(state, turn)
        message = turn.message
        if message is None:
            turn.finished = True
            return
        message.content = turn.text
        message.status = "cancelled" if turn.cancelled else "completed"
        async with self.session_factory() as db:
            await db.execute(
                update(ChannelMessage)
                .where(ChannelMessage.id == message.id)
                .values(content=message.content, status=message.status)
            )
            if not turn.cancelled:
                now = datetime.now(timezone.utc)
                await db.execute(
                    update(Channel)
                    .where(Channel.id == state.channel.id)
                    .values(last_activity_at=now)
                )
                state.channel.last_activity_at = now
            await db.commit()
        if turn.cancelled:
            await self.publish(
                state.channel,
                "channel_message_cancelled",
                {"message_id": str(message.id)},
            )
        else:
            await self.publish(
                state.channel,
                "channel_message_completed",
                {"message": self.serialized(message)},
            )
        await self.publish(
            state.channel,
            "member_typing",
            {"member_id": str(turn.member.id), "typing": False},
        )
        if not turn.cancelled:
            self.fan_out(state, message)
        turn.finished = True

    async def stop_state(self, state: ChannelState) -> None:
        async with state.lock:
            state.paused = True
            if state.timer is not None:
                state.timer.cancel()
                state.timer = None
            turns = list(state.turns.values())
            for turn in turns:
                turn.cancelled = True
                await self.finish(state, turn)
            state.pending.clear()
            async with self.session_factory() as db:
                latest = (
                    await db.scalar(
                        select(func.max(ChannelMessage.seq)).where(
                            ChannelMessage.channel_id == state.channel.id
                        )
                    )
                    or 0
                )
                await db.execute(
                    update(ChannelMember)
                    .where(ChannelMember.channel_id == state.channel.id)
                    .values(last_seen_seq=latest)
                )
                await db.commit()
            for member in state.channel.members:
                member.last_seen_seq = latest
        await self.cancel_turns(turns)

    async def stop(self, channel: Channel) -> None:
        state = self.state(channel)
        async with state.control:
            try:
                await self.stop_state(state)
            finally:
                state.paused = False

    async def delete(self, channel: Channel) -> None:
        state = self.state(channel)
        async with state.control:
            state.deleted = True
            await self.stop_state(state)
            tasks = [
                turn.task for turn in state.turns.values() if turn.task is not None
            ]
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            for member in channel.members:
                await session_registry.terminate(str(member.chat_id))
            async with self.session_factory() as db:
                await db.execute(delete(Chat).where(Chat.channel_id == channel.id))
                await db.execute(delete(Channel).where(Channel.id == channel.id))
                await db.commit()
            self.states.pop(channel.id, None)

    async def recover(self) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(ChannelMessage)
                .where(ChannelMessage.status == "streaming")
                .values(status="cancelled")
            )
            await db.commit()
            channels = list(
                (
                    await db.scalars(
                        select(Channel).options(selectinload(Channel.members))
                    )
                ).all()
            )
            for channel in channels:
                state = ChannelState(channel)
                self.states[channel.id] = state
                for member in channel.members:
                    state.pending[member.id] = list(
                        (
                            await db.scalars(
                                select(ChannelMessage)
                                .where(
                                    ChannelMessage.channel_id == channel.id,
                                    ChannelMessage.seq > member.last_seen_seq,
                                    ChannelMessage.status == "completed",
                                    (
                                        ChannelMessage.member_id.is_(None)
                                        | (ChannelMessage.member_id != member.id)
                                    ),
                                )
                                .order_by(ChannelMessage.seq)
                            )
                        ).all()
                    )
                state.quiet_until = asyncio.get_running_loop().time() + DEBOUNCE_SECONDS
                self.schedule(state)

    async def shutdown(self) -> None:
        for state in self.states.values():
            state.paused = True
            if state.timer is not None:
                state.timer.cancel()
            for turn in state.turns.values():
                turn.cancelled = True
        await asyncio.gather(
            *(
                self.cancel_turns(list(state.turns.values()))
                for state in self.states.values()
            )
        )
        tasks = [
            turn.task
            for state in self.states.values()
            for turn in state.turns.values()
            if turn.task is not None
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def handle_event(
        self, state: ChannelState, turn: MemberTurn, kind: str, payload: dict[str, Any]
    ) -> None:
        if kind == "assistant_text":
            await self.text(state, turn, payload["text"])
        elif kind in ("cancelled", "error"):
            turn.cancelled = True


channel_service = ChannelService()
