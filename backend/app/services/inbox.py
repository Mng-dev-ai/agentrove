from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.chat import Chat
from app.models.db_models.inbox import InboxItem
from app.models.db_models.user import User
from app.models.schemas.inbox import (
    InboxItem as InboxSchema,
    InboxList,
    InboxMessageCreate,
)
from app.services.db import BaseDbService
from app.services.exceptions import ErrorCode, ServiceException
from app.services.push import PushService

LIST_LIMIT = 100
MESSAGES_PER_CHAT_PER_HOUR = 5
RATE_WINDOW = timedelta(hours=1)
PUSH_TTL_SECONDS = 3600


class InboxService(BaseDbService[InboxItem]):
    async def list_items(self, user: User) -> InboxList:
        async with self.session_factory() as db:
            result = await db.execute(
                select(InboxItem)
                .filter(InboxItem.user_id == user.id)
                .order_by(InboxItem.created_at.desc())
                .limit(LIST_LIMIT)
            )
            unread_count = await db.scalar(
                select(func.count())
                .select_from(InboxItem)
                .filter(InboxItem.user_id == user.id, InboxItem.read_at.is_(None))
            )
            items = [InboxSchema.model_validate(i) for i in result.scalars()]
            return InboxList(items=items, unread_count=unread_count or 0)

    async def create_message(self, user: User, data: InboxMessageCreate) -> InboxItem:
        async with self.session_factory() as db:
            chat_id = await db.scalar(
                select(Chat.id).filter(
                    Chat.id == data.chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            if chat_id is None:
                raise ServiceException(
                    "Chat not found",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(data.chat_id)},
                    status_code=404,
                )
            recent = await db.scalar(
                select(func.count())
                .select_from(InboxItem)
                .filter(
                    InboxItem.chat_id == chat_id,
                    InboxItem.created_at > datetime.now(timezone.utc) - RATE_WINDOW,
                )
            )
            if (recent or 0) >= MESSAGES_PER_CHAT_PER_HOUR:
                raise ServiceException(
                    "Too many inbox messages from this chat; try again later",
                    error_code=ErrorCode.RATE_LIMIT_EXCEEDED,
                    details={"chat_id": str(chat_id)},
                    status_code=429,
                )
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
        )
        return item

    async def mark_read(self, item_id: UUID, user: User) -> InboxItem:
        async with self.session_factory() as db:
            item = await self._get_owned(db, item_id, user.id)
            if item.read_at is None:
                item.read_at = datetime.now(timezone.utc)
                await db.commit()
                await db.refresh(item)
            return item

    async def mark_all_read(self, user: User) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(InboxItem)
                .where(InboxItem.user_id == user.id, InboxItem.read_at.is_(None))
                .values(read_at=datetime.now(timezone.utc))
            )
            await db.commit()

    @staticmethod
    async def _get_owned(db: AsyncSession, item_id: UUID, user_id: UUID) -> InboxItem:
        item: InboxItem | None = await db.scalar(
            select(InboxItem).filter(
                InboxItem.id == item_id, InboxItem.user_id == user_id
            )
        )
        if item is None:
            raise ServiceException(
                "Inbox item not found",
                details={"item_id": str(item_id)},
                status_code=404,
            )
        return item
