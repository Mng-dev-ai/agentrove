from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PermissionBase(BaseModel):
    name: str
    display_name: str
    description: str | None = None
    module: str


class PermissionCreate(PermissionBase):
    pass


class PermissionOut(PermissionBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime


class RoleBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=64)
    display_name: str = Field(..., min_length=2, max_length=64)
    description: str | None = None


class RoleCreate(RoleBase):
    permission_ids: list[UUID] = []


class RoleUpdate(BaseModel):
    name: str | None = None
    display_name: str | None = None
    description: str | None = None
    permission_ids: list[UUID] | None = None


class RoleOut(RoleBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_system: bool
    created_at: datetime
    updated_at: datetime


class RoleWithPermissionsOut(RoleOut):
    permissions: list[PermissionOut] = []


class UserRoleAssign(BaseModel):
    role_id: UUID


class UserRoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: RoleOut
    created_at: datetime


class UserWithRolesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    username: str
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None = None
    is_active: bool
    is_verified: bool
    is_superuser: bool
    roles: list[RoleOut] = []
