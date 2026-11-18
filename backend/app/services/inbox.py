from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import Select, and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.chat import Chat
from app.models.db_models.inbox import InboxItem
from app.models.db_models.user import User, UserSettings
from app.models.db_models.workspace import Workspace
from app.models.schemas.inbox import (
    InboxItem as InboxSchema,
    InboxList,
    InboxMessageCreate,
)
from app.services.db import BaseDbService
from app.services.exceptions import ErrorCode, ServiceException
from app.services.push import PushService
from app.utils.cursor import Cursor, InvalidCursorError

PUSH_TTL_SECONDS = 3600


class InboxService(BaseDbService[InboxItem]):
    async def list_items(self, user: User, cursor: str | None, limit: int) -> InboxList:
        query = (
            self._with_source()
            .filter(InboxItem.user_id == user.id)
            .order_by(InboxItem.created_at.desc(), InboxItem.id.desc())
            .limit(limit + 1)
        )
        if cursor:
            try:
                ts, item_id = Cursor.decode(cursor)
            except InvalidCursorError:
                raise ServiceException(
                    "Invalid pagination cursor",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )
            query = query.filter(
                or_(
                    InboxItem.created_at < ts,
                    and_(InboxItem.created_at == ts, InboxItem.id < item_id),
                )
            )
        async with self.session_factory() as db:
            rows = list((await db.execute(query)).tuples())
            unread_count = await db.scalar(
                select(func.count())
                .select_from(InboxItem)
                .filter(InboxItem.user_id == user.id, InboxItem.read_at.is_(None))
            )
        has_more = len(rows) > limit
        items = [self._to_schema(*row) for row in rows[:limit]]
        return InboxList(
            items=items,
            next_cursor=Cursor.encode(items[-1].created_at, items[-1].id)
            if has_more
            else None,
            has_more=has_more,
            unread_count=unread_count or 0,
        )

    async def create_message(self, user: User, data: InboxMessageCreate) -> InboxSchema:
        async with self.session_factory() as db:
            chat = (
                await db.execute(
                    select(Chat.id, Chat.title, Workspace.name)
                    .join(Workspace, Workspace.id == Chat.workspace_id)
                    .filter(
                        Chat.id == data.chat_id,
                        Chat.user_id == user.id,
                        Chat.deleted_at.is_(None),
                        Chat.is_visible(),
                    )
                )
            ).one_or_none()
            if user.agent_scope is not None and (
                chat is None or chat.id != user.agent_scope.chat_id
            ):
                chat = None
            if chat is None:
                raise ServiceException(
                    "Chat not found",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(data.chat_id)},
                    status_code=404,
                )
            chat_id, chat_title, workspace_name = chat
            item = InboxItem(
                user_id=user.id,
                chat_id=chat_id,
                title=data.title,
                body=data.body,
            )
            db.add(item)
            await db.commit()
            await db.refresh(item)
        await PushService(self.session_factory).enqueue(
            user_id=user.id,
            event_key=f"inbox:{item.id}",
            title=item.title,
            body=item.body,
            path=f"/chat/{chat_id}",
            collapse_id=f"inbox:{item.id}",
            ttl_seconds=PUSH_TTL_SECONDS,
            setting=UserSettings.notify_inbox_messages,
        )
        return self._to_schema(item, chat_title, workspace_name)

    async def mark_read(self, item_id: UUID, user: User) -> InboxSchema:
        async with self.session_factory() as db:
            item, chat_title, workspace_name = await self._get_owned(
                db, item_id, user.id
            )
            if item.read_at is None:
                item.read_at = datetime.now(timezone.utc)
                await db.commit()
                await db.refresh(item)
            return self._to_schema(item, chat_title, workspace_name)

    async def mark_unread(self, item_id: UUID, user: User) -> InboxSchema:
        async with self.session_factory() as db:
            item, chat_title, workspace_name = await self._get_owned(
                db, item_id, user.id
            )
            if item.read_at is not None:
                item.read_at = None
                await db.commit()
                await db.refresh(item)
            return self._to_schema(item, chat_title, workspace_name)

    async def delete_item(self, item_id: UUID, user: User) -> None:
        async with self.session_factory() as db:
            item, _chat_title, _workspace_name = await self._get_owned(
                db, item_id, user.id
            )
            await db.delete(item)
            await db.commit()

    async def mark_all_read(self, user: User) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(InboxItem)
                .where(InboxItem.user_id == user.id, InboxItem.read_at.is_(None))
                .values(read_at=datetime.now(timezone.utc))
            )
            await db.commit()

    async def clear_read(self, user: User) -> None:
        async with self.session_factory() as db:
            await db.execute(
                delete(InboxItem).where(
                    InboxItem.user_id == user.id, InboxItem.read_at.is_not(None)
                )
            )
            await db.commit()

    @staticmethod
    def _with_source() -> Select[tuple[InboxItem, str, str]]:
        return (
            select(InboxItem, Chat.title, Workspace.name)
            .join(Chat, Chat.id == InboxItem.chat_id)
            .join(Workspace, Workspace.id == Chat.workspace_id)
        )

    @staticmethod
    def _to_schema(
        item: InboxItem, chat_title: str, workspace_name: str
    ) -> InboxSchema:
        return InboxSchema(
            id=item.id,
            chat_id=item.chat_id,
            title=item.title,
            body=item.body,
            read_at=item.read_at,
            created_at=item.created_at,
            chat_title=chat_title,
            workspace_name=workspace_name,
        )

    @classmethod
    async def _get_owned(
        cls, db: AsyncSession, item_id: UUID, user_id: UUID
    ) -> tuple[InboxItem, str, str]:
        row = (
            await db.execute(
                cls._with_source().filter(
                    InboxItem.id == item_id, InboxItem.user_id == user_id
                )
            )
        ).one_or_none()
        if row is None:
            raise ServiceException(
                "Inbox item not found",
                details={"item_id": str(item_id)},
                status_code=404,
            )
        item, chat_title, workspace_name = row
        return item, chat_title, workspace_name
