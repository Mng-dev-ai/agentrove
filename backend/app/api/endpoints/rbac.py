import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.db_models.rbac import Role, Permission
from app.models.schemas.rbac import (
    RoleCreate,
    RoleUpdate,
    RoleOut,
    RoleWithPermissionsOut,
    PermissionOut,
    PermissionCreate,
    UserRoleAssign,
    UserWithRolesOut,
)
from app.services.rbac_service import RBACService

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_admin_user(user: User = Depends(current_active_user)) -> User:
    """Dependency that ensures the current user is a superuser or admin."""
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


@router.get("/roles", response_model=list[RoleWithPermissionsOut])
async def list_roles(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[RoleWithPermissionsOut]:
    """List all roles with their permissions."""
    service = RBACService(db)
    roles = await service.get_roles()
    return [
        RoleWithPermissionsOut(
            id=role.id,
            name=role.name,
            display_name=role.display_name,
            description=role.description,
            is_system=role.is_system,
            created_at=role.created_at,
            updated_at=role.updated_at,
            permissions=[
                PermissionOut.model_validate(rp.permission)
                for rp in role.permissions
            ],
        )
        for role in roles
    ]


@router.post("/roles", response_model=RoleWithPermissionsOut, status_code=status.HTTP_201_CREATED)
async def create_role(
    data: RoleCreate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> RoleWithPermissionsOut:
    """Create a new role."""
    service = RBACService(db)
    try:
        role = await service.create_role(data)
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role with this name already exists",
            )
        raise

    return RoleWithPermissionsOut(
        id=role.id,
        name=role.name,
        display_name=role.display_name,
        description=role.description,
        is_system=role.is_system,
        created_at=role.created_at,
        updated_at=role.updated_at,
        permissions=[],
    )


@router.get("/roles/{role_id}", response_model=RoleWithPermissionsOut)
async def get_role(
    role_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> RoleWithPermissionsOut:
    """Get a specific role with permissions."""
    service = RBACService(db)
    from uuid import UUID
    role = await service.get_role(UUID(role_id))
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    return RoleWithPermissionsOut(
        id=role.id,
        name=role.name,
        display_name=role.display_name,
        description=role.description,
        is_system=role.is_system,
        created_at=role.created_at,
        updated_at=role.updated_at,
        permissions=[
            PermissionOut.model_validate(rp.permission)
            for rp in role.permissions
        ],
    )


@router.patch("/roles/{role_id}", response_model=RoleWithPermissionsOut)
async def update_role(
    role_id: str,
    data: RoleUpdate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> RoleWithPermissionsOut:
    """Update a role."""
    service = RBACService(db)
    from uuid import UUID
    try:
        role = await service.update_role(UUID(role_id), data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    full_role = await service.get_role(role.id)
    return RoleWithPermissionsOut(
        id=full_role.id,
        name=full_role.name,
        display_name=full_role.display_name,
        description=full_role.description,
        is_system=full_role.is_system,
        created_at=full_role.created_at,
        updated_at=full_role.updated_at,
        permissions=[
            PermissionOut.model_validate(rp.permission)
            for rp in full_role.permissions
        ],
    )


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a role."""
    service = RBACService(db)
    from uuid import UUID
    try:
        deleted = await service.delete_role(UUID(role_id))
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )


@router.get("/permissions", response_model=list[PermissionOut])
async def list_permissions(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[PermissionOut]:
    """List all permissions."""
    service = RBACService(db)
    permissions = await service.get_permissions()
    return [PermissionOut.model_validate(p) for p in permissions]


@router.post("/initialize", status_code=status.HTTP_200_OK)
async def initialize_rbac(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Initialize default roles and permissions."""
    service = RBACService(db)
    await service.initialize_rbac()
    return {"success": True, "message": "RBAC initialized successfully"}


@router.post("/users/{user_id}/roles", status_code=status.HTTP_200_OK)
async def assign_role(
    user_id: str,
    data: UserRoleAssign,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Assign a role to a user."""
    service = RBACService(db)
    from uuid import UUID
    await service.assign_role_to_user(
        UUID(user_id), data.role_id, assigned_by=admin.id
    )
    return {"success": True, "message": "Role assigned successfully"}


@router.delete("/users/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_role(
    user_id: str,
    role_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a role from a user."""
    service = RBACService(db)
    from uuid import UUID
    removed = await service.remove_role_from_user(UUID(user_id), UUID(role_id))
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role assignment not found",
        )


@router.get("/users/{user_id}/roles", response_model=list[RoleOut])
async def get_user_roles(
    user_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[RoleOut]:
    """Get all roles for a user."""
    service = RBACService(db)
    from uuid import UUID
    roles = await service.get_user_roles(UUID(user_id))
    return [RoleOut.model_validate(r) for r in roles]


@router.get("/users/{user_id}/permissions", response_model=list[str])
async def get_user_permissions(
    user_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    """Get all permission names for a user."""
    service = RBACService(db)
    from uuid import UUID
    return await service.get_user_permissions(UUID(user_id))
