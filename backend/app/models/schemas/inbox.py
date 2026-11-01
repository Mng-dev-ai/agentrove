from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.schemas.pagination import CursorPaginatedResponse


class InboxMessageCreate(BaseModel):
    chat_id: UUID
    title: str = Field(..., min_length=1, max_length=80)
    body: str = Field(..., min_length=1, max_length=500)


class InboxItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    chat_id: UUID
    title: str
    body: str
    read_at: datetime | None = None
    created_at: datetime


class InboxList(CursorPaginatedResponse[InboxItem]):
    unread_count: int
