import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Select, delete, func, select, update
from sqlalchemy.orm import selectinload

from app.constants import MODELS, REDIS_KEY_USER_STREAMS_LIVE
from app.models.db_models.channel import (
    Channel,
    ChannelDelivery,
    ChannelMember,
    ChannelMessage,
)
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.channel import ChannelCreate, ChannelMessageRead
from app.models.schemas.chat import ChatCreate, ChatRequest
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import DISCUSSION_SESSION_MODE
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
    "Don't narrate tool use — read files silently, then write only your final message. "
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
        for item in data.members:
            if MODELS[item.model_id].agent_kind not in DISCUSSION_SESSION_MODE:
                raise HTTPException(
                    400, f"Model {item.model_id} has no discussion-only mode"
                )
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

    @staticmethod
    def unseen(member: ChannelMember) -> Select[tuple[ChannelMessage]]:
        return (
            select(ChannelMessage)
            .where(
                ChannelMessage.channel_id == member.channel_id,
                ChannelMessage.status == "completed",
                ChannelMessage.member_id.is_(None)
                | (ChannelMessage.member_id != member.id),
                ~select(ChannelDelivery.member_id)
                .where(
                    ChannelDelivery.member_id == member.id,
                    ChannelDelivery.message_id == ChannelMessage.id,
                )
                .exists(),
            )
            .order_by(ChannelMessage.seq)
        )

    def fan_out(self, state: ChannelState) -> None:
        state.quiet_until = asyncio.get_running_loop().time() + DEBOUNCE_SECONDS
        self.schedule(state)

    def schedule(self, state: ChannelState) -> None:
        if state.timer is not None:
            state.timer.cancel()
            state.timer = None
        if not state.paused and not state.deleted:
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
                interrupted = [turn for turn in turns if not turn.finished]
                for turn in interrupted:
                    turn.cancelled = True
                    await self.finish(state, turn)
                message = await self.new_message(state, content)
                await self.publish(
                    channel,
                    "channel_message",
                    {"message": self.serialized(message)},
                )
                self.fan_out(state)
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
                if member.id in state.turns:
                    continue
                async with self.session_factory() as db:
                    batch = list((await db.scalars(self.unseen(member))).all())
                    if not batch:
                        continue
                    db.add_all(
                        ChannelDelivery(member_id=member.id, message_id=message.id)
                        for message in batch
                    )
                    await db.commit()
                turn = MemberTurn(member, batch)
                state.turns[member.id] = turn
                turn.task = asyncio.create_task(self.run_turn(state, turn))
                turn.task.add_done_callback(self.task_done)

    def prompt(self, state: ChannelState, turn: MemberTurn) -> str:
        names = {member.id: member.display_name for member in state.channel.members}
        lines = [
            f"[{names[message.member_id] if message.member_id else 'user'}]: {message.content}"
            for message in turn.batch
        ]
        if not turn.member.introduced:
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
            permission_mode=DISCUSSION_SESSION_MODE[kind],
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
                        member_turn=True,
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
                self.schedule(state)

    @staticmethod
    def normalized(text: str) -> str:
        wrappers = "`*\"' \t\r\n"
        return text.strip().strip(wrappers).removesuffix(".").strip().strip(wrappers)

    async def text(self, state: ChannelState, turn: MemberTurn, delta: str) -> None:
        async with state.lock:
            if turn.cancelled or turn.finished:
                return
            turn.text += delta
            if turn.message is None:
                segment = self.normalized(turn.text)
                if not segment or "PASS".startswith(segment):
                    return
                await self.begin_speaking(state, turn)
            else:
                await self.write_message(state, turn.message, turn.text, "streaming")

    async def write_message(
        self, state: ChannelState, message: ChannelMessage, content: str, status: str
    ) -> None:
        async with self.session_factory() as db:
            message.content = content
            message.status = status
            message.version += 1
            await db.execute(
                update(ChannelMessage)
                .where(ChannelMessage.id == message.id)
                .values(content=content, status=status, version=message.version)
            )
            await db.commit()
        await self.publish(
            state.channel, "channel_message", {"message": self.serialized(message)}
        )

    async def begin_speaking(self, state: ChannelState, turn: MemberTurn) -> None:
        turn.message = await self.new_message(state, turn.text, turn.member.id)
        await self.publish(
            state.channel, "channel_message", {"message": self.serialized(turn.message)}
        )

    async def finish(self, state: ChannelState, turn: MemberTurn) -> None:
        if turn.finished:
            return
        silent = self.normalized(turn.text) in ("", "PASS")
        if turn.message is None and not turn.cancelled and not silent:
            await self.begin_speaking(state, turn)
        message = turn.message
        async with self.session_factory() as db:
            deliveries = (
                ChannelDelivery.member_id == turn.member.id,
                ChannelDelivery.message_id.in_([item.id for item in turn.batch]),
            )
            if turn.cancelled:
                await db.execute(delete(ChannelDelivery).where(*deliveries))
            else:
                await db.execute(
                    update(ChannelDelivery).where(*deliveries).values(settled=True)
                )
            if message is not None:
                if silent:
                    await db.execute(
                        delete(ChannelMessage).where(ChannelMessage.id == message.id)
                    )
                else:
                    message.content = turn.text
                    message.status = "cancelled" if turn.cancelled else "completed"
                    message.version += 1
                    await db.execute(
                        update(ChannelMessage)
                        .where(ChannelMessage.id == message.id)
                        .values(
                            content=message.content,
                            status=message.status,
                            version=message.version,
                        )
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
        turn.finished = True
        if message is not None:
            if silent:
                await self.publish(
                    state.channel,
                    "channel_message_deleted",
                    {"message_id": str(message.id)},
                )
            else:
                await self.publish(
                    state.channel,
                    "channel_message",
                    {"message": self.serialized(message)},
                )
                if not turn.cancelled:
                    self.fan_out(state)

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
            async with self.session_factory() as db:
                for member in state.channel.members:
                    batch = list((await db.scalars(self.unseen(member))).all())
                    db.add_all(
                        ChannelDelivery(
                            member_id=member.id, message_id=message.id, settled=True
                        )
                        for message in batch
                    )
                await db.commit()
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
                delete(ChannelDelivery).where(ChannelDelivery.settled.is_(False))
            )
            messages = list(
                (
                    await db.scalars(
                        select(ChannelMessage).where(
                            ChannelMessage.status == "streaming"
                        )
                    )
                ).all()
            )
            for message in messages:
                if self.normalized(message.content) in ("", "PASS"):
                    await db.delete(message)
                else:
                    message.status = "cancelled"
                    message.version += 1
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
            for message in messages:
                if message.channel_id == channel.id:
                    if self.normalized(message.content) in ("", "PASS"):
                        await self.publish(
                            channel,
                            "channel_message_deleted",
                            {"message_id": str(message.id)},
                        )
                    else:
                        await self.publish(
                            channel,
                            "channel_message",
                            {"message": self.serialized(message)},
                        )
            self.fan_out(state)

    async def shutdown(self) -> None:
        for state in self.states.values():
            async with state.lock:
                state.paused = True
                if state.timer is not None:
                    state.timer.cancel()
                for turn in state.turns.values():
                    if not turn.finished:
                        turn.cancelled = True
                        await self.finish(state, turn)
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
        # Provider output confirms delivery; bootstrap failures must not consume the introduction.
        if not turn.member.introduced and kind in (
            "assistant_text",
            "assistant_thinking",
            "tool_started",
            "tool_completed",
            "tool_failed",
        ):
            async with self.session_factory() as db:
                await db.execute(
                    update(ChannelMember)
                    .where(ChannelMember.id == turn.member.id)
                    .values(introduced=True)
                )
                await db.commit()
            turn.member.introduced = True
        if kind == "assistant_text":
            await self.text(state, turn, payload["text"])
        elif kind in ("tool_started", "tool_completed", "tool_failed"):
            async with state.lock:
                if turn.cancelled or turn.finished:
                    return
                turn.text = ""
                if turn.message is not None:
                    await self.write_message(state, turn.message, "", "streaming")
        elif kind in ("cancelled", "error"):
            turn.cancelled = True


channel_service = ChannelService()
