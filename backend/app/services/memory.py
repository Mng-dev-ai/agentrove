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


class MemoryService(BaseDbService[Memory]):
    async def list_memories(
        self, user: User, workspace_id: UUID | None, query: str | None
    ) -> list[Memory]:
        stmt = self._visible_memories(user.id, workspace_id)
        for token in (query or "").split():
            stmt = stmt.filter(
                or_(
                    Memory.title.icontains(token, autoescape=True),
                    Memory.content.icontains(token, autoescape=True),
                )
            )
        stmt = stmt.order_by(Memory.pinned.desc(), Memory.updated_at.desc())
        async with self.session_factory() as db:
            return list((await db.execute(stmt)).scalars())

    async def create_memory(self, user: User, data: MemoryCreate) -> Memory:
        async with self.session_factory() as db:
            chat = await self._get_owned_chat(db, data.chat_id, user.id)
            if data.workspace_id is not None:
                await self._check_owned_workspace(db, data.workspace_id, user.id)
            memory = Memory(
                user_id=user.id,
                workspace_id=data.workspace_id,
                title=data.title,
                content=data.content,
                pinned=data.pinned,
                source_chat_id=chat.id if chat else None,
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
            memory = await self._get_owned(db, memory_id, user.id)
            changes = data.model_dump(exclude_unset=True, exclude={"chat_id"})
            if changes.get("workspace_id") is not None:
                await self._check_owned_workspace(db, changes["workspace_id"], user.id)
            chat = await self._get_owned_chat(db, data.chat_id, user.id)
            if chat is not None:
                memory.source_chat_id = chat.id
                memory.source_model_id = chat.last_model_id
            for field, value in changes.items():
                setattr(memory, field, value)
            await db.commit()
            await db.refresh(memory)
            return memory

    async def delete_memory(self, memory_id: UUID, user: User) -> None:
        async with self.session_factory() as db:
            memory = await self._get_owned(db, memory_id, user.id)
            await db.delete(memory)
            await db.commit()

    async def build_prompt_block(self, user_id: UUID, workspace_id: UUID) -> str | None:
        async with self.session_factory() as db:
            memories = list(
                (
                    await db.execute(
                        self._visible_memories(user_id, workspace_id)
                        .filter(Memory.pinned.is_(True))
                        .order_by(
                            Memory.workspace_id.is_(None), Memory.updated_at.desc()
                        )
                    )
                ).scalars()
            )
        if not memories:
            return None
        lines = "".join(
            f"- {m.id} [{'global' if m.workspace_id is None else 'workspace'}] "
            f"{m.title}: {m.content}\n"
            for m in memories
        )
        return f"<memory>\n{lines}</memory>"

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

    @staticmethod
    async def _get_owned_chat(
        db: AsyncSession, chat_id: UUID | None, user_id: UUID
    ) -> Chat | None:
        if chat_id is None:
            return None
        chat: Chat | None = await db.scalar(
            select(Chat).filter(
                Chat.id == chat_id,
                Chat.user_id == user_id,
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
        return chat

    @staticmethod
    async def _get_owned(db: AsyncSession, memory_id: UUID, user_id: UUID) -> Memory:
        memory: Memory | None = await db.scalar(
            select(Memory).filter(Memory.id == memory_id, Memory.user_id == user_id)
        )
        if memory is None:
            raise ServiceException(
                "Memory not found",
                details={"memory_id": str(memory_id)},
                status_code=404,
            )
        return memory
