import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from functools import partial
from typing import Any
from uuid import UUID, uuid4

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
from app.models.db_models.chat import (
    Chat,
    ChatCheckpoint,
    Message,
    MessageAttachment,
)
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.channel import (
    BROADCAST_MENTIONS,
    ChannelCreate,
    ChannelMemberActivity,
    ChannelMemberCreate,
    ChannelMemberRead,
    ChannelMemberUpdate,
    ChannelMessageRead,
    ChannelRead,
    ChannelUpdate,
)
from app.models.schemas.chat import (
    ChannelSearchMatch,
    ChannelSearchResult,
    ChatRequest,
    Message as MessageSchema,
)
from app.models.schemas.queue import QueuedChannelMessage
from app.models.types import MessageAttachmentDict, PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import (
    AGENT_ADAPTERS,
    NORMAL_SESSION_MODE,
    NATIVE_FILE_TYPES,
)
from app.services.agent import AgentService
from app.services.pairing import PairingService
from app.services.git import GitService
from app.services.push import PushService
from app.services.queue import ChannelQueueService
from app.services.storage import StorageService
from app.services.chat import SEARCH_MAX_ROWS, ChatService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException
from app.services.session_registry import session_registry
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChannelMemberTurn
from app.services.user import UserService
from app.utils.cache import CacheError, cache_connection
from app.utils.attachment_urls import AttachmentURL

logger = logging.getLogger(__name__)
DEBOUNCE_SECONDS = 2.5
QUEUE_RETRY_SECONDS = 5
MENTION = re.compile(r"(?:^|(?<=\s))@(\S+)")
ACTIVITY_EPOCH = uuid4().hex
REASON_LIMIT = 300
MAX_ATTEMPTS = 5
NEWCOMER_HISTORY = 20

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
ROUTING_NOTE = (
    'A line like "[author → @name]: text" is addressed only to those members; '
    "the rest see it as context. Answer a line addressed to you when it asks a question "
    "or requests action or a decision from you; reply `PASS` when it is only an "
    "acknowledgment, non-actionable status note, or closing message, even when you're "
    "named. @mention a member only when you need something from them, never to acknowledge."
)


class TurnStatus(Enum):
    RUNNING = "running"
    CANCELLED = "cancelled"
    FAILED = "failed"
    FINISHED = "finished"


@dataclass
class MemberRetry:
    delay: float
    until: float
    reason: str
    attempts: int


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
    introducing: bool = False
    provider_task: asyncio.Task[str] | None = None
    task: asyncio.Task[None] | None = None

    def started(self, task: asyncio.Task[str]) -> None:
        self.provider_task = task

    @property
    def device_ids(self) -> frozenset[UUID]:
        return frozenset().union(*(message.device_ids for message in self.batch))


@dataclass
class ChannelState:
    channel: Channel
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    control: asyncio.Lock = field(default_factory=asyncio.Lock)
    turns: dict[UUID, MemberTurn] = field(default_factory=dict)
    timer: asyncio.Task[None] | None = None
    retries: dict[UUID, MemberRetry] = field(default_factory=dict)
    gave_up: dict[UUID, str] = field(default_factory=dict)
    permissions: dict[tuple[UUID, str], dict[str, Any]] = field(default_factory=dict)
    elicitations: dict[tuple[UUID, str], dict[str, Any]] = field(default_factory=dict)
    last_reply: tuple[str, ChannelMessage] | None = None
    unavailable: set[UUID] = field(default_factory=set)
    active_member_ids: list[str] = field(default_factory=list)
    waiting_member_ids: list[str] = field(default_factory=list)
    elicitation_requests: list[dict[str, Any]] = field(default_factory=list)
    retrying_member_ids: list[str] = field(default_factory=list)
    member_errors: dict[str, str] = field(default_factory=dict)
    gave_up_members: dict[str, str] = field(default_factory=dict)
    activity_version: int = 0
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
                .options(selectinload(Channel.all_members))
            )
        if channel is None:
            raise HTTPException(404, "Channel not found")
        self.require_agent_workspace(user, channel.workspace_id)
        return channel

    async def list_channels(
        self, user: User, workspace_id: UUID | None
    ) -> list[Channel]:
        workspace_id = self.agent_workspace_filter(user, workspace_id)
        async with self.session_factory() as db:
            query = (
                select(Channel)
                .where(Channel.user_id == user.id)
                .options(selectinload(Channel.all_members))
                .order_by(Channel.updated_at.desc())
            )
            if workspace_id is not None:
                query = query.where(Channel.workspace_id == workspace_id)
            return list((await db.scalars(query)).all())

    async def search_messages(
        self,
        user: User,
        query: str,
        workspace_id: UUID | None,
        limit: int,
        per_channel_limit: int,
    ) -> tuple[list[ChannelSearchResult], bool]:
        workspace_id = self.agent_workspace_filter(user, workspace_id)
        async with self.session_factory() as db:
            stmt = (
                select(
                    ChannelMessage.id,
                    ChannelMessage.channel_id,
                    ChannelMessage.content,
                    ChannelMessage.created_at,
                    Channel.name,
                    Channel.workspace_id,
                    Workspace.name.label("workspace_name"),
                    ChannelMember.display_name,
                )
                .join(Channel, Channel.id == ChannelMessage.channel_id)
                .join(Workspace, Workspace.id == Channel.workspace_id)
                .outerjoin(ChannelMember, ChannelMember.id == ChannelMessage.member_id)
                .where(
                    Channel.user_id == user.id,
                    ChannelMessage.status != "deleted",
                    ChannelMessage.content.icontains(query, autoescape=True),
                )
                .order_by(ChannelMessage.created_at.desc())
                .limit(SEARCH_MAX_ROWS)
            )
            if workspace_id is not None:
                stmt = stmt.where(Channel.workspace_id == workspace_id)
            rows = (await db.execute(stmt)).all()

        groups, truncated = ChatService.group_search_rows(
            rows, "channel_id", limit, per_channel_limit
        )
        query_lower = query.lower()
        results = []
        for matches, match_count in groups:
            first = matches[0]
            result = ChannelSearchResult(
                channel_id=first.channel_id,
                channel_name=first.name,
                workspace_id=first.workspace_id,
                workspace_name=first.workspace_name,
                matches=[],
                match_count=match_count,
            )
            for row in matches:
                before, match_text, after = ChatService.build_snippet(
                    row.content, query_lower
                )
                result.matches.append(
                    ChannelSearchMatch(
                        message_id=row.id,
                        author=row.display_name,
                        snippet_before=before,
                        snippet_match=match_text,
                        snippet_after=after,
                        created_at=row.created_at,
                    )
                )
            results.append(result)
        return results, truncated

    async def create(self, user: User, data: ChannelCreate) -> Channel:
        self.require_agent_workspace(user, data.workspace_id)
        used_names = set(BROADCAST_MENTIONS)
        settings = [
            (
                item,
                self.permission_mode(item.model_id, item.permission_mode),
                self.member_name(item.model_id, item.display_name, used_names),
            )
            for item in data.members
        ]
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
                all_members=[],
            )
            db.add(channel)
            await db.flush()
            for item, permission_mode, display_name in settings:
                member = await self.new_member(
                    db, channel, workspace, item, permission_mode, display_name
                )
                channel.all_members.append(member)
            await db.commit()
        self.states[channel.id] = ChannelState(channel)
        try:
            await self.prepare_worktree(channel)
        except Exception:
            await self.delete(channel)
            raise
        return channel

    @staticmethod
    def permission_mode(model_id: str, mode: PermissionMode | None) -> PermissionMode:
        model = MODELS.get(model_id)
        if model is None:
            raise HTTPException(
                400, f"Unknown model {model_id}, choose a known model first"
            )
        kind = model.agent_kind
        if mode is None:
            return NORMAL_SESSION_MODE[kind]
        if mode not in AGENT_ADAPTERS[kind].session_modes:
            raise HTTPException(400, f"Invalid permission mode for {kind.value}")
        return mode

    @staticmethod
    def member_name(
        model_id: str, display_name: str | None, used_names: set[str]
    ) -> str:
        if display_name is not None:
            if display_name.lower() in used_names:
                raise HTTPException(400, f"Duplicate display name: {display_name}")
        else:
            model = MODELS[model_id]
            name = re.sub(r"\s+", "-", model.display_name.lower())
            name = re.sub(r"[^a-z0-9.-]", "", name)
            name = re.sub(r"-+", "-", name).strip("-.")[:32]
            name = name or model.agent_kind.value.lower()
            display_name = name
            number = 2
            while display_name.lower() in used_names:
                suffix = f"-{number}"
                display_name = f"{name[: 32 - len(suffix)]}{suffix}"
                number += 1
        used_names.add(display_name.lower())
        return display_name

    @staticmethod
    async def new_member(
        db: AsyncSession,
        channel: Channel,
        workspace: Workspace,
        item: ChannelMemberCreate,
        permission_mode: PermissionMode,
        display_name: str,
        chat_id: UUID | None = None,
        worktree_cwd: str | None = None,
    ) -> ChannelMember:
        chat = Chat(
            id=chat_id or uuid4(),
            title=channel.name,
            user_id=channel.user_id,
            workspace_id=channel.workspace_id,
            channel_id=channel.id,
            workspace=workspace,
            worktree_cwd=worktree_cwd,
        )
        db.add(chat)
        await db.flush()
        return ChannelMember(
            channel_id=channel.id,
            chat_id=chat.id,
            model_id=item.model_id,
            permission_mode=permission_mode,
            persona=item.persona,
            thinking_mode=item.thinking_mode,
            display_name=display_name,
        )

    @staticmethod
    def anchor_chat_id(channel: Channel) -> UUID:
        chat_id: UUID = min(member.chat_id for member in channel.all_members)
        return chat_id

    async def anchor_chat(self, channel: Channel) -> Chat:
        return await self.chats.get_chat(
            self.anchor_chat_id(channel), User(id=channel.user_id), include_channel=True
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

    async def messages(
        self,
        channel: Channel,
        after_seq: int,
        before_seq: int | None = None,
        limit: int | None = None,
    ) -> list[ChannelMessage]:
        query = select(ChannelMessage).where(
            ChannelMessage.channel_id == channel.id, ChannelMessage.seq > after_seq
        )
        if before_seq is not None:
            query = query.where(ChannelMessage.seq < before_seq)
        if limit is not None:
            query = query.order_by(ChannelMessage.seq.desc()).limit(limit)
        async with self.session_factory() as db:
            rows = list((await db.scalars(query)).all())
        return sorted(rows, key=lambda message: message.seq)

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

    def read(self, channel: Channel) -> ChannelRead:
        return ChannelRead(
            id=channel.id,
            workspace_id=channel.workspace_id,
            name=channel.name,
            worktree=channel.worktree,
            branch=channel.branch,
            created_at=channel.created_at,
            updated_at=channel.updated_at,
            unread=channel.unread,
            pinned_at=channel.pinned_at,
            members=[
                ChannelMemberRead.model_validate(member) for member in channel.members
            ],
            former_members=[
                ChannelMemberRead.model_validate(member)
                for member in channel.all_members
                if member.removed_at is not None
            ],
            anchor_chat_id=self.anchor_chat_id(channel),
            activity=ChannelMemberActivity.model_validate(
                self.member_activity(self.state(channel))
            ),
        )

    @staticmethod
    def member_activity(state: ChannelState) -> dict[str, Any]:
        return {
            "epoch": ACTIVITY_EPOCH,
            "version": state.activity_version,
            "member_ids": state.active_member_ids,
            "waiting_member_ids": state.waiting_member_ids,
            "elicitations": state.elicitation_requests,
            "retrying_member_ids": state.retrying_member_ids,
            "member_errors": state.member_errors,
            "unavailable_members": {
                str(member.id): f"Model {member.model_id} is unknown on this instance"
                for member in state.channel.members
                if member.model_id not in MODELS
            }
            | state.gave_up_members,
        }

    async def publish_activity(
        self, state: ChannelState, asked: dict[str, str] | None = None
    ) -> None:
        member_ids = [
            str(turn.member.id)
            for turn in state.turns.values()
            if turn.status is TurnStatus.RUNNING
        ]
        waiting_member_ids = list(
            dict.fromkeys(
                str(member_id)
                for member_id, _ in [*state.permissions, *state.elicitations]
            )
        )
        elicitation_requests = list(state.elicitations.values())
        retrying_member_ids = [
            str(member_id)
            for member_id in state.retries
            if str(member_id) not in member_ids
        ]
        member_errors = {
            member_id: state.retries[UUID(member_id)].reason
            for member_id in retrying_member_ids
        }
        gave_up_members = {
            str(member_id): reason for member_id, reason in state.gave_up.items()
        }
        if (
            member_ids == state.active_member_ids
            and waiting_member_ids == state.waiting_member_ids
            and elicitation_requests == state.elicitation_requests
            and retrying_member_ids == state.retrying_member_ids
            and member_errors == state.member_errors
            and gave_up_members == state.gave_up_members
        ):
            return
        state.active_member_ids = member_ids
        state.waiting_member_ids = waiting_member_ids
        state.elicitation_requests = elicitation_requests
        state.retrying_member_ids = retrying_member_ids
        state.member_errors = member_errors
        state.gave_up_members = gave_up_members
        state.activity_version += 1
        activity = self.member_activity(state)
        if asked is not None:
            activity["asked"] = asked
        await self.publish(state.channel, "channel_member_activity", activity)

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
        *,
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        async with self.session_factory() as db:
            now = datetime.now(timezone.utc)
            await db.execute(
                update(Channel)
                .where(Channel.id == state.channel.id)
                .values(
                    Channel.touched_by_user(now)
                    if member_id is None
                    else {"updated_at": now}
                )
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
                device_ids=device_ids,
                source_message_id=source_message_id,
                tool_call_count=tool_call_count,
                content=content,
                status="streaming" if member_id else "completed",
                audience=None
                if member_id
                else self.mentions(state.channel, content) or None,
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
    def mentions(
        channel: Channel, text: str, author_id: UUID | None = None
    ) -> list[str] | None:
        # None means @all/@everyone; an empty list means no member was mentioned.
        ids = {
            member.display_name.lower(): str(member.id) for member in channel.members
        }
        mentioned: set[str] = set()
        for match in MENTION.finditer(text):
            name = match[1].lower()
            while name not in ids and name[-1:] in (".", ",", ":", ";", "!", "?"):
                name = name[:-1]
            member_id = ids.get(name)
            if member_id is None and name in BROADCAST_MENTIONS:
                return None
            if member_id is not None and member_id != str(author_id):
                mentioned.add(member_id)
        return sorted(mentioned)

    @staticmethod
    def addressed(message: ChannelMessage, member: ChannelMember) -> bool:
        return message.audience is None or str(member.id) in message.audience

    def reply_audience(self, state: ChannelState, turn: MemberTurn) -> list[str] | None:
        member_id = str(turn.member.id)
        explicit = self.mentions(state.channel, turn.text, turn.member.id)
        if explicit is None or explicit:
            return explicit
        audience: set[str] = set()
        for message in turn.batch:
            if not self.addressed(message, turn.member):
                continue
            if message.audience is None:
                return None
            audience.update(message.audience)
            if message.member_id is not None:
                audience.add(str(message.member_id))
        audience.discard(member_id)
        return sorted(audience)

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

    async def unseen_batch(
        self, db: AsyncSession, channel: Channel, member: ChannelMember
    ) -> list[ChannelMessage]:
        batch = list((await db.scalars(self.unseen(member))).all())
        active = await PairingService.active_device_ids(
            db,
            channel.user_id,
            frozenset().union(*(message.device_ids for message in batch)),
        )
        revoked = [message for message in batch if not message.device_ids <= active]
        if revoked:
            db.add_all(
                ChannelDelivery(member_id=member.id, message_id=message.id)
                for message in revoked
            )
            await db.commit()
        return [message for message in batch if message.device_ids <= active]

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

    async def update(self, channel: Channel, data: ChannelUpdate) -> Channel:
        state = self.state(channel)
        async with state.control, state.lock:
            async with self.session_factory() as db:
                now = datetime.now(timezone.utc)
                values: dict[str, Any] = {"updated_at": Channel.updated_at}
                if data.pinned is not None:
                    values["pinned_at"] = (
                        func.coalesce(Channel.pinned_at, now) if data.pinned else None
                    )
                if data.name is not None:
                    values.update(name=data.name, **Channel.touched_by_user(now))
                    await db.execute(
                        update(Chat)
                        .where(Chat.channel_id == channel.id)
                        .values(title=data.name)
                    )
                await db.execute(
                    update(Channel).where(Channel.id == channel.id).values(**values)
                )
                await db.commit()
            if data.name is not None:
                state.channel.name = data.name
        return await self.get(channel.id, User(id=channel.user_id))

    @staticmethod
    def idle_member(state: ChannelState, member_id: UUID) -> ChannelMember:
        member: ChannelMember | None = next(
            (m for m in state.channel.members if m.id == member_id), None
        )
        if member is None:
            raise HTTPException(404, "Member not found")
        turn = state.turns.get(member_id)
        if turn is not None and turn.task is not None and not turn.task.done():
            raise HTTPException(
                409, f"{member.display_name} is busy, try again when it finishes"
            )
        return member

    @staticmethod
    async def reintroduce(db: AsyncSession, state: ChannelState) -> None:
        await db.execute(
            update(ChannelMember)
            .where(
                ChannelMember.channel_id == state.channel.id,
                ChannelMember.removed_at.is_(None),
            )
            .values(introduced=False)
        )
        for member in state.channel.members:
            member.introduced = False
        for turn in state.turns.values():
            turn.introducing = False

    async def add_member(self, channel: Channel, data: ChannelMemberCreate) -> Channel:
        state = self.state(channel)
        async with state.control, state.lock:
            if state.deleted:
                raise HTTPException(404, "Channel not found")
            used_names = BROADCAST_MENTIONS | {
                member.display_name.lower() for member in state.channel.all_members
            }
            permission_mode = self.permission_mode(data.model_id, data.permission_mode)
            display_name = self.member_name(
                data.model_id, data.display_name, used_names
            )
            anchor_chat_id = self.anchor_chat_id(state.channel)
            chat_id = uuid4()
            while chat_id < anchor_chat_id:
                chat_id = uuid4()
            async with self.session_factory() as db:
                member = await self.new_member(
                    db,
                    state.channel,
                    await db.get_one(Workspace, state.channel.workspace_id),
                    data,
                    permission_mode,
                    display_name,
                    chat_id,
                    await db.scalar(
                        select(Chat.worktree_cwd).where(Chat.id == anchor_chat_id)
                    ),
                )
                db.add(member)
                await db.flush()
                older = await db.scalars(
                    select(ChannelMessage.id)
                    .where(
                        ChannelMessage.channel_id == state.channel.id,
                        ChannelMessage.status == "completed",
                    )
                    .order_by(ChannelMessage.seq.desc())
                    .offset(NEWCOMER_HISTORY)
                )
                db.add_all(
                    ChannelDelivery(member_id=member.id, message_id=message_id)
                    for message_id in older
                )
                await self.reintroduce(db, state)
                await db.commit()
            state.channel.all_members.append(member)
        return await self.get(channel.id, User(id=channel.user_id))

    async def update_member(
        self, channel: Channel, member_id: UUID, data: ChannelMemberUpdate
    ) -> Channel:
        state = self.state(channel)
        async with state.control, state.lock:
            if state.deleted:
                raise HTTPException(404, "Channel not found")
            member = self.idle_member(state, member_id)
            values: dict[str, Any] = data.model_dump(
                include={"persona", "thinking_mode"}, exclude_unset=True
            )
            previous = MODELS.get(member.model_id)
            if data.model_id is not None:
                values["model_id"] = data.model_id
            if data.permission_mode is not None or (
                data.model_id is not None
                and (
                    previous is None
                    or previous.agent_kind != MODELS[data.model_id].agent_kind
                )
            ):
                values["permission_mode"] = self.permission_mode(
                    data.model_id or member.model_id, data.permission_mode
                )
            if (
                data.display_name is not None
                and data.display_name != member.display_name
            ):
                used_names = BROADCAST_MENTIONS | {
                    other.display_name.lower()
                    for other in state.channel.all_members
                    if other.id != member.id
                }
                values["display_name"] = self.member_name(
                    member.model_id, data.display_name, used_names
                )
            if values:
                async with self.session_factory() as db:
                    await db.execute(
                        update(ChannelMember)
                        .where(ChannelMember.id == member.id)
                        .values(**values)
                    )
                    if "display_name" in values:
                        await self.reintroduce(db, state)
                    await db.commit()
                for key, value in values.items():
                    setattr(member, key, value)
            state.retries.pop(member.id, None)
            state.gave_up.pop(member.id, None)
            await self.publish_activity(state)
        return await self.get(channel.id, User(id=channel.user_id))

    async def remove_member(self, channel: Channel, member_id: UUID) -> Channel:
        state = self.state(channel)
        async with state.control:
            async with state.lock:
                if state.deleted:
                    raise HTTPException(404, "Channel not found")
                member = self.idle_member(state, member_id)
                if len(state.channel.members) == 1:
                    raise HTTPException(400, "A channel needs at least one member")
                now = datetime.now(timezone.utc)
                async with self.session_factory() as db:
                    await db.execute(
                        update(ChannelMember)
                        .where(ChannelMember.id == member.id)
                        .values(removed_at=now)
                    )
                    await self.reintroduce(db, state)
                    await db.commit()
                member.removed_at = now
                state.turns.pop(member.id, None)
                state.retries.pop(member.id, None)
                state.gave_up.pop(member.id, None)
                await self.publish_activity(state)
            await session_registry.terminate(str(member.chat_id))
        return await self.get(channel.id, User(id=channel.user_id))

    async def mark_viewed(self, channel: Channel) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(Channel)
                .where(Channel.id == channel.id)
                .values(
                    last_viewed_at=datetime.now(timezone.utc),
                    updated_at=Channel.updated_at,
                )
            )
            await db.commit()

    async def save_attachments(
        self, channel: Channel, files: list[UploadFile] | None
    ) -> list[MessageAttachmentDict]:
        if not files:
            return []
        chat = await self.anchor_chat(channel)
        storage = StorageService(self.chats.sandbox_for_workspace(chat.workspace))
        kinds = [
            MODELS[member.model_id].agent_kind
            for member in channel.members
            if member.model_id in MODELS
        ]
        kind = min(kinds, key=lambda kind: len(NATIVE_FILE_TYPES[kind]), default=None)
        return await storage.save_files(
            files,
            agent_kind=kind,
            sandbox_id=chat.sandbox_id,
            user_id=str(channel.user_id),
        )

    async def send(
        self,
        state: ChannelState,
        content: str,
        attachments: list[MessageAttachmentDict],
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        message = await self.new_message(
            state, content, attachments=attachments, device_ids=device_ids
        )
        await self.publish_message(state.channel, message)
        self.fan_out(state)
        return message

    async def post(
        self,
        channel: Channel,
        content: str,
        attachments: list[MessageAttachmentDict],
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        state = self.state(channel)
        async with state.control:
            turns: list[MemberTurn] = []
            try:
                async with state.lock:
                    if state.deleted:
                        raise HTTPException(404, "Channel not found")
                    state.paused = True
                    state.last_reply = None
                    audience = self.mentions(state.channel, content) or None
                    turns = [
                        turn
                        for turn in state.turns.values()
                        if audience is None or str(turn.member.id) in audience
                    ]
                    if audience is None:
                        state.retries.clear()
                        state.gave_up.clear()
                    for member_id in audience or []:
                        state.retries.pop(UUID(member_id), None)
                        state.gave_up.pop(UUID(member_id), None)
                    await self.cancel_active(state, turns)
                    message = await self.send(state, content, attachments, device_ids)
            finally:
                try:
                    await self.cancel_turns(turns)
                finally:
                    async with state.lock:
                        state.paused = False
                        self.schedule(state)
            return message

    async def cancel_active(self, state: ChannelState, turns: list[MemberTurn]) -> None:
        for turn in turns:
            if turn.status is not TurnStatus.FINISHED:
                turn.status = TurnStatus.CANCELLED
                await self.finish(state, turn)
            if turn.task is not None and turn.task.done():
                state.turns.pop(turn.member.id)
        await self.publish_activity(state)

    async def cancel_device_turns(self, device_ids: frozenset[UUID]) -> None:
        for state in list(self.states.values()):
            async with state.lock:
                turns = [
                    turn
                    for turn in state.turns.values()
                    if turn.device_ids & device_ids
                ]
                if turns:
                    await self.cancel_active(state, turns)
            await self.cancel_turns(turns)

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
                    if member.id in state.gave_up:
                        continue
                    async with self.session_factory() as db:
                        batch = await self.unseen_batch(db, state.channel, member)
                        if not any(
                            self.addressed(message, member) for message in batch
                        ):
                            continue
                except Exception as exc:
                    if member.id not in state.gave_up:
                        self.backoff(state, member, exc)
                    if member.id in state.gave_up:
                        state.turns.pop(member.id, None)
                    else:
                        retry_times.append(state.retries[member.id].until)
                    continue
                turn = MemberTurn(member, batch, introducing=not member.introduced)
                state.turns[member.id] = turn
                turn.task = asyncio.create_task(self.run_turn(state, turn))
                turn.task.add_done_callback(self.task_done)
            await self.publish_activity(state)
            if retry_times:
                self.schedule(state, min(retry_times))
            completion = await self.settle(state)
            await self.send_next_queued(state)
        if completion is not None:
            message_id, title, body = completion
            await PushService(self.session_factory).notify_channel_completion(
                user_id=state.channel.user_id,
                channel_id=state.channel.id,
                message_id=message_id,
                title=title,
                body=body,
            )

    @staticmethod
    def idle(state: ChannelState) -> bool:
        return not (
            state.turns
            or state.retries
            or state.permissions
            or state.elicitations
            or state.timer
            or state.paused
            or state.deleted
        )

    async def send_next_queued(self, state: ChannelState) -> None:
        if not self.idle(state):
            return
        channel_id = str(state.channel.id)
        try:
            async with cache_connection() as cache:
                queue = ChannelQueueService(cache)
                item = await queue.pop_next_message(channel_id)
                if item is None:
                    return
                try:
                    queued = QueuedChannelMessage.model_validate(item)
                    message = await self.new_message(
                        state,
                        queued.content,
                        attachments=item["attachments"] or [],
                        device_ids=queued.device_ids,
                    )
                except Exception:
                    await queue.requeue_message(channel_id, item)
                    logger.warning(
                        "Failed to send queued message for channel %s",
                        channel_id,
                        exc_info=True,
                    )
                    # The channel is idle, so nothing else would wake it to retry.
                    self.schedule(
                        state, asyncio.get_running_loop().time() + QUEUE_RETRY_SECONDS
                    )
                    return
        except CacheError:
            logger.warning("Failed to read queued messages for channel %s", channel_id)
            return
        await self.publish_message(state.channel, message)
        self.fan_out(state)
        await self.publish(state.channel, "channel_queue_sent", {"id": item["id"]})

    async def settle(self, state: ChannelState) -> tuple[UUID, str, str] | None:
        if state.last_reply is None or not self.idle(state):
            return None
        author, message = state.last_reply
        state.last_reply = None
        title = f"#{state.channel.name}"
        body = f"{author}: {message.content.strip() or 'Open the channel to see the result.'}"
        state.activity_version += 1
        await self.publish(
            state.channel,
            "channel_member_activity",
            {
                **self.member_activity(state),
                "completed": {"title": title, "body": body},
            },
        )
        return message.id, title, body

    async def dispatch_queued(self, channel: Channel) -> None:
        state = self.state(channel)
        async with state.lock:
            await self.send_next_queued(state)

    async def send_queued_now(
        self,
        channel: Channel,
        queue: ChannelQueueService,
        message_id: UUID,
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        channel_id = str(channel.id)
        item = await queue.delete_message(channel_id, str(message_id))
        if item is None:
            raise HTTPException(404, "Queued message not found")
        queue.add_devices(item, device_ids)
        try:
            message = await self.post(
                channel,
                item["content"],
                item["attachments"] or [],
                QueuedChannelMessage.model_validate(item).device_ids,
            )
        except Exception:
            await queue.requeue_message(channel_id, item)
            raise
        await self.publish(channel, "channel_queue_sent", {"id": item["id"]})
        return message

    def backoff(
        self, state: ChannelState, member: ChannelMember, error: object
    ) -> None:
        previous = state.retries.pop(member.id, None)
        attempts = previous.attempts + 1 if previous else 1
        if attempts >= MAX_ATTEMPTS:
            state.gave_up[member.id] = (
                f"Gave up after {attempts} attempts: {self.reason(error)}"
            )
            logger.warning(
                "Channel member %s failed; gave up after %s attempts: %s",
                member.id,
                attempts,
                error,
            )
            return
        delay = min(previous.delay * 2, 300) if previous else 5
        state.retries[member.id] = MemberRetry(
            delay,
            asyncio.get_running_loop().time() + delay,
            self.reason(error),
            attempts,
        )
        logger.warning(
            "Channel member %s failed; retrying in %ss: %s", member.id, delay, error
        )

    @staticmethod
    def reason(error: object) -> str:
        lines = str(error).strip().splitlines()
        reason = lines[0].strip() if lines else type(error).__name__
        if len(reason) > REASON_LIMIT:
            return f"{reason[: REASON_LIMIT - 1]}…"
        return reason

    def fail_turn(self, state: ChannelState, turn: MemberTurn, error: object) -> None:
        if turn.status not in (TurnStatus.FAILED, TurnStatus.FINISHED):
            turn.status = TurnStatus.FAILED
            self.backoff(state, turn.member, error)

    def prompt(self, state: ChannelState, turn: MemberTurn) -> str:
        names = {member.id: member.display_name for member in state.channel.all_members}
        lines = [
            f"[{self.label(message, names)}]: {message.content}"
            for message in turn.batch
        ]
        if any(message.audience is not None for message in turn.batch):
            lines.insert(0, ROUTING_NOTE)
        if turn.introducing:
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

    @staticmethod
    def label(message: ChannelMessage, names: dict[UUID, str]) -> str:
        author = names[message.member_id] if message.member_id else "user"
        if message.audience is None:
            return author
        targets = [f"@{names[UUID(member_id)]}" for member_id in message.audience]
        return f"{author} → {', '.join(targets) or 'user'}"

    async def run_turn(self, state: ChannelState, turn: MemberTurn) -> None:
        member = turn.member
        # Batches combine validated messages and can exceed the single-message limit.
        request = ChatRequest.model_construct(
            chat_id=member.chat_id,
            model_id=member.model_id,
            prompt=self.prompt(state, turn),
            permission_mode=member.permission_mode,
            thinking_mode=member.thinking_mode,
            selected_persona_name=member.persona or DEFAULT_PERSONA_NAME,
        )
        attachments = [
            MessageAttachmentDict(
                file_url=attachment.file_url,
                file_path=attachment.file_path,
                file_type=attachment.file_type,
                filename=attachment.filename,
            )
            for message in turn.batch
            for attachment in message.attachments
        ]
        member_turn = ChannelMemberTurn(
            event_sink=partial(self.handle_event, state, turn),
            task_started=turn.started,
            attachments=attachments,
        )
        try:
            while turn.status is TurnStatus.RUNNING:
                try:
                    await self.chats.initiate_chat_completion(
                        request,
                        User(id=state.channel.user_id),
                        device_ids=turn.device_ids,
                        member_turn=member_turn,
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
        lines = []
        fence = ""
        for line in text.splitlines():
            if fence:
                if re.fullmatch(
                    r" {0,3}" + fence[0] + "{" + str(len(fence)) + r",}\s*", line
                ):
                    fence = ""
                continue
            if match := re.match(r"^ {0,3}(`{3,}|~{3,})", line):
                fence = match[1]
                continue
            if line.expandtabs(4).startswith("    "):
                continue
            if normalized := cls.normalized(line):
                lines.append(normalized)
        if not lines:
            return not cls.normalized(text)
        if len(lines) == 1 and "PASS".startswith(lines[0].upper()):
            return True
        return (
            any(
                line.lower() == "pass"
                or re.match(r"^PASS(?:\s*[—–:(,.!]|\s+-\s)", line) is not None
                or re.match(r"^pass[,.]\s", line, re.IGNORECASE) is not None
                for line in (lines[0], lines[-1])
            )
            or re.search(r"(?:^|[.!?;—–)]\s*)PASS\.?$", lines[-1]) is not None
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
                audience=message.audience,
            )
            .execution_options(synchronize_session=False)
        )

    async def begin_speaking(self, state: ChannelState, turn: MemberTurn) -> None:
        turn.message = await self.new_message(
            state,
            "" if self.is_silent(turn.text) else turn.text,
            turn.member.id,
            source_message_id=turn.source_message_id,
            tool_call_count=len(turn.tool_call_ids),
            device_ids=turn.device_ids,
        )
        async with self.session_factory() as db:
            await self.promote_attachments(db, turn.message)
            await db.commit()
        await self.publish_message(state.channel, turn.message)

    async def attachment_saved(self, chat: Chat, source_message_id: UUID) -> None:
        state = self.states.get(chat.channel_id) if chat.channel_id else None
        if state is None:
            return
        member = next(m for m in state.channel.members if m.chat_id == chat.id)
        async with state.lock:
            turn = state.turns.get(member.id)
            if (
                turn is None
                or turn.status is TurnStatus.FINISHED
                or turn.source_message_id != source_message_id
            ):
                await self.show_late_attachments(state, member.id, source_message_id)
            elif turn.message is None:
                await self.begin_speaking(state, turn)
            else:
                async with self.session_factory() as db:
                    promoted = await self.promote_attachments(db, turn.message)
                    await db.commit()
                if promoted and turn.status is TurnStatus.RUNNING:
                    await self.flush(state, turn)

    async def show_late_attachments(
        self, state: ChannelState, member_id: UUID, source_message_id: UUID
    ) -> None:
        async with self.session_factory() as db:
            reply = await db.scalar(
                select(ChannelMessage).where(
                    ChannelMessage.source_message_id == source_message_id
                )
            )
            stream_status = await db.scalar(
                select(Message.stream_status).where(Message.id == source_message_id)
            )
        if reply is None:
            reply = await self.new_message(
                state,
                "",
                member_id,
                source_message_id=source_message_id,
                device_ids=frozenset(),
            )
        async with self.session_factory() as db:
            await self.promote_attachments(db, reply)
            await self.write_message(
                db,
                reply,
                reply.content,
                "completed"
                if stream_status is MessageStreamStatus.COMPLETED
                else "cancelled",
            )
            await db.commit()
        await self.publish_message(state.channel, reply)

    @staticmethod
    async def promote_attachments(db: AsyncSession, message: ChannelMessage) -> bool:
        promoted = set(
            await db.scalars(
                select(ChannelMessageAttachment.file_path).where(
                    ChannelMessageAttachment.message_id == message.id
                )
            )
        )
        added = [
            ChannelMessageAttachment(
                message_id=message.id,
                file_url="",
                file_path=attachment.file_path,
                file_type=attachment.file_type.value,
                filename=attachment.filename,
            )
            for attachment in await db.scalars(
                select(MessageAttachment)
                .where(MessageAttachment.message_id == message.source_message_id)
                .order_by(MessageAttachment.created_at, MessageAttachment.id)
            )
            if attachment.file_path not in promoted
        ]
        if not added:
            return False
        db.add_all(added)
        await db.flush()
        for attachment in added:
            attachment.file_url = AttachmentURL.build_preview_url(attachment.id)
        message.attachments = [*message.attachments, *added]
        return True

    async def publish_message(self, channel: Channel, message: ChannelMessage) -> None:
        await self.publish(
            channel, "channel_message", {"message": self.serialized(message)}
        )

    async def finish(self, state: ChannelState, turn: MemberTurn) -> None:
        if turn.status is TurnStatus.FINISHED:
            return
        await self.resolve_permissions(state, turn.member.id)
        await self.resolve_elicitations(state, turn.member.id)
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
                await self.promote_attachments(db, message)
                # A PASS that attached files stays visible: the user should see them.
                silent = silent and not message.attachments
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
                    if successful:
                        message.audience = self.reply_audience(state, turn)
                    await self.write_message(
                        db,
                        message,
                        "" if self.is_silent(turn.text) else turn.text,
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
                if state.last_reply is None or message.seq > state.last_reply[1].seq:
                    state.last_reply = (turn.member.display_name, message)
                self.fan_out(state)

    async def stop_state(self, state: ChannelState) -> None:
        async with state.lock:
            state.paused = True
            if state.timer is not None:
                state.timer.cancel()
                state.timer = None
            state.retries.clear()
            state.last_reply = None
            turns = list(state.turns.values())
            await self.cancel_active(state, turns)
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
            for member in state.channel.members:
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
            await ChannelQueueService.clear_queues([str(channel.id)])
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
                await self.promote_attachments(db, message)
                silent = self.is_silent(message.content) and not message.attachments
                await self.write_message(
                    db,
                    message,
                    "" if silent else message.content,
                    "deleted" if silent else "cancelled",
                )
            await db.commit()
            orphans = (
                await db.execute(
                    select(ChannelMember.channel_id, ChannelMember.id, Message.id)
                    .join(Message, Message.chat_id == ChannelMember.chat_id)
                    .join(MessageAttachment, MessageAttachment.message_id == Message.id)
                    .outerjoin(
                        ChannelMessage, ChannelMessage.source_message_id == Message.id
                    )
                    .outerjoin(
                        ChannelMessageAttachment,
                        (ChannelMessageAttachment.message_id == ChannelMessage.id)
                        & (
                            ChannelMessageAttachment.file_path
                            == MessageAttachment.file_path
                        ),
                    )
                    .where(
                        Message.role == MessageRole.ASSISTANT,
                        ChannelMessageAttachment.id.is_(None),
                    )
                    .distinct()
                )
            ).all()
            channels = list(
                (
                    await db.scalars(
                        select(Channel).options(selectinload(Channel.all_members))
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
            for channel_id, member_id, source_message_id in orphans:
                if channel_id == channel.id:
                    await self.show_late_attachments(
                        state, member_id, source_message_id
                    )
            self.fan_out(state)

    async def shutdown(self) -> None:
        for state in self.states.values():
            async with state.lock:
                state.paused = True
                if state.timer is not None:
                    state.timer.cancel()
                await self.cancel_active(state, list(state.turns.values()))
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
        await self.publish_activity(state)

    async def resolve_elicitations(
        self, state: ChannelState, member_id: UUID, request_id: str | None = None
    ) -> None:
        for key in list(state.elicitations):
            if key[0] == member_id and (request_id is None or key[1] == request_id):
                pending = state.elicitations.pop(key)
                session_registry.resolve_elicitation(
                    pending["chat_id"], key[1], action="cancel"
                )
        await self.publish_activity(state)

    async def handle_event(
        self, state: ChannelState, turn: MemberTurn, kind: str, payload: dict[str, Any]
    ) -> None:
        # Provider output confirms delivery; bootstrap failures must not consume the introduction.
        if turn.introducing and kind in (
            "assistant_text",
            "assistant_thinking",
            "tool_started",
            "tool_completed",
            "tool_failed",
        ):
            async with state.lock:
                if turn.introducing:
                    async with self.session_factory() as db:
                        await db.execute(
                            update(ChannelMember)
                            .where(ChannelMember.id == turn.member.id)
                            .values(introduced=True)
                        )
                        await db.commit()
                    turn.member.introduced = True
                    turn.introducing = False
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
                await self.publish_activity(state)
            await PushService(self.session_factory).notify_permission(
                user_id=state.channel.user_id,
                path=f"/channels/{state.channel.id}",
                request_id=request_id,
                tool_name=payload["tool_name"],
            )
        elif kind == "permission_resolved":
            async with state.lock:
                await self.resolve_permissions(
                    state, turn.member.id, payload["request_id"]
                )
        elif kind == "elicitation_request":
            async with state.lock:
                request_id = payload["request_id"]
                if turn.status is not TurnStatus.RUNNING:
                    session_registry.resolve_elicitation(
                        str(turn.member.chat_id), request_id, action="decline"
                    )
                    return
                state.elicitations[(turn.member.id, request_id)] = {
                    "member_id": str(turn.member.id),
                    "chat_id": str(turn.member.chat_id),
                    "request": {"request_id": request_id, **payload["data"]},
                }
                asked = {
                    "title": f"#{state.channel.name}",
                    "body": f"{turn.member.display_name} asks: {payload['data']['message']}",
                }
                await self.publish_activity(state, asked)
            await PushService(self.session_factory).notify_question(
                user_id=state.channel.user_id,
                path=f"/channels/{state.channel.id}",
                request_id=f"{turn.source_message_id}:{request_id}",
                title=asked["title"],
                body=asked["body"],
            )
        elif kind == "elicitation_resolved":
            async with state.lock:
                await self.resolve_elicitations(
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
