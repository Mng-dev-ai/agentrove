from datetime import datetime
from uuid import UUID
from enum import Enum
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProjectStatus(str, Enum):
    PLANNING = "planning"
    ACTIVE = "active"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ProjectPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class TaskStatus(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    DONE = "done"
    CANCELLED = "cancelled"


class TaskPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


# Project schemas
class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    key: str = Field(..., min_length=2, max_length=8)
    description: str | None = None
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: ProjectPriority = ProjectPriority.MEDIUM
    customer_id: UUID | None = None
    department_id: UUID | None = None
    team_id: UUID | None = None
    budget: Decimal | None = None
    hourly_rate: Decimal | None = None
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_billable: bool = True
    is_private: bool = False


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = None
    key: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    priority: ProjectPriority | None = None
    customer_id: UUID | None = None
    department_id: UUID | None = None
    team_id: UUID | None = None
    owner_id: UUID | None = None
    budget: Decimal | None = None
    hourly_rate: Decimal | None = None
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_billable: bool | None = None
    is_private: bool | None = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_id: UUID
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ProjectWithDetailsOut(ProjectOut):
    owner_name: str
    owner_email: str
    customer_name: str | None = None
    department_name: str | None = None
    team_name: str | None = None
    members_count: int = 0
    tasks_count: int = 0
    completed_tasks: int = 0
    total_hours: float = 0


# Project Member schemas
class ProjectMemberBase(BaseModel):
    user_id: UUID
    role: str = "member"
    hourly_rate: Decimal | None = None


class ProjectMemberCreate(ProjectMemberBase):
    pass


class ProjectMemberUpdate(BaseModel):
    role: str | None = None
    hourly_rate: Decimal | None = None


class ProjectMemberOut(ProjectMemberBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    joined_at: datetime


class ProjectMemberWithUserOut(ProjectMemberOut):
    user_name: str
    user_email: str
    user_display_name: str | None = None


# Task schemas
class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    description: str | None = None
    status: TaskStatus = TaskStatus.TODO
    priority: TaskPriority = TaskPriority.MEDIUM
    assignee_id: UUID | None = None
    estimated_hours: Decimal | None = None
    due_date: datetime | None = None


class TaskCreate(TaskBase):
    project_id: UUID
    parent_task_id: UUID | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    assignee_id: UUID | None = None
    estimated_hours: Decimal | None = None
    actual_hours: Decimal | None = None
    due_date: datetime | None = None
    sort_order: int | None = None


class TaskOut(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    parent_task_id: UUID | None = None
    reporter_id: UUID
    actual_hours: Decimal | None = None
    completed_at: datetime | None = None
    sort_order: int
    created_at: datetime
    updated_at: datetime


class TaskWithDetailsOut(TaskOut):
    project_name: str
    assignee_name: str | None = None
    assignee_email: str | None = None
    reporter_name: str
    reporter_email: str
    subtasks_count: int = 0
    time_entries_count: int = 0
    total_hours: float = 0


# Time Entry schemas
class TimeEntryBase(BaseModel):
    project_id: UUID
    task_id: UUID | None = None
    description: str | None = None
    start_time: datetime
    end_time: datetime | None = None
    duration_minutes: int = 0
    is_billable: bool = True


class TimeEntryCreate(TimeEntryBase):
    pass


class TimeEntryUpdate(BaseModel):
    task_id: UUID | None = None
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None
    is_billable: bool | None = None


class TimeEntryOut(TimeEntryBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    is_approved: bool
    approved_by: UUID | None = None
    approved_at: datetime | None = None
    created_at: datetime


class TimeEntryWithUserOut(TimeEntryOut):
    user_name: str
    user_email: str
    project_name: str
    task_title: str | None = None


# AI Cost Entry schemas
class AICostEntryBase(BaseModel):
    project_id: UUID | None = None
    task_id: UUID | None = None
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: Decimal = Decimal("0")
    chat_id: UUID | None = None


class AICostEntryCreate(AICostEntryBase):
    pass


class AICostEntryOut(AICostEntryBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: datetime


# Statistics
class ProjectStats(BaseModel):
    total_projects: int
    active_projects: int
    completed_projects: int
    total_tasks: int
    completed_tasks: int
    total_hours: float
    total_ai_cost: float


class TimeStats(BaseModel):
    total_hours: float
    billable_hours: float
    non_billable_hours: float
    by_user: dict[str, float]
    by_project: dict[str, float]


class AICostStats(BaseModel):
    total_cost: float
    total_input_tokens: int
    total_output_tokens: int
    by_provider: dict[str, float]
    by_model: dict[str, float]
    by_user: dict[str, float]
