from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.schemas.pagination import CursorPaginatedResponse


class InboxMessageCreate(BaseModel):
    chat_id: UUID
    title: str = Field(..., min_length=1, max_length=80)
    body: str = Field(..., min_length=1, max_length=500)


class InboxItem(BaseModel):
    id: UUID
    chat_id: UUID
    title: str
    body: str
    read_at: datetime | None = None
    created_at: datetime
    chat_title: str
    workspace_name: str


class InboxList(CursorPaginatedResponse[InboxItem]):
    unread_count: int
