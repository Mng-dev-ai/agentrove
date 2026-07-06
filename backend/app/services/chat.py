import asyncio
import json
import logging
import math
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import exists, func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import aliased, selectinload

from app.constants import (
    MODELS,
    REDIS_KEY_CHAT_STREAM_LIVE,
    REDIS_KEY_USER_CHATS_LIVE,
)
from app.models.db_models.chat import Chat, ChatCheckpoint, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus, StreamEventKind
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.chat import Chat as ChatSchema
from app.models.schemas.chat import (
    ActiveStreamStatus,
    ChatCreate,
    ChatRequest,
    ChatSearchMatch,
    ChatSearchResponse,
    ChatSearchResult,
    ChatUpdate,
)
from app.models.schemas.chat import Message as MessageSchema
from app.models.schemas.sandbox import (
    GitCommandResponse,
)
from app.models.schemas.pagination import (
    CursorPaginatedResponse,
    PaginatedResponse,
    PaginationParams,
)
from app.models.types import ChatCompletionResult, MessageAttachmentDict, PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME, build_system_prompt_for_chat
from app.services.agent import AgentService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException, ErrorCode, SandboxException
from app.services.git import GitService
from app.services.message import MessageService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.session_registry import session_registry
from app.services.storage import StorageService
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChatStreamRequest, StreamEnvelope
from app.services.user import UserService
from app.utils.cache import CacheError, CachePubSub, cache_connection, cache_pubsub

logger = logging.getLogger(__name__)

TERMINAL_STREAM_EVENT_TYPES = frozenset({"cancelled", "complete", "error"})

# Snippet windowing for chat message search results — keep some context before
# the match so the user sees what surrounds it without ballooning the payload.
SEARCH_SNIPPET_CONTEXT_BEFORE = 30
SEARCH_SNIPPET_MAX_LENGTH = 160
# Safety cap on rows fetched for a single search — prevents a common query
# (e.g. "the") on heavy chat history from loading tens of thousands of rows.
SEARCH_MAX_ROWS = 5000


class ChatService(BaseDbService[Chat]):
    def __init__(
        self,
        user_service: UserService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self.message_service = MessageService(session_factory=self._session_factory)
        self._user_service = user_service

    @staticmethod
    def sandbox_for_workspace(workspace: Workspace) -> SandboxService:
        # Create a short-lived SandboxService bound to the workspace's
        # provider and container — used for file ops and cleanup.
        provider = SandboxProvider.create_provider(
            workspace.sandbox_provider, workspace_path=workspace.workspace_path
        )
        return SandboxService(provider)

    @staticmethod
    def _extract_queue_processing_message_id(raw_data: Any) -> UUID | None:
        if not isinstance(raw_data, str):
            return None
        if StreamEventKind.QUEUE_PROCESSING.value not in raw_data:
            return None
        try:
            env = json.loads(raw_data)
            if env.get("kind") != StreamEventKind.QUEUE_PROCESSING.value:
                return None
            new_mid = (env.get("payload") or {}).get("assistant_message_id")
            return UUID(new_mid) if new_mid else None
        except (json.JSONDecodeError, ValueError):
            return None

    async def get_user_chats(
        self,
        user: User,
        pagination: PaginationParams | None = None,
        workspace_id: UUID | None = None,
        pinned: bool | None = None,
    ) -> PaginatedResponse[ChatSchema]:
        # Paginated list of non-deleted top-level chats (sub-threads excluded),
        # pinned first, then by most recent.
        # When workspace_id is provided, results are scoped to that workspace only.
        # When pinned is provided, results are filtered to pinned (True) or unpinned (False).
        if pagination is None:
            pagination = PaginationParams()

        async with self.session_factory() as db:
            base_filters = [
                Chat.user_id == user.id,
                Chat.deleted_at.is_(None),
                Chat.parent_chat_id.is_(None),
            ]
            if workspace_id is not None:
                base_filters.append(Chat.workspace_id == workspace_id)
            if pinned is True:
                base_filters.append(Chat.pinned_at.isnot(None))
            elif pinned is False:
                base_filters.append(Chat.pinned_at.is_(None))

            count_query = select(func.count(Chat.id)).filter(*base_filters)
            count_result = await db.execute(count_query)
            total = count_result.scalar() or 0

            offset = (pagination.page - 1) * pagination.per_page

            SubThread = aliased(Chat)
            sub_count_sq = (
                select(func.count())
                .where(
                    SubThread.parent_chat_id == Chat.id,
                    SubThread.user_id == user.id,
                    SubThread.deleted_at.is_(None),
                )
                .correlate(Chat)
                .scalar_subquery()
                .label("sub_thread_count")
            )

            query = (
                select(Chat, sub_count_sq)
                .options(selectinload(Chat.workspace))
                .filter(*base_filters)
                .order_by(Chat.pinned_at.desc().nulls_last(), Chat.updated_at.desc())
                .offset(offset)
                .limit(pagination.per_page)
            )
            result = await db.execute(query)
            rows = result.all()

            items = []
            for chat, sub_thread_count in rows:
                schema = ChatSchema.model_validate(chat)
                schema.sub_thread_count = sub_thread_count
                items.append(schema)

            return PaginatedResponse[ChatSchema](
                items=items,
                page=pagination.page,
                per_page=pagination.per_page,
                total=total,
                pages=math.ceil(total / pagination.per_page),
            )

    async def search_messages(
        self,
        user: User,
        query: str,
        *,
        limit: int = 50,
        per_chat_limit: int = 5,
    ) -> ChatSearchResponse:
        # Searches plain-text message bodies (content_text) across all of the
        # user's non-deleted chats and workspaces. Order: most recent matching
        # message first; then in Python we group per-chat, capping matches per
        # chat and total chats. The frontend further groups results by workspace
        # for display. Caller is expected to pass a non-empty trimmed query.
        # +1 lookahead lets us flag truncation when more chats exist than the cap
        chat_cap = limit + 1

        async with self.session_factory() as db:
            stmt = (
                select(
                    Message.id,
                    Message.chat_id,
                    Message.role,
                    Message.content_text,
                    Message.created_at,
                    Chat.title,
                    Chat.workspace_id,
                    Workspace.name.label("workspace_name"),
                )
                .join(Chat, Chat.id == Message.chat_id)
                .join(Workspace, Workspace.id == Chat.workspace_id)
                .where(
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                    Message.deleted_at.is_(None),
                    Message.content_text.icontains(query, autoescape=True),
                )
                .order_by(Message.created_at.desc())
                .limit(SEARCH_MAX_ROWS)
            )
            result = await db.execute(stmt)
            rows = result.all()

        # Group by chat in insertion order (which is desc by created_at).
        grouped: dict[UUID, ChatSearchResult] = {}
        # Hitting the SQL cap means there may be older matches we never saw —
        # report truncation even if the per-chat / chat-cap loop never trips.
        truncated = len(rows) == SEARCH_MAX_ROWS
        query_lower = query.lower()

        for row in rows:
            chat_id = row.chat_id
            existing = grouped.get(chat_id)
            if existing is None:
                if len(grouped) >= chat_cap:
                    truncated = True
                    break
                existing = ChatSearchResult(
                    chat_id=chat_id,
                    chat_title=row.title,
                    workspace_id=row.workspace_id,
                    workspace_name=row.workspace_name,
                    matches=[],
                    match_count=0,
                )
                grouped[chat_id] = existing

            existing.match_count += 1
            if len(existing.matches) >= per_chat_limit:
                truncated = True
                continue

            before, match_text, after = self._build_snippet(
                row.content_text, query_lower
            )
            existing.matches.append(
                ChatSearchMatch(
                    message_id=row.id,
                    role=row.role,
                    snippet_before=before,
                    snippet_match=match_text,
                    snippet_after=after,
                    created_at=row.created_at,
                )
            )

        # The loop only sets truncated when a NEW chat would push us past the
        # lookahead cap; if we land at exactly limit+1 and the rows end there,
        # we still drop a chat in the slice below — flag it.
        if len(grouped) > limit:
            truncated = True
        return ChatSearchResponse(
            results=list(grouped.values())[:limit], truncated=truncated
        )

    @staticmethod
    def _build_snippet(content: str, query_lower: str) -> tuple[str, str, str]:
        # Slide a window around the first match so long messages don't bloat
        # the payload. Returns (before, match, after) — pre-split so consumers
        # don't need to reason about codepoint vs UTF-16 indices.
        idx = content.lower().find(query_lower)
        if idx < 0:
            # Shouldn't happen since the SQL filter matched, but fall back to head.
            return content[:SEARCH_SNIPPET_MAX_LENGTH], "", ""

        start = max(0, idx - SEARCH_SNIPPET_CONTEXT_BEFORE)
        end = start + SEARCH_SNIPPET_MAX_LENGTH
        match_end_in_content = idx + len(query_lower)
        prefix = "…" if start > 0 else ""
        suffix = "…" if end < len(content) else ""
        before = prefix + content[start:idx]
        # Slice the matched text out of the original content (preserves the
        # caller's case) instead of echoing query_lower.
        match_text = content[idx:match_end_in_content]
        after = content[match_end_in_content:end] + suffix
        return before, match_text, after

    async def create_chat(self, user: User, chat_data: ChatCreate) -> Chat:
        async with self.session_factory() as db:
            workspace_id = chat_data.workspace_id
            worktree_cwd: str | None = None

            if chat_data.parent_chat_id:
                parent_result = await db.execute(
                    select(Chat).filter(
                        Chat.id == chat_data.parent_chat_id,
                        Chat.user_id == user.id,
                        Chat.deleted_at.is_(None),
                    )
                )
                parent = parent_result.scalar_one_or_none()
                if not parent:
                    raise ChatException(
                        "Parent chat not found",
                        error_code=ErrorCode.CHAT_NOT_FOUND,
                        details={"parent_chat_id": str(chat_data.parent_chat_id)},
                        status_code=404,
                    )
                if parent.parent_chat_id is not None:
                    raise ChatException(
                        "Cannot create a sub-thread of a sub-thread",
                        error_code=ErrorCode.VALIDATION_ERROR,
                        status_code=400,
                    )
                workspace_id = parent.workspace_id
                # Sub-threads run in the parent's worktree so they see its
                # uncommitted changes (e.g. /review-branch on the parent's diff).
                worktree_cwd = parent.worktree_cwd
                # Ordering-only bump, not new parent content — carry read state
                # across it so an already-read parent doesn't flip to unread.
                was_read = not parent.unread
                now = datetime.now(timezone.utc)
                parent.updated_at = now
                if was_read:
                    parent.last_viewed_at = now

            ws_result = await db.execute(
                select(Workspace).filter(
                    Workspace.id == workspace_id,
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            workspace = ws_result.scalar_one_or_none()
            if not workspace:
                raise ChatException(
                    "Workspace not found",
                    error_code=ErrorCode.WORKSPACE_NOT_FOUND,
                    details={"workspace_id": str(workspace_id)},
                    status_code=404,
                )

            chat = Chat(
                title=chat_data.title,
                user_id=user.id,
                workspace_id=workspace.id,
                parent_chat_id=chat_data.parent_chat_id,
                worktree_cwd=worktree_cwd,
            )

            db.add(chat)
            await db.commit()

            query = (
                select(Chat)
                .options(selectinload(Chat.workspace))
                .filter(Chat.id == chat.id)
            )
            result = await db.execute(query)
            loaded_chat: Chat = result.scalar_one()

        # Announce so open browser sessions can show chats created out-of-band
        # (e.g. via the MCP server) without a refresh.
        await self._publish_user_chat_event(
            user.id,
            {
                "kind": "chat_created",
                "chat": ChatSchema.model_validate(loaded_chat).model_dump(mode="json"),
            },
        )

        return loaded_chat

    async def _publish_user_chat_event(
        self, user_id: UUID, payload: dict[str, Any]
    ) -> None:
        # Best-effort broadcast on the user's live channel — a missed event only
        # delays the sidebar/tab update until the next normal refetch.
        try:
            async with cache_connection() as cache:
                await cache.publish(
                    REDIS_KEY_USER_CHATS_LIVE.format(user_id=user_id),
                    json.dumps(payload),
                )
        except CacheError:
            logger.warning("Failed to publish %s user chat event", payload.get("kind"))

    async def get_sub_threads(self, chat_id: UUID, user: User) -> list[Chat]:
        # Returns ORM objects — sub_thread_count defaults to 0 in ChatSchema,
        # which is correct since nesting is limited to one level (sub-threads
        # cannot have their own sub-threads).
        async with self.session_factory() as db:
            parent_exists = await db.execute(
                select(Chat.id).filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            if not parent_exists.scalar_one_or_none():
                raise ChatException(
                    "Chat not found",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            result = await db.execute(
                select(Chat)
                .options(selectinload(Chat.workspace))
                .filter(
                    Chat.parent_chat_id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
                .order_by(Chat.updated_at.desc())
            )
            return list(result.scalars().all())

    async def get_active_streams(
        self, user: User, chat_ids: list[UUID]
    ) -> list[ActiveStreamStatus]:
        # Bulk startup discovery: one ownership query for all runtime-active chats,
        # then resolve the in-progress message per surviving chat (rarely more than a few).
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat.id).filter(
                    Chat.id.in_(chat_ids),
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            owned_ids = list(result.scalars().all())

        statuses: list[ActiveStreamStatus] = []
        for chat_id in owned_ids:
            message = await self.message_service.get_in_progress_assistant_message(
                chat_id
            )
            if message:
                statuses.append(
                    ActiveStreamStatus(
                        chat_id=chat_id,
                        message_id=message.id,
                        stream_id=message.active_stream_id,
                        last_seq=message.last_seq,
                    )
                )
        return statuses

    async def update_chat(
        self, chat_id: UUID, chat_update: ChatUpdate, user: User
    ) -> Chat:
        # Update title and/or pin state for a chat owned by the user.
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat)
                .options(selectinload(Chat.workspace))
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to update it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            if chat_update.title is not None:
                chat.title = chat_update.title

            if chat_update.pinned is not None:
                chat.pinned_at = (
                    datetime.now(timezone.utc) if chat_update.pinned else None
                )

            # Rename/pin isn't new content — carry read state across the
            # updated_at bump so an already-read chat doesn't flip to unread.
            was_read = not chat.unread
            now = datetime.now(timezone.utc)
            chat.updated_at = now
            if was_read:
                chat.last_viewed_at = now
            await db.commit()

            return chat

    async def get_chat(self, chat_id: UUID, user: User) -> Chat:
        # Fetch a single chat with its workspace eagerly loaded (sandbox_id reads it).
        # Messages aren't loaded here — the Chat schema has no message field; the
        # paginated /messages endpoint serves the visible history. sub_thread_count
        # is computed only by callers that serialize it (see count_sub_threads).
        async with self.session_factory() as db:
            query = (
                select(Chat)
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
                .options(
                    selectinload(Chat.workspace),
                )
            )
            result = await db.execute(query)
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to access it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            return chat

    async def mark_chat_viewed(self, chat_id: UUID) -> None:
        # Explicitly keep updated_at in place — the Base onupdate would otherwise
        # bump it, reordering the sidebar and re-flagging the chat unread.
        async with self.session_factory() as db:
            await db.execute(
                update(Chat)
                .where(Chat.id == chat_id)
                .values(
                    last_viewed_at=datetime.now(timezone.utc),
                    updated_at=Chat.updated_at,
                )
            )
            await db.commit()

    async def count_sub_threads(self, chat_id: UUID, user: User) -> int:
        async with self.session_factory() as db:
            result = await db.execute(
                select(func.count(Chat.id)).filter(
                    Chat.parent_chat_id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            return result.scalar() or 0

    async def get_title_source(self, chat_id: UUID) -> tuple[str, str] | None:
        # Title prompt is the first non-empty user message; model is the most
        # recent one stored on a message (only assistant messages carry it).
        # Returns None when either is missing. Queried directly so callers don't
        # need the full message history loaded.
        async with self.session_factory() as db:
            prompt = (
                await db.execute(
                    select(Message.content_text)
                    .filter(
                        Message.chat_id == chat_id,
                        Message.role == MessageRole.USER,
                        Message.deleted_at.is_(None),
                        func.trim(Message.content_text) != "",
                    )
                    .order_by(Message.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()

            model_id = (
                await db.execute(
                    select(Message.model_id)
                    .filter(
                        Message.chat_id == chat_id,
                        Message.deleted_at.is_(None),
                        Message.model_id.is_not(None),
                    )
                    .order_by(Message.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()

        if not prompt or not model_id:
            return None
        return prompt, model_id

    async def get_model_context_window(self, chat_id: UUID) -> int | None:
        last_msg = await self.message_service.get_latest_assistant_message(chat_id)
        if not last_msg or not last_msg.model_id:
            return None
        return MODELS[last_msg.model_id].context_window

    async def delete_chat(self, chat_id: UUID, user: User) -> None:
        # Soft-delete a chat and its messages, terminate the active session,
        # and destroy the workspace container if no other chats reference it.
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat).filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to delete it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            workspace_id = chat.workspace_id
            now = datetime.now(timezone.utc)
            chat.deleted_at = now

            sub_thread_result = await db.execute(
                select(Chat.id).filter(
                    Chat.parent_chat_id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            sub_thread_ids = [row[0] for row in sub_thread_result.fetchall()]

            if sub_thread_ids:
                await db.execute(
                    update(Chat)
                    .where(Chat.id.in_(sub_thread_ids))
                    .values(deleted_at=now, updated_at=now)
                )
                await db.execute(
                    update(Message)
                    .where(
                        Message.chat_id.in_(sub_thread_ids),
                        Message.deleted_at.is_(None),
                    )
                    .values(deleted_at=now)
                )

            messages_update = (
                update(Message)
                .where(Message.chat_id == chat_id, Message.deleted_at.is_(None))
                .values(deleted_at=now)
            )
            await db.execute(messages_update)

            await db.commit()

            asyncio.create_task(session_registry.terminate(str(chat_id)))
            for sub_id in sub_thread_ids:
                asyncio.create_task(session_registry.terminate(str(sub_id)))

            # Destroy the workspace container if no chats remain
            remaining = await db.execute(
                select(func.count(Chat.id)).filter(
                    Chat.workspace_id == workspace_id,
                    Chat.deleted_at.is_(None),
                )
            )
            if remaining.scalar() == 0:
                ws_result = await db.execute(
                    select(Workspace).filter(
                        Workspace.id == workspace_id,
                        Workspace.deleted_at.is_(None),
                    )
                )
                workspace = ws_result.scalar_one_or_none()
                if workspace:
                    workspace.deleted_at = now
                    await db.commit()
                    if workspace.sandbox_id:
                        ws_sandbox = self.sandbox_for_workspace(workspace)
                        asyncio.create_task(
                            ws_sandbox.delete_sandbox(workspace.sandbox_id)
                        )

    async def delete_all_chats(self, user: User) -> int:
        # Bulk soft-delete all chats, messages, and workspaces for a user,
        # then fire-and-forget session termination and sandbox cleanup.
        async with self.session_factory() as db:
            chat_query = select(Chat.id).filter(
                Chat.user_id == user.id,
                Chat.deleted_at.is_(None),
            )
            result = await db.execute(chat_query)
            chat_ids = [str(row[0]) for row in result.fetchall()]

            ws_result = await db.execute(
                select(Workspace).filter(
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            workspaces = list(ws_result.scalars().all())

            now = datetime.now(timezone.utc)

            await db.execute(
                update(Chat)
                .where(Chat.user_id == user.id, Chat.deleted_at.is_(None))
                .values(deleted_at=now)
            )

            await db.execute(
                update(Message)
                .where(
                    Message.chat_id.in_(
                        select(Chat.id).filter(Chat.user_id == user.id)
                    ),
                    Message.deleted_at.is_(None),
                )
                .values(deleted_at=now)
            )

            for ws in workspaces:
                ws.deleted_at = now

            await db.commit()

            for cid in chat_ids:
                asyncio.create_task(session_registry.terminate(cid))

            for ws in workspaces:
                if ws.sandbox_id:
                    ws_sandbox = self.sandbox_for_workspace(ws)
                    asyncio.create_task(ws_sandbox.delete_sandbox(ws.sandbox_id))

            return len(chat_ids)

    async def get_chat_messages(
        self, chat_id: UUID, user: User, cursor: str | None = None, limit: int = 20
    ) -> CursorPaginatedResponse[MessageSchema]:
        # Cursor-paginated message list — verify ownership then delegate to MessageService.
        async with self.session_factory() as db:
            result = await db.execute(
                select(
                    exists().where(
                        Chat.id == chat_id,
                        Chat.user_id == user.id,
                        Chat.deleted_at.is_(None),
                    )
                )
            )
            if not result.scalar():
                raise ChatException(
                    "Chat not found or you don't have permission to access messages",
                    error_code=ErrorCode.CHAT_ACCESS_DENIED,
                    details={"chat_id": str(chat_id)},
                    status_code=403,
                )

        return await self.message_service.get_chat_messages(chat_id, cursor, limit)

    @staticmethod
    async def create_checkpoint_for_message(
        chat: Chat,
        assistant_message_id: UUID,
        session_factory: SessionFactoryType,
        worktree: bool,
    ) -> UUID | None:
        # Best-effort: a non-git workspace must not block the agent run.
        sandbox_id = chat.sandbox_id
        if not sandbox_id:
            return None

        try:
            # Resolve the same cwd the agent turn runs in, so the checkpoint's
            # diff and restore target match where the agent actually edited.
            cwd = await AgentService(session_factory=session_factory).resolve_cwd(
                chat, worktree
            )
            provider = SandboxProvider.create_provider(
                chat.sandbox_provider, workspace_path=chat.workspace_path
            )
            checkpoint = await GitService(SandboxService(provider)).create_checkpoint(
                sandbox_id, cwd
            )
            if checkpoint is None:
                return None

            async with session_factory() as db:
                checkpoint_row = ChatCheckpoint(
                    chat_id=chat.id,
                    assistant_message_id=assistant_message_id,
                    cwd=cwd,
                    base_head=checkpoint.base_head,
                    pre_run_diff=checkpoint.pre_run_diff,
                )
                db.add(checkpoint_row)
                await db.commit()
                await db.refresh(checkpoint_row)
                return cast(UUID, checkpoint_row.id)
        except (SandboxException, SQLAlchemyError, TimeoutError, ValueError) as exc:
            logger.warning(
                "Failed to create checkpoint for message %s: %s",
                assistant_message_id,
                exc,
            )
            return None

    async def restore_checkpoint_all(
        self,
        message_id: UUID,
        user: User,
    ) -> GitCommandResponse:
        checkpoint, chat = await self._get_checkpoint_target(message_id, user)
        git_service = GitService(self.sandbox_for_workspace(chat.workspace))
        return await git_service.restore_checkpoint_all(
            chat.workspace.sandbox_id,
            base_head=checkpoint.base_head,
            pre_run_diff=checkpoint.pre_run_diff,
            cwd=checkpoint.cwd,
        )

    async def _get_checkpoint_target(
        self,
        message_id: UUID,
        user: User,
    ) -> tuple[ChatCheckpoint, Chat]:
        async with self.session_factory() as db:
            result = await db.execute(
                select(ChatCheckpoint, Chat)
                .join(Chat, Chat.id == ChatCheckpoint.chat_id)
                .options(selectinload(Chat.workspace))
                .where(
                    ChatCheckpoint.assistant_message_id == message_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            row = result.one_or_none()
            if row is None:
                raise ChatException(
                    "Checkpoint not found",
                    error_code=ErrorCode.MESSAGE_NOT_FOUND,
                    details={"message_id": str(message_id)},
                    status_code=404,
                )
            checkpoint, chat = row
            return checkpoint, chat

    async def _replay_stream_backlog(
        self,
        chat_id: UUID,
        after_seq: int,
    ) -> AsyncIterator[dict[str, Any]]:
        # Catch-up mechanism for SSE reconnection: when a client reconnects
        # (network blip, page refresh) it sends the last seq it saw, and this
        # method pages through all persisted events after that seq so the
        # client doesn't miss anything before switching to live Redis pub/sub.
        page_size = 5000
        cursor = after_seq

        while True:
            backlog = await self.message_service.get_chat_events_after_seq(
                chat_id=chat_id,
                after_seq=cursor,
                limit=page_size,
            )
            if not backlog:
                return

            for event in backlog:
                yield self._build_stream_sse_event(
                    chat_id=event.chat_id,
                    message_id=event.message_id,
                    stream_id=event.stream_id,
                    seq=int(event.seq),
                    kind=event.event_type,
                    payload=event.render_payload,
                )
                if event.event_type in TERMINAL_STREAM_EVENT_TYPES:
                    return

            next_cursor = int(backlog[-1].seq)
            if next_cursor <= cursor:
                logger.warning(
                    "Non-increasing backlog seq for chat %s (cursor=%s, next=%s)",
                    chat_id,
                    cursor,
                    next_cursor,
                )
                return
            cursor = next_cursor

            if len(backlog) < page_size:
                return

    @staticmethod
    def _build_stream_sse_event(
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        seq: int,
        kind: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        # Canonical builder for the SSE envelope shape sent to the frontend.
        # The live-Redis path in _stream_live_redis_events constructs the same
        # {id, event, data} shape directly from pre-serialized envelope JSON.
        return {
            "id": str(seq),
            "event": StreamEventKind.STREAM.value,
            "data": StreamEnvelope.serialize(
                chat_id=chat_id,
                message_id=message_id,
                stream_id=stream_id,
                seq=seq,
                kind=kind,
                payload=payload,
            ),
        }

    async def _build_stream_error_event(
        self,
        *,
        chat_id: UUID,
        message_id: UUID | None,
        stream_id: UUID | None,
        fallback_seq: int,
        error_message: str,
    ) -> dict[str, Any]:
        # Build an error SSE event that the client can always display. The caller
        # (create_event_stream) already resolves message/stream IDs before entering
        # the try block — if they're None, no active stream existed so we synthesize
        # IDs. If they're set, we persist the error to DB for replay on reconnect.
        payload = {"error": error_message}

        if message_id is None:
            return self._build_stream_sse_event(
                chat_id=chat_id,
                message_id=uuid4(),
                stream_id=stream_id or uuid4(),
                seq=fallback_seq + 1,
                kind="error",
                payload=payload,
            )

        resolved_stream_id = stream_id or uuid4()

        try:
            error_seq = await self.message_service.append_event_with_next_seq(
                chat_id=chat_id,
                message_id=message_id,
                stream_id=resolved_stream_id,
                event_type="error",
                render_payload=payload,
                audit_payload={"payload": payload},
            )
        except Exception as exc:
            # Broad catch so the client always receives an error event, even if
            # DB persistence fails; fall back to a synthesized seq.
            logger.warning(
                "Failed to persist stream error event for chat %s: %s",
                chat_id,
                exc,
            )
            error_seq = fallback_seq + 1

        return self._build_stream_sse_event(
            chat_id=chat_id,
            message_id=message_id,
            stream_id=resolved_stream_id,
            seq=error_seq,
            kind="error",
            payload=payload,
        )

    async def _stream_live_redis_events(
        self,
        chat_id: UUID,
        last_seq: int,
        live_pubsub: CachePubSub,
    ) -> AsyncIterator[dict[str, Any]]:
        # Real-time leg of the SSE connection: events are published as full
        # envelopes on the Redis channel so we can yield them directly without
        # a DB round-trip.
        while True:
            message = await live_pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if not message or message.get("type") != "message":
                continue

            raw = message.get("data")
            if not raw:
                continue

            try:
                envelope = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                logger.warning("Malformed Redis stream message for chat %s", chat_id)
                continue

            if not isinstance(envelope, dict) or "seq" not in envelope:
                logger.warning("Redis stream message missing seq for chat %s", chat_id)
                continue

            seq = int(envelope["seq"])
            if seq <= last_seq:
                continue

            # Gap detected — a pub/sub message was missed. Fall back to DB
            # to recover the skipped events before yielding this one.
            if seq > last_seq + 1:
                async for event in self._replay_stream_backlog(chat_id, last_seq):
                    yield event
                    last_seq = int(event["id"])
                if last_seq >= seq:
                    if envelope.get("kind") in TERMINAL_STREAM_EVENT_TYPES:
                        return
                    continue

            yield {
                "id": str(seq),
                "event": StreamEventKind.STREAM.value,
                "data": raw,
            }
            last_seq = seq

            if envelope.get("kind") in TERMINAL_STREAM_EVENT_TYPES:
                return

    async def has_cancelable_pending_start(self, chat_id: UUID) -> bool:
        message = await self.message_service.get_in_progress_assistant_message(chat_id)
        return bool(message and message.active_stream_id is None)

    async def _get_active_stream_targets(
        self, chat_id: UUID
    ) -> tuple[UUID | None, UUID | None]:
        # Look up the in-progress assistant message so create_event_stream has
        # real IDs for error reporting if the stream fails unexpectedly.
        active_assistant_message = (
            await self.message_service.get_in_progress_assistant_message(chat_id)
        )
        if active_assistant_message:
            return (
                active_assistant_message.id,
                active_assistant_message.active_stream_id,
            )
        return None, None

    async def create_event_stream(
        self, chat_id: UUID, after_seq: int
    ) -> AsyncIterator[dict[str, Any]]:
        # Entry point for the SSE connection: replays missed events from the DB,
        # then switches to live Redis pub/sub. If anything fails, yields an error
        # event so the client always gets feedback instead of hanging.
        active_message_id, active_stream_id = await self._get_active_stream_targets(
            chat_id
        )
        last_seq = after_seq

        try:
            async with cache_connection() as cache:
                channel = REDIS_KEY_CHAT_STREAM_LIVE.format(chat_id=chat_id)
                async with cache_pubsub(cache, channel) as live_pubsub:
                    async for item in self._replay_stream_backlog(chat_id, after_seq):
                        yield item
                        last_seq = int(item["id"])
                        new_mid = self._extract_queue_processing_message_id(
                            item.get("data")
                        )
                        if new_mid:
                            active_message_id = new_mid
                            active_stream_id = None

                    async for event in self._stream_live_redis_events(
                        chat_id,
                        last_seq,
                        live_pubsub,
                    ):
                        yield event
                        event_seq = int(event["id"])
                        if event_seq > last_seq:
                            last_seq = event_seq

                        new_mid = self._extract_queue_processing_message_id(
                            event.get("data")
                        )
                        if new_mid:
                            active_message_id = new_mid
                            active_stream_id = None

        except Exception as exc:
            # Final SSE safety net — any failure must surface as an error
            # event rather than a silently hung connection.
            logger.error(
                "Error in event stream for chat %s: %s", chat_id, exc, exc_info=True
            )
            yield await self._build_stream_error_event(
                chat_id=chat_id,
                message_id=active_message_id,
                stream_id=active_stream_id,
                fallback_seq=last_seq,
                error_message=str(exc),
            )

    async def create_chat_events_stream(
        self, user_id: UUID
    ) -> AsyncIterator[dict[str, Any]]:
        # Long-lived per-session feed of chat lifecycle events (chat_created,
        # stream_started) for activity happening out-of-band, e.g. via the MCP
        # server. Payloads pass through verbatim; the "kind" field inside them
        # discriminates. No backlog/replay: an event missed while disconnected
        # is recovered by the sidebar's next normal refetch.
        async with cache_connection() as cache:
            channel = REDIS_KEY_USER_CHATS_LIVE.format(user_id=user_id)
            async with cache_pubsub(cache, channel) as pubsub:
                while True:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    )
                    if not message or message.get("type") != "message":
                        continue
                    data = message.get("data")
                    if not data:
                        continue
                    yield {"event": "chat_event", "data": data}

    async def initiate_chat_completion(
        self,
        request: ChatRequest,
        current_user: User,
    ) -> ChatCompletionResult:
        # Main entry point for a user sending a message: validates keys, saves
        # the user message and an empty assistant message, uploads any attached
        # files to the sandbox, then kicks off the background stream task.
        # Returns the IDs the frontend needs to connect to the SSE stream.
        user_settings = await self._user_service.get_user_settings(current_user.id)
        chat = await self.get_chat(request.chat_id, current_user)

        # Bump ordering timestamps at initiation rather than first stream-event
        # persist — open sessions refetch the sidebar on the stream_started
        # broadcast and must already see the new order. Sub-threads bump their
        # parent too, since top-level ordering follows the parent.
        bump_ids = [chat.id]
        if chat.parent_chat_id:
            bump_ids.append(chat.parent_chat_id)
        now = datetime.now(timezone.utc)
        async with self.session_factory() as db:
            if chat.parent_chat_id:
                # The parent bump is ordering-only, not new parent content —
                # advance the read marker in lockstep so an already-read parent
                # doesn't flip to unread (the sub-thread row flags its own turn).
                # The WHERE guard is the SQL mirror of "read" per Chat.unread —
                # keep them in sync if that property's boundary ever changes.
                await db.execute(
                    update(Chat)
                    .where(
                        Chat.id == chat.parent_chat_id,
                        Chat.last_viewed_at >= Chat.updated_at,
                    )
                    .values(last_viewed_at=now)
                )
            await db.execute(
                update(Chat).where(Chat.id.in_(bump_ids)).values(updated_at=now)
            )
            await db.commit()

        chat_id = chat.id

        ws_sandbox = self.sandbox_for_workspace(chat.workspace)

        attachments: list[MessageAttachmentDict] | None = None
        if request.attached_files:
            file_storage = StorageService(ws_sandbox)
            agent_kind = MODELS[request.model_id].agent_kind
            attachments = list(
                await asyncio.gather(
                    *[
                        file_storage.save_file(
                            file,
                            agent_kind=agent_kind,
                            sandbox_id=chat.workspace.sandbox_id,
                            user_id=str(current_user.id),
                        )
                        for file in request.attached_files
                    ]
                )
            )

        await self.message_service.create_message(
            chat_id,
            request.prompt,
            MessageRole.USER,
            attachments=attachments,
        )

        assistant_message = await self.message_service.create_message(
            chat.id,
            "",
            MessageRole.ASSISTANT,
            model_id=request.model_id,
            stream_status=MessageStreamStatus.IN_PROGRESS,
        )

        checkpoint_id = await self.create_checkpoint_for_message(
            chat,
            assistant_message.id,
            self._session_factory,
            request.worktree,
        )

        model = MODELS[request.model_id]
        system_prompt = build_system_prompt_for_chat(
            user_settings,
            agent_kind=model.agent_kind,
            selected_persona_name=request.selected_persona_name,
        )
        try:
            await self._enqueue_chat_task(
                prompt=request.prompt,
                system_prompt=system_prompt,
                custom_instructions=user_settings.custom_instructions,
                chat=chat,
                permission_mode=request.permission_mode,
                model_id=request.model_id,
                session_id=chat.session_id,
                assistant_message_id=str(assistant_message.id),
                thinking_mode=request.thinking_mode,
                worktree=request.worktree,
                plan_mode=request.plan_mode,
                attachments=attachments,
                context_window=model.context_window,
                selected_persona_name=request.selected_persona_name,
            )
        except Exception as e:
            logger.error("Failed to enqueue chat task: %s", e)
            await self.message_service.soft_delete_message(assistant_message.id)
            raise

        # Lets open sessions mark this chat "running" even when the turn was
        # started out-of-band (e.g. via the MCP server) with no client stream.
        await self._publish_user_chat_event(
            current_user.id,
            {
                "kind": "stream_started",
                "chat_id": str(chat_id),
                "message_id": str(assistant_message.id),
            },
        )

        return {
            "message_id": str(assistant_message.id),
            "chat_id": str(chat_id),
            "last_seq": chat.last_event_seq,
            "checkpoint_id": str(checkpoint_id) if checkpoint_id else None,
            # Checkpoint creation resolves the turn's cwd, so a worktree
            # requested this turn already exists here — surface it now instead
            # of making the client wait for the stream config event.
            "worktree_cwd": chat.worktree_cwd,
        }

    async def _enqueue_chat_task(
        self,
        *,
        prompt: str,
        system_prompt: str,
        custom_instructions: str | None,
        chat: Chat,
        permission_mode: PermissionMode,
        model_id: str,
        session_id: str | None,
        assistant_message_id: str,
        thinking_mode: str | None,
        attachments: list[MessageAttachmentDict] | None,
        worktree: bool = False,
        plan_mode: bool = False,
        context_window: int | None = None,
        selected_persona_name: str = DEFAULT_PERSONA_NAME,
    ) -> None:
        # Package the chat state into a ChatStreamRequest and kick off the
        # background streaming task. Separate method so tests can override it
        # to run synchronously without the background task machinery.
        stream_attachments = (
            [dict(item) for item in attachments] if attachments else None
        )
        workspace = chat.workspace
        request = ChatStreamRequest(
            prompt=prompt,
            system_prompt=system_prompt,
            custom_instructions=custom_instructions,
            chat_data={
                "id": str(chat.id),
                "user_id": str(chat.user_id),
                "title": chat.title,
                "workspace_id": str(chat.workspace_id),
                "sandbox_id": workspace.sandbox_id,
                "workspace_path": workspace.workspace_path,
                "sandbox_provider": workspace.sandbox_provider,
                "session_id": chat.session_id,
                "session_agent_kind": chat.session_agent_kind,
                "worktree_cwd": chat.worktree_cwd,
            },
            permission_mode=permission_mode,
            model_id=model_id,
            context_window=context_window,
            session_id=session_id,
            assistant_message_id=assistant_message_id,
            thinking_mode=thinking_mode,
            worktree=worktree,
            plan_mode=plan_mode,
            attachments=stream_attachments,
            selected_persona_name=selected_persona_name,
        )
        ChatStreamRuntime.start_background_chat(request=request)
