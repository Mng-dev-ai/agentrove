import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from functools import partial
from typing import Any
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy import Select, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants import MODELS, REDIS_KEY_USER_STREAMS_LIVE
from app.models.db_models.channel import (
    Channel,
    ChannelDelivery,
    ChannelMember,
    ChannelMessage,
    ChannelMessageAttachment,
)
from app.models.db_models.chat import Chat, ChatCheckpoint, Message
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.channel import ChannelCreate, ChannelMessageRead
from app.models.schemas.chat import ChannelChatRequest, Message as MessageSchema
from app.models.types import MessageAttachmentDict
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import (
    AGENT_ADAPTERS,
    NORMAL_SESSION_MODE,
    NATIVE_FILE_TYPES,
)
from app.services.agent import AgentService
from app.services.git import GitService
from app.services.storage import StorageService
from app.services.chat import ChatService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException
from app.services.session_registry import session_registry
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.user import UserService
from app.utils.cache import CacheError, cache_connection
from app.utils.attachment_urls import AttachmentURL

logger = logging.getLogger(__name__)
DEBOUNCE_SECONDS = 2.5

INTRODUCTION = (
    "You are {name}, a member of a group chat channel with the user and {others}. "
    "You share the same working directory with the other members. Before editing files, "
    "say what you're about to change, and don't edit files another member is working on. "
    'You will receive new channel messages as lines of "[author]: text". '
    "After each batch, either post ONE short chat message, or reply with exactly `PASS` (nothing else). "
    "Speak only when you add something new: answering a question nobody has answered well, "
    "disagreeing, correcting, giving a concrete proposal the others missed, "
    "or when the user addresses you or everyone. Otherwise reply `PASS`. "
    "Never echo or agree just to agree. When the discussion has reached a conclusion "
    "and nothing remains for you, reply `PASS`. Your reply is either exactly `PASS` "
    "or a chat message, never both. Write like Slack: short, no headers."
)


class TurnStatus(Enum):
    RUNNING = "running"
    CANCELLED = "cancelled"
    FAILED = "failed"
    FINISHED = "finished"


def activity_version(previous: int = 0) -> int:
    return max(previous + 1, int(time.time() * 1000))


@dataclass
class MemberRetry:
    delay: float
    until: float


@dataclass
class MemberTurn:
    member: ChannelMember
    batch: list[ChannelMessage]
    source_message_id: UUID | None = None
    tool_call_ids: set[str] = field(default_factory=set)
    text: str = ""
    reset_segment: bool = False
    last_flush_at: float = 0
    flush_task: asyncio.Task[None] | None = None
    message: ChannelMessage | None = None
    status: TurnStatus = TurnStatus.RUNNING
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
    retries: dict[UUID, MemberRetry] = field(default_factory=dict)
    permissions: dict[tuple[UUID, str], dict[str, Any]] = field(default_factory=dict)
    unavailable: set[UUID] = field(default_factory=set)
    active_member_ids: list[str] = field(default_factory=list)
    activity_version: int = field(default_factory=activity_version)
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
            channel: Channel | None = await db.scalar(
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
                .order_by(Channel.updated_at.desc())
            )
            if workspace_id is not None:
                query = query.where(Channel.workspace_id == workspace_id)
            return list((await db.scalars(query)).all())

    async def create(self, user: User, data: ChannelCreate) -> Channel:
        display_names: list[str] = []
        used_names: set[str] = set()
        for item in data.members:
            model = MODELS[item.model_id]
            kind = model.agent_kind
            if (
                item.permission_mode is not None
                and item.permission_mode not in AGENT_ADAPTERS[kind].session_modes
            ):
                raise HTTPException(400, f"Invalid permission mode for {kind.value}")
            if item.display_name is not None:
                display_name = item.display_name
                if display_name.lower() in used_names:
                    raise HTTPException(400, f"Duplicate display name: {display_name}")
            else:
                name = re.sub(r"\s+", "-", model.display_name.lower())
                name = re.sub(r"[^a-z0-9.-]", "", name)
                name = re.sub(r"-+", "-", name).strip("-.")[:32]
                name = name or kind.value.lower()
                display_name = name
                number = 2
                while display_name.lower() in used_names:
                    suffix = f"-{number}"
                    display_name = f"{name[: 32 - len(suffix)]}{suffix}"
                    number += 1
            used_names.add(display_name.lower())
            display_names.append(display_name)
        async with self.session_factory() as db:
            workspace = await db.scalar(
                select(Workspace).where(
                    Workspace.id == data.workspace_id,
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            if workspace is None:
                raise HTTPException(404, "Workspace not found")
            if data.worktree and not workspace.sandbox_id:
                raise HTTPException(400, "Workspace has no sandbox")
            if data.branch and not data.worktree:
                if not workspace.sandbox_id:
                    raise HTTPException(400, "Workspace has no sandbox")
                checkout = await GitService(
                    self.chats.sandbox_for_workspace(workspace)
                ).checkout(workspace.sandbox_id, data.branch)
                if not checkout.success:
                    raise HTTPException(400, checkout.error)
            channel = Channel(
                user_id=user.id,
                workspace_id=data.workspace_id,
                name=data.name,
                worktree=data.worktree,
                branch=data.branch,
                members=[],
            )
            db.add(channel)
            await db.flush()
            for item, display_name in zip(data.members, display_names, strict=True):
                chat = Chat(
                    title=data.name,
                    user_id=user.id,
                    workspace_id=data.workspace_id,
                    channel_id=channel.id,
                    workspace=workspace,
                )
                db.add(chat)
                await db.flush()
                channel.members.append(
                    ChannelMember(
                        chat_id=chat.id,
                        model_id=item.model_id,
                        permission_mode=item.permission_mode
                        or NORMAL_SESSION_MODE[MODELS[item.model_id].agent_kind],
                        persona=item.persona,
                        thinking_mode=item.thinking_mode,
                        display_name=display_name,
                    )
                )
            await db.commit()
        self.states[channel.id] = ChannelState(channel)
        try:
            await self.prepare_worktree(channel)
        except Exception:
            await self.delete(channel)
            raise
        return channel

    async def anchor_chat(self, channel: Channel) -> Chat:
        member = min(channel.members, key=lambda member: member.chat_id)
        return await self.chats.get_chat(
            member.chat_id, User(id=channel.user_id), include_channel=True
        )

    async def prepare_worktree(self, channel: Channel) -> None:
        if not channel.worktree:
            return
        chat = await self.anchor_chat(channel)
        cwd = await AgentService(self.session_factory).ensure_worktree_cwd(
            chat, channel.branch
        )
        async with self.session_factory() as db:
            await db.execute(
                update(Chat)
                .where(Chat.channel_id == channel.id)
                .values(worktree_cwd=cwd)
            )
            await db.commit()

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

    async def activity(self, channel: Channel, message_id: UUID) -> MessageSchema:
        async with self.session_factory() as db:
            row = (
                await db.execute(
                    select(Message, ChatCheckpoint.id)
                    .join(
                        ChannelMessage, ChannelMessage.source_message_id == Message.id
                    )
                    .outerjoin(
                        ChatCheckpoint,
                        ChatCheckpoint.assistant_message_id == Message.id,
                    )
                    .options(selectinload(Message.attachments))
                    .where(
                        ChannelMessage.id == message_id,
                        ChannelMessage.channel_id == channel.id,
                        ChannelMessage.member_id.is_not(None),
                        ChannelMessage.status != "deleted",
                        Message.deleted_at.is_(None),
                    )
                )
            ).one_or_none()
            if row is None:
                raise HTTPException(404, "Message activity not found")
            message, checkpoint_id = row
            response: MessageSchema = MessageSchema.model_validate(message)
            response.checkpoint_id = checkpoint_id
            return response

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
    def member_activity(state: ChannelState) -> dict[str, Any]:
        return {
            "version": state.activity_version,
            "member_ids": state.active_member_ids,
        }

    async def publish_activity(self, state: ChannelState) -> None:
        member_ids = [
            str(turn.member.id)
            for turn in state.turns.values()
            if turn.status is TurnStatus.RUNNING
        ]
        if member_ids == state.active_member_ids:
            return
        state.active_member_ids = member_ids
        state.activity_version = activity_version(state.activity_version)
        await self.publish(
            state.channel, "channel_member_activity", self.member_activity(state)
        )

    @staticmethod
    def serialized(message: ChannelMessage) -> dict[str, Any]:
        payload: dict[str, Any] = ChannelMessageRead.model_validate(message).model_dump(
            mode="json"
        )
        return payload

    async def new_message(
        self,
        state: ChannelState,
        content: str,
        member_id: UUID | None = None,
        attachments: list[MessageAttachmentDict] | None = None,
        source_message_id: UUID | None = None,
        tool_call_count: int = 0,
    ) -> ChannelMessage:
        async with self.session_factory() as db:
            now = datetime.now(timezone.utc)
            await db.execute(
                update(Channel)
                .where(Channel.id == state.channel.id)
                .values(updated_at=now)
            )
            result = await db.execute(
                select(func.coalesce(func.max(ChannelMessage.seq), 0) + 1).where(
                    ChannelMessage.channel_id == state.channel.id
                )
            )
            seq = result.scalar_one()
            message = ChannelMessage(
                channel_id=state.channel.id,
                seq=seq,
                member_id=member_id,
                source_message_id=source_message_id,
                tool_call_count=tool_call_count,
                content=content,
                status="streaming" if member_id else "completed",
                attachments=[
                    ChannelMessageAttachment(**attachment)
                    for attachment in attachments or []
                ],
            )
            db.add(message)
            await db.flush()
            for attachment in message.attachments:
                attachment.file_url = AttachmentURL.build_preview_url(attachment.id)
            await db.commit()
            state.channel.updated_at = now
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

    def schedule(self, state: ChannelState, retry_at: float = 0) -> None:
        if state.timer is not None:
            state.timer.cancel()
            state.timer = None
        if not state.paused and not state.deleted:
            state.timer = asyncio.create_task(self.wake(state, retry_at))
            state.timer.add_done_callback(self.task_done)

    @staticmethod
    def task_done(task: asyncio.Task[None]) -> None:
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.error("Channel task failed", exc_info=error)

    async def rename(self, channel: Channel, name: str) -> Channel:
        state = self.state(channel)
        async with state.control:
            async with self.session_factory() as db:
                await db.execute(
                    update(Channel).where(Channel.id == channel.id).values(name=name)
                )
                await db.execute(
                    update(Chat).where(Chat.channel_id == channel.id).values(title=name)
                )
                await db.commit()
            state.channel.name = name
        return await self.get(channel.id, User(id=channel.user_id))

    async def post(
        self, channel: Channel, content: str, files: list[UploadFile] | None = None
    ) -> ChannelMessage:
        attachments: list[MessageAttachmentDict] = []
        if files:
            chat = await self.anchor_chat(channel)
            storage = StorageService(self.chats.sandbox_for_workspace(chat.workspace))
            kinds = [
                MODELS[member.model_id].agent_kind
                for member in channel.members
                if member.model_id in MODELS
            ]
            kind = min(
                kinds, key=lambda kind: len(NATIVE_FILE_TYPES[kind]), default=None
            )
            attachments = await storage.save_files(
                files,
                agent_kind=kind,
                sandbox_id=chat.sandbox_id,
                user_id=str(channel.user_id),
            )
        state = self.state(channel)
        async with state.control:
            turns: list[MemberTurn] = []
            try:
                async with state.lock:
                    if state.deleted:
                        raise HTTPException(404, "Channel not found")
                    state.paused = True
                    turns = list(state.turns.values())
                    await self.cancel_active(state)
                    message = await self.new_message(
                        state, content, attachments=attachments
                    )
                    await self.publish_message(channel, message)
                    self.fan_out(state)
            finally:
                try:
                    await self.cancel_turns(turns)
                finally:
                    async with state.lock:
                        state.paused = False
                        self.schedule(state)
            return message

    async def cancel_active(self, state: ChannelState) -> list[MemberTurn]:
        turns = list(state.turns.values())
        for turn in turns:
            if turn.status is not TurnStatus.FINISHED:
                turn.status = TurnStatus.CANCELLED
                await self.finish(state, turn)
            if turn.task is not None and turn.task.done():
                state.turns.pop(turn.member.id)
        await self.publish_activity(state)
        return turns

    async def cancel_turns(self, turns: list[MemberTurn]) -> None:
        await asyncio.gather(
            *(
                ChatStreamRuntime.cancel_chat_turn(str(turn.member.chat_id), timeout=10)
                for turn in turns
            )
        )

    async def wake(self, state: ChannelState, retry_at: float = 0) -> None:
        await asyncio.sleep(
            max(0, max(state.quiet_until, retry_at) - asyncio.get_running_loop().time())
        )
        async with state.lock:
            state.timer = None
            if state.paused or state.deleted:
                return
            retry_times = []
            now = asyncio.get_running_loop().time()
            for member in state.channel.members:
                if member.model_id not in MODELS:
                    if member.id not in state.unavailable:
                        logger.warning(
                            "Skipping channel member %s: unknown model %s",
                            member.id,
                            member.model_id,
                        )
                        state.unavailable.add(member.id)
                    continue
                retry = state.retries.get(member.id)
                if retry is not None and retry.until > now:
                    retry_times.append(retry.until)
                    continue
                previous = state.turns.get(member.id)
                if previous is not None and (
                    previous.status is not TurnStatus.FAILED
                    or (previous.task is not None and not previous.task.done())
                ):
                    continue
                try:
                    if previous is not None:
                        await self.finish(state, previous)
                        state.turns.pop(member.id)
                    async with self.session_factory() as db:
                        batch = list((await db.scalars(self.unseen(member))).all())
                        if not batch:
                            continue
                except Exception as exc:
                    self.backoff(state, member, exc)
                    retry_times.append(state.retries[member.id].until)
                    continue
                turn = MemberTurn(member, batch)
                state.turns[member.id] = turn
                turn.task = asyncio.create_task(self.run_turn(state, turn))
                turn.task.add_done_callback(self.task_done)
            await self.publish_activity(state)
            if retry_times:
                self.schedule(state, min(retry_times))

    def backoff(
        self, state: ChannelState, member: ChannelMember, error: object
    ) -> None:
        previous = state.retries.get(member.id)
        delay = min(previous.delay * 2, 300) if previous else 5
        state.retries[member.id] = MemberRetry(
            delay, asyncio.get_running_loop().time() + delay
        )
        logger.warning(
            "Channel member %s failed; retrying in %ss: %s", member.id, delay, error
        )

    def fail_turn(self, state: ChannelState, turn: MemberTurn, error: object) -> None:
        if turn.status not in (TurnStatus.FAILED, TurnStatus.FINISHED):
            turn.status = TurnStatus.FAILED
            self.backoff(state, turn.member, error)

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
        # Batches combine validated messages and can exceed the single-message limit.
        request = ChannelChatRequest.model_construct(
            chat_id=member.chat_id,
            model_id=member.model_id,
            prompt=self.prompt(state, turn),
            permission_mode=member.permission_mode,
            thinking_mode=member.thinking_mode,
            selected_persona_name=member.persona or DEFAULT_PERSONA_NAME,
            attachments=[
                MessageAttachmentDict(
                    file_url=attachment.file_url,
                    file_path=attachment.file_path,
                    file_type=attachment.file_type,
                    filename=attachment.filename,
                )
                for message in turn.batch
                for attachment in message.attachments
            ],
        )
        sink = partial(self.handle_event, state, turn)
        try:
            while turn.status is TurnStatus.RUNNING:
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
                if turn.status is not TurnStatus.RUNNING:
                    await ChatStreamRuntime.cancel_chat_turn(
                        str(member.chat_id), timeout=10
                    )
                await turn.provider_task
        except asyncio.CancelledError:
            if turn.status is TurnStatus.RUNNING:
                turn.status = TurnStatus.CANCELLED
            raise
        except Exception as exc:
            if turn.status is TurnStatus.RUNNING:
                self.fail_turn(state, turn, exc)
        finally:
            async with state.lock:
                try:
                    await self.finish(state, turn)
                except Exception as exc:
                    self.fail_turn(state, turn, exc)
                else:
                    state.turns.pop(member.id)
                await self.publish_activity(state)
                self.schedule(state)

    @staticmethod
    def normalized(text: str) -> str:
        wrappers = "`*\"' \t\r\n"
        return text.strip().strip(wrappers).removesuffix(".").strip().strip(wrappers)

    @classmethod
    def is_silent(cls, text: str) -> bool:
        if "PASS".startswith(cls.normalized(text).upper()):
            return True
        lines = [
            normalized
            for line in text.splitlines()
            if (normalized := cls.normalized(line))
        ]
        if not lines:
            return False
        return (
            any(line.lower() == "pass" for line in lines)
            or re.match(r"^PASS(?:\s*[—–:(,.!]|\s+-\s)", lines[0]) is not None
            or re.match(r"^pass[,.]\s", lines[0], re.IGNORECASE) is not None
            or re.search(r"(?:^|[.!?:;—–)]\s*)PASS\.?$", lines[-1]) is not None
        )

    async def text(self, state: ChannelState, turn: MemberTurn, delta: str) -> None:
        async with state.lock:
            if turn.status is not TurnStatus.RUNNING:
                return
            if turn.reset_segment:
                turn.text = ""
                turn.reset_segment = False
            turn.text += delta
            if turn.message is None and self.is_silent(turn.text):
                return
            delay = turn.last_flush_at + 0.2 - asyncio.get_running_loop().time()
            if delay <= 0:
                await self.flush(state, turn)
            elif turn.flush_task is None:
                turn.flush_task = asyncio.create_task(
                    self.flush_later(state, turn, delay)
                )
                turn.flush_task.add_done_callback(self.task_done)

    async def flush_later(
        self, state: ChannelState, turn: MemberTurn, delay: float
    ) -> None:
        await asyncio.sleep(delay)
        async with state.lock:
            turn.flush_task = None
            if turn.status is TurnStatus.RUNNING:
                await self.flush(state, turn)

    async def flush(self, state: ChannelState, turn: MemberTurn) -> None:
        if turn.message is None:
            await self.begin_speaking(state, turn)
        else:
            async with self.session_factory() as db:
                turn.message.tool_call_count = len(turn.tool_call_ids)
                await self.write_message(
                    db,
                    turn.message,
                    "" if self.is_silent(turn.text) else turn.text,
                    "streaming",
                )
                await db.commit()
            await self.publish_message(state.channel, turn.message)
        turn.last_flush_at = asyncio.get_running_loop().time()

    @staticmethod
    async def write_message(
        db: AsyncSession, message: ChannelMessage, content: str, status: str
    ) -> None:
        message.content = content
        message.status = status
        message.version += 1
        await db.execute(
            update(ChannelMessage)
            .where(ChannelMessage.id == message.id)
            .values(
                content=content,
                status=status,
                version=message.version,
                tool_call_count=message.tool_call_count,
                duration_ms=message.duration_ms,
            )
        )

    async def begin_speaking(self, state: ChannelState, turn: MemberTurn) -> None:
        turn.message = await self.new_message(
            state,
            turn.text,
            turn.member.id,
            source_message_id=turn.source_message_id,
            tool_call_count=len(turn.tool_call_ids),
        )
        await self.publish_message(state.channel, turn.message)

    async def publish_message(self, channel: Channel, message: ChannelMessage) -> None:
        await self.publish(
            channel, "channel_message", {"message": self.serialized(message)}
        )

    async def finish(self, state: ChannelState, turn: MemberTurn) -> None:
        if turn.status is TurnStatus.FINISHED:
            return
        await self.resolve_permissions(state, turn.member.id)
        successful = turn.status is TurnStatus.RUNNING
        silent = self.is_silent(turn.text)
        if turn.message is None and successful and not silent:
            await self.begin_speaking(state, turn)
        message = turn.message
        async with self.session_factory() as db:
            if successful:
                db.add_all(
                    ChannelDelivery(member_id=turn.member.id, message_id=message.id)
                    for message in turn.batch
                )
            if message is not None:
                message.tool_call_count = len(turn.tool_call_ids)
                if silent:
                    await self.write_message(db, message, "", "deleted")
                else:
                    if turn.source_message_id is not None:
                        duration_ms, created_at = (
                            await db.execute(
                                select(Message.duration_ms, Message.created_at).where(
                                    Message.id == turn.source_message_id
                                )
                            )
                        ).one()
                        message.duration_ms = (
                            duration_ms
                            if duration_ms is not None
                            else int(
                                (
                                    datetime.now(timezone.utc) - created_at
                                ).total_seconds()
                                * 1000
                            )
                        )
                    await self.write_message(
                        db,
                        message,
                        turn.text,
                        "completed" if successful else "cancelled",
                    )
                if not silent and successful:
                    now = datetime.now(timezone.utc)
                    await db.execute(
                        update(Channel)
                        .where(Channel.id == state.channel.id)
                        .values(updated_at=now)
                    )
                    state.channel.updated_at = now
            await db.commit()
        turn.status = TurnStatus.FINISHED
        if successful:
            state.retries.pop(turn.member.id, None)
        if message is not None:
            await self.publish_message(state.channel, message)
            if successful and not silent:
                self.fan_out(state)

    async def stop_state(self, state: ChannelState) -> None:
        async with state.lock:
            state.paused = True
            if state.timer is not None:
                state.timer.cancel()
                state.timer = None
            turns = await self.cancel_active(state)
            async with self.session_factory() as db:
                for member in state.channel.members:
                    batch = list((await db.scalars(self.unseen(member))).all())
                    db.add_all(
                        ChannelDelivery(member_id=member.id, message_id=message.id)
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
            if channel.worktree:
                chat = await self.anchor_chat(channel)
                if chat.worktree_cwd:
                    await GitService(
                        self.chats.sandbox_for_workspace(chat.workspace)
                    ).remove_worktree(chat.sandbox_id, chat.worktree_cwd)
            async with self.session_factory() as db:
                await db.execute(delete(Chat).where(Chat.channel_id == channel.id))
                await db.execute(delete(Channel).where(Channel.id == channel.id))
                await db.commit()
            self.states.pop(channel.id, None)

    async def recover(self) -> None:
        async with self.session_factory() as db:
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
                silent = self.is_silent(message.content)
                await self.write_message(
                    db,
                    message,
                    "" if silent else message.content,
                    "deleted" if silent else "cancelled",
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
            await self.prepare_worktree(channel)
            state = ChannelState(channel)
            self.states[channel.id] = state
            for message in messages:
                if message.channel_id == channel.id:
                    await self.publish_message(channel, message)
            self.fan_out(state)

    async def shutdown(self) -> None:
        for state in self.states.values():
            async with state.lock:
                state.paused = True
                if state.timer is not None:
                    state.timer.cancel()
                await self.cancel_active(state)
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

    async def resolve_permissions(
        self, state: ChannelState, member_id: UUID, request_id: str | None = None
    ) -> None:
        for key in list(state.permissions):
            if key[0] == member_id and (request_id is None or key[1] == request_id):
                pending = state.permissions.pop(key)
                session_registry.resolve_permission(pending["chat_id"], key[1])
                await self.publish(
                    state.channel,
                    "channel_permission_resolved",
                    {"member_id": str(member_id), "request_id": key[1]},
                )

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
        if kind == "stream_started":
            turn.source_message_id = UUID(payload["message_id"])
        elif kind == "permission_request":
            async with state.lock:
                request_id = payload["request_id"]
                if turn.status is not TurnStatus.RUNNING:
                    session_registry.resolve_permission(
                        str(turn.member.chat_id), request_id
                    )
                    return
                pending = {
                    "member_id": str(turn.member.id),
                    "chat_id": str(turn.member.chat_id),
                    "request": {
                        "request_id": request_id,
                        "tool_name": payload["tool_name"],
                        "tool_input": payload["tool_input"],
                        "options": payload["data"]["options"],
                    },
                }
                state.permissions[(turn.member.id, request_id)] = pending
                await self.publish(state.channel, "channel_permission_request", pending)
        elif kind == "permission_resolved":
            async with state.lock:
                await self.resolve_permissions(
                    state, turn.member.id, payload["request_id"]
                )
        elif kind == "assistant_text":
            await self.text(state, turn, payload["text"])
        elif kind in ("tool_started", "tool_completed", "tool_failed"):
            async with state.lock:
                if turn.status is TurnStatus.RUNNING:
                    turn.tool_call_ids.add(payload["tool"]["id"])
                    if kind == "tool_started":
                        turn.reset_segment = True
        elif kind == "error" and turn.status is TurnStatus.RUNNING:
            self.fail_turn(state, turn, payload["error"])
        elif kind == "cancelled" and turn.status is TurnStatus.RUNNING:
            turn.status = TurnStatus.CANCELLED


channel_service = ChannelService()
