from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DepartmentBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str | None = None


class DepartmentCreate(DepartmentBase):
    parent_id: UUID | None = None
    manager_id: UUID | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    parent_id: UUID | None = None
    manager_id: UUID | None = None
    is_active: bool | None = None


class DepartmentOut(DepartmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    parent_id: UUID | None = None
    manager_id: UUID | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DepartmentWithChildrenOut(DepartmentOut):
    children: list["DepartmentWithChildrenOut"] = []
    teams_count: int = 0


class TeamBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str | None = None


class TeamCreate(TeamBase):
    department_id: UUID | None = None
    lead_id: UUID | None = None


class TeamUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    department_id: UUID | None = None
    lead_id: UUID | None = None
    is_active: bool | None = None


class TeamOut(TeamBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    department_id: UUID | None = None
    lead_id: UUID | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TeamWithMembersOut(TeamOut):
    members: list["TeamMemberOut"] = []
    department_name: str | None = None


class TeamMemberBase(BaseModel):
    user_id: UUID
    role: str = "member"


class TeamMemberCreate(TeamMemberBase):
    pass


class TeamMemberUpdate(BaseModel):
    role: str | None = None


class TeamMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    team_id: UUID
    user_id: UUID
    role: str
    joined_at: datetime


class TeamMemberWithUserOut(TeamMemberOut):
    user_email: str
    user_name: str
    user_display_name: str | None = None


DepartmentWithChildrenOut.model_rebuild()
TeamWithMembersOut.model_rebuild()
