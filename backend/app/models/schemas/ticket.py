from datetime import datetime
from uuid import UUID
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class TicketType(str, Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    DEPARTMENT = "department"
    GENERAL = "general"


class TicketPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"
    CRITICAL = "critical"


class TicketStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING = "waiting"
    RESOLVED = "resolved"
    CLOSED = "closed"


# Category schemas
class TicketCategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str | None = None
    ticket_type: TicketType = TicketType.GENERAL
    department_id: UUID | None = None
    sort_order: int = 0


class TicketCategoryCreate(TicketCategoryBase):
    pass


class TicketCategoryUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    ticket_type: TicketType | None = None
    department_id: UUID | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class TicketCategoryOut(TicketCategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool
    created_at: datetime


# Ticket schemas
class TicketBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    description: str = Field(..., min_length=1)
    ticket_type: TicketType = TicketType.GENERAL
    priority: TicketPriority = TicketPriority.MEDIUM
    category_id: UUID | None = None
    department_id: UUID | None = None
    project_id: UUID | None = None
    team_id: UUID | None = None
    due_date: datetime | None = None
    is_private: bool = False


class TicketCreate(TicketBase):
    pass


class TicketUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    ticket_type: TicketType | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    category_id: UUID | None = None
    department_id: UUID | None = None
    project_id: UUID | None = None
    assignee_id: UUID | None = None
    team_id: UUID | None = None
    due_date: datetime | None = None
    is_private: bool | None = None


class TicketOut(TicketBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ticket_number: int
    status: TicketStatus
    requester_id: UUID
    assignee_id: UUID | None = None
    resolved_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class TicketWithDetailsOut(TicketOut):
    requester_name: str
    requester_email: str
    assignee_name: str | None = None
    assignee_email: str | None = None
    category_name: str | None = None
    department_name: str | None = None
    team_name: str | None = None
    comments_count: int = 0


class TicketListFilters(BaseModel):
    ticket_type: TicketType | None = None
    status: TicketStatus | None = None
    priority: TicketPriority | None = None
    category_id: UUID | None = None
    department_id: UUID | None = None
    assignee_id: UUID | None = None
    requester_id: UUID | None = None
    team_id: UUID | None = None
    is_private: bool | None = None
    search: str | None = None


# Comment schemas
class TicketCommentBase(BaseModel):
    content: str = Field(..., min_length=1)
    is_internal: bool = False


class TicketCommentCreate(TicketCommentBase):
    pass


class TicketCommentUpdate(BaseModel):
    content: str | None = None


class TicketCommentOut(TicketCommentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ticket_id: UUID
    author_id: UUID
    created_at: datetime
    updated_at: datetime


class TicketCommentWithAuthorOut(TicketCommentOut):
    author_name: str
    author_email: str


# Attachment schemas
class TicketAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ticket_id: UUID
    uploaded_by: UUID
    filename: str
    filesize: int
    mimetype: str
    created_at: datetime


# Status history schemas
class TicketStatusHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ticket_id: UUID
    changed_by: UUID
    old_status: TicketStatus
    new_status: TicketStatus
    comment: str | None = None
    created_at: datetime


class TicketStatusHistoryWithUserOut(TicketStatusHistoryOut):
    changed_by_name: str
    changed_by_email: str
