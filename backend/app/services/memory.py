import math
import re
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.chat import Chat
from app.models.db_models.memory import Memory
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.memory import MemoryCreate, MemoryUpdate
from app.services.db import BaseDbService
from app.services.exceptions import ErrorCode, ServiceException

MEMORY_INDEX_LIMIT = 100
MEMORY_TOKEN_PATTERN = re.compile(r"\w+(?:-\w+)*")


class MemoryService(BaseDbService[Memory]):
    async def list_memories(
        self,
        user: User,
        workspace_id: UUID | None,
        query: str | None,
        ids: list[UUID] | None,
    ) -> list[Memory]:
        workspace_id = self.agent_workspace_filter(user, workspace_id)
        words = self._tokens(query or "")
        stmt = self._visible_memories(user.id, workspace_id).order_by(
            Memory.pinned.desc(), Memory.updated_at.desc()
        )
        if ids is not None:
            stmt = stmt.filter(Memory.id.in_(ids))
        async with self.session_factory() as db:
            memories = list((await db.execute(stmt)).scalars())
        return self._rank_by_rarity(memories, words) if words else memories

    async def create_memory(self, user: User, data: MemoryCreate) -> Memory:
        self._require_agent_writable(user, data.workspace_id)
        async with self.session_factory() as db:
            chat = await self._get_owned_chat(db, data.chat_id, user)
            if data.workspace_id is not None:
                await self._check_owned_workspace(db, data.workspace_id, user.id)
            memory = Memory(
                user_id=user.id,
                workspace_id=data.workspace_id,
                title=data.title,
                content=data.content,
                pinned=data.pinned,
                source_chat_id=chat.id if chat and chat.channel_id is None else None,
                source_model_id=chat.last_model_id if chat else None,
            )
            db.add(memory)
            await db.commit()
            await db.refresh(memory)
            return memory

    async def update_memory(
        self, memory_id: UUID, user: User, data: MemoryUpdate
    ) -> Memory:
        async with self.session_factory() as db:
            memory = await self._get_owned(db, memory_id, user)
            changes = data.model_dump(exclude_unset=True, exclude={"chat_id"})
            if "workspace_id" in changes:
                self._require_agent_writable(user, changes["workspace_id"])
            if changes.get("workspace_id") is not None:
                await self._check_owned_workspace(db, changes["workspace_id"], user.id)
            chat = await self._get_owned_chat(db, data.chat_id, user)
            if chat is not None:
                memory.source_chat_id = chat.id if chat.channel_id is None else None
                memory.source_model_id = chat.last_model_id
            for field, value in changes.items():
                setattr(memory, field, value)
            await db.commit()
            await db.refresh(memory)
            return memory

    async def delete_memory(self, memory_id: UUID, user: User) -> None:
        async with self.session_factory() as db:
            memory = await self._get_owned(db, memory_id, user)
            await db.delete(memory)
            await db.commit()

    async def build_prompt_block(self, user_id: UUID, workspace_id: UUID) -> str | None:
        async with self.session_factory() as db:
            memories = list(
                (
                    await db.execute(
                        self._visible_memories(user_id, workspace_id).order_by(
                            Memory.workspace_id.is_(None), Memory.updated_at.desc()
                        )
                    )
                ).scalars()
            )
        if not memories:
            return None
        pinned = [m for m in memories if m.pinned]
        unpinned = [m for m in memories if not m.pinned]
        sections = []
        if pinned:
            sections.append(
                "Pinned memories (full content):\n"
                + "".join(
                    f"- {m.id} [{self._scope_label(m)}] {m.title}: {m.content}\n"
                    for m in pinned
                )
            )
        if unpinned:
            index = "".join(
                f"- {m.id} [{self._scope_label(m)}] {m.title}\n"
                for m in unpinned[:MEMORY_INDEX_LIMIT]
            )
            if len(unpinned) > MEMORY_INDEX_LIMIT:
                index += (
                    f"...and {len(unpinned) - MEMORY_INDEX_LIMIT} more; "
                    "use search_memory to find them.\n"
                )
            sections.append(
                "Other memories (titles only; read one by id with read_memories, "
                "use search_memory for topics not listed here):\n" + index
            )
        return f"<memory>\n{''.join(sections)}</memory>"

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return set(MEMORY_TOKEN_PATTERN.findall(text.lower()))

    @classmethod
    def _rank_by_rarity(cls, memories: list[Memory], words: set[str]) -> list[Memory]:
        matched = {
            m.id: words & cls._tokens(f"{m.title}\n{m.content}") for m in memories
        }
        idf = {
            word: math.log(len(memories) / df)
            for word in words
            if (df := sum(word in found for found in matched.values()))
        }
        if any(idf.values()):
            scores = {key: sum(idf[w] for w in found) for key, found in matched.items()}
        else:
            scores = {key: float(len(found)) for key, found in matched.items()}
        return sorted(
            (m for m in memories if scores[m.id] > 0), key=lambda m: -scores[m.id]
        )

    @staticmethod
    def _scope_label(memory: Memory) -> str:
        return "global" if memory.workspace_id is None else "workspace"

    @staticmethod
    def _visible_memories(
        user_id: UUID, workspace_id: UUID | None
    ) -> Select[tuple[Memory]]:
        stmt = select(Memory).filter(Memory.user_id == user_id)
        if workspace_id is not None:
            stmt = stmt.filter(
                or_(Memory.workspace_id == workspace_id, Memory.workspace_id.is_(None))
            )
        return stmt

    @staticmethod
    async def _check_owned_workspace(
        db: AsyncSession, workspace_id: UUID, user_id: UUID
    ) -> None:
        if (
            await db.scalar(
                select(Workspace.id).filter(
                    Workspace.id == workspace_id,
                    Workspace.user_id == user_id,
                    Workspace.deleted_at.is_(None),
                )
            )
            is None
        ):
            raise ServiceException(
                "Workspace not found",
                error_code=ErrorCode.WORKSPACE_NOT_FOUND,
                details={"workspace_id": str(workspace_id)},
                status_code=404,
            )

    @classmethod
    def _require_agent_writable(cls, user: User, workspace_id: UUID | None) -> None:
        if user.agent_scope is None:
            return
        if workspace_id is None:
            raise ServiceException(
                "Sandboxed agents cannot write global memories; "
                "use scope 'workspace' instead",
                status_code=403,
            )
        cls.require_agent_workspace(user, workspace_id)

    @classmethod
    async def _get_owned_chat(
        cls, db: AsyncSession, chat_id: UUID | None, user: User
    ) -> Chat | None:
        if chat_id is None:
            return None
        chat: Chat | None = await db.scalar(
            select(Chat).filter(
                Chat.id == chat_id,
                Chat.user_id == user.id,
                Chat.deleted_at.is_(None),
            )
        )
        if chat is None:
            raise ServiceException(
                "Chat not found",
                error_code=ErrorCode.CHAT_NOT_FOUND,
                details={"chat_id": str(chat_id)},
                status_code=404,
            )
        cls.require_agent_workspace(user, chat.workspace_id)
        return chat

    @classmethod
    async def _get_owned(cls, db: AsyncSession, memory_id: UUID, user: User) -> Memory:
        memory: Memory | None = await db.scalar(
            select(Memory).filter(Memory.id == memory_id, Memory.user_id == user.id)
        )
        if memory is None:
            raise ServiceException(
                "Memory not found",
                details={"memory_id": str(memory_id)},
                status_code=404,
            )
        cls._require_agent_writable(user, memory.workspace_id)
        return memory
