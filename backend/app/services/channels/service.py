import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.catalog import MODELS
from app.models.db_models.channel import (
    Channel,
    ChannelDelivery,
    ChannelMember,
    ChannelMessage,
)
from app.models.db_models.chat import Chat, ChatCheckpoint, Message
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.channel import (
    BROADCAST_MENTIONS,
    ChannelCreate,
    ChannelMemberActivity,
    ChannelMemberCreate,
    ChannelMemberRead,
    ChannelMemberUpdate,
    ChannelRead,
    ChannelUpdate,
)
from app.models.schemas.chat import (
    ChannelSearchMatch,
    ChannelSearchResult,
    Message as MessageSchema,
)
from app.models.types import MessageAttachmentDict, PermissionMode
from app.services.acp.adapters import (
    AGENT_ADAPTERS,
    NATIVE_FILE_TYPES,
    UNSPECIFIED_PERMISSION_MODE,
)
from app.services.agent import AgentService
from app.services.channels.engine import ChannelEngine, channel_engine
from app.services.channels.state import ChannelState
from app.services.git import GitService
from app.services.queue import ChannelQueueService
from app.services.storage import StorageService
from app.services.chat import SEARCH_MAX_ROWS, ChatService
from app.services.db import BaseDbService
from app.services.session_registry import session_registry

NEWCOMER_HISTORY = 20


class ChannelService(BaseDbService[Channel]):
    def __init__(self, engine: ChannelEngine) -> None:
        super().__init__(engine.session_factory)
        self.engine = engine
        self.chats = engine.chats

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
        settings = self.member_settings(data.members)
        async with self.session_factory() as db:
            workspace = await self._live_workspace(db, data.workspace_id, user.id)
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
        async with self.write_session() as db:
            # The checkout ran without the write lock, so the workspace may have
            # been deleted since the first read.
            workspace = await self._live_workspace(db, data.workspace_id, user.id)
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
            # Registered before the commit: a committed channel always has a state.
            self.engine.register(channel)
            state = self.engine.state(channel)
            try:
                await db.commit()
            except Exception:
                self.engine.drop(channel)
                raise
        async with state.control:
            if state.deleted:
                raise HTTPException(404, "Channel not found")
            try:
                await self.prepare_worktree(channel)
            except Exception:
                await self._delete_locked(state)
                raise
        return channel

    @staticmethod
    async def _live_workspace(
        db: AsyncSession, workspace_id: UUID, user_id: UUID
    ) -> Workspace:
        workspace: Workspace | None = await db.scalar(
            select(Workspace).where(
                Workspace.id == workspace_id,
                Workspace.user_id == user_id,
                Workspace.deleted_at.is_(None),
            )
        )
        if workspace is None:
            raise HTTPException(404, "Workspace not found")
        return workspace

    @classmethod
    def member_settings(
        cls, members: list[ChannelMemberCreate]
    ) -> list[tuple[ChannelMemberCreate, PermissionMode, str]]:
        used_names = set(BROADCAST_MENTIONS)
        return [
            (
                item,
                cls.permission_mode(item.model_id, item.permission_mode),
                cls.member_name(item.model_id, item.display_name, used_names),
            )
            for item in members
        ]

    @staticmethod
    def permission_mode(model_id: str, mode: PermissionMode | None) -> PermissionMode:
        model = MODELS.get(model_id)
        if model is None:
            raise HTTPException(
                400, f"Unknown model {model_id}, choose a known model first"
            )
        kind = model.agent_kind
        if mode is None:
            return UNSPECIFIED_PERMISSION_MODE[kind]
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
                self.engine.state(channel).member_activity()
            ),
        )

    async def update(self, channel: Channel, data: ChannelUpdate) -> Channel:
        state = self.engine.state(channel)
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
        if ChannelEngine.member_busy(state, member_id):
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
        ChannelEngine.clear_introducing(state)

    async def add_member(self, channel: Channel, data: ChannelMemberCreate) -> Channel:
        state = self.engine.state(channel)
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
        state = self.engine.state(channel)
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
            self.engine.reset_member(state, member.id)
            await self.engine.publisher.publish_activity(state)
        return await self.get(channel.id, User(id=channel.user_id))

    async def remove_member(self, channel: Channel, member_id: UUID) -> Channel:
        state = self.engine.state(channel)
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
                self.engine.forget_member(state, member.id)
                await self.engine.publisher.publish_activity(state)
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

    async def delete(self, channel: Channel) -> None:
        state = self.engine.state(channel)
        async with state.control:
            # Whoever held control before us may already have deleted it.
            if self.engine.states.get(channel.id) is state:
                await self._delete_locked(state)

    async def _delete_locked(self, state: ChannelState) -> None:
        channel = state.channel
        await self.engine.teardown(state)
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
        self.engine.drop(channel)

    async def recover(self) -> None:
        messages, orphans, channels = await self.engine.recover_messages()
        for channel in channels:
            await self.prepare_worktree(channel)
            await self.engine.resume(channel, messages, orphans)


channel_service = ChannelService(channel_engine)
