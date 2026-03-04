from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.db_models.rbac import Role, Permission, RolePermission, UserRole
from app.models.schemas.rbac import (
    RoleCreate,
    RoleUpdate,
    PermissionCreate,
)


SYSTEM_ROLES = [
    {
        "name": "super_admin",
        "display_name": "Super Admin",
        "description": "Full system access with all permissions",
        "is_system": True,
    },
    {
        "name": "admin",
        "display_name": "Administrator",
        "description": "Administrative access to manage users and settings",
        "is_system": True,
    },
    {
        "name": "manager",
        "display_name": "Manager",
        "description": "Team management and project oversight",
        "is_system": True,
    },
    {
        "name": "team_lead",
        "display_name": "Team Lead",
        "description": "Lead developers and coordinate tasks",
        "is_system": True,
    },
    {
        "name": "developer",
        "display_name": "Developer",
        "description": "Software development and code access",
        "is_system": True,
    },
    {
        "name": "designer",
        "display_name": "Designer",
        "description": "UI/UX design and visual assets",
        "is_system": True,
    },
    {
        "name": "qa",
        "display_name": "QA Engineer",
        "description": "Quality assurance and testing",
        "is_system": True,
    },
    {
        "name": "devops",
        "display_name": "DevOps Engineer",
        "description": "Infrastructure and deployment",
        "is_system": True,
    },
    {
        "name": "customer",
        "display_name": "Customer",
        "description": "External customer with limited access",
        "is_system": True,
    },
    {
        "name": "contractor",
        "display_name": "Contractor",
        "description": "External contractor with project access",
        "is_system": True,
    },
]


PERMISSIONS = [
    # Users module
    {"name": "users.view", "display_name": "View Users", "module": "users", "description": "View user list and profiles"},
    {"name": "users.create", "display_name": "Create Users", "module": "users", "description": "Create new users"},
    {"name": "users.edit", "display_name": "Edit Users", "module": "users", "description": "Edit user profiles and settings"},
    {"name": "users.delete", "display_name": "Delete Users", "module": "users", "description": "Delete users"},
    {"name": "users.manage_roles", "display_name": "Manage User Roles", "module": "users", "description": "Assign and remove user roles"},
    # Projects module
    {"name": "projects.view", "display_name": "View Projects", "module": "projects", "description": "View project list and details"},
    {"name": "projects.create", "display_name": "Create Projects", "module": "projects", "description": "Create new projects"},
    {"name": "projects.edit", "display_name": "Edit Projects", "module": "projects", "description": "Edit project settings"},
    {"name": "projects.delete", "display_name": "Delete Projects", "module": "projects", "description": "Delete projects"},
    {"name": "projects.archive", "display_name": "Archive Projects", "module": "projects", "description": "Archive and restore projects"},
    # Tasks module
    {"name": "tasks.view", "display_name": "View Tasks", "module": "tasks", "description": "View tasks and assignments"},
    {"name": "tasks.create", "display_name": "Create Tasks", "module": "tasks", "description": "Create new tasks"},
    {"name": "tasks.edit", "display_name": "Edit Tasks", "module": "tasks", "description": "Edit task details"},
    {"name": "tasks.delete", "display_name": "Delete Tasks", "module": "tasks", "description": "Delete tasks"},
    {"name": "tasks.assign", "display_name": "Assign Tasks", "module": "tasks", "description": "Assign tasks to users"},
    # Time tracking module
    {"name": "time.view_own", "display_name": "View Own Time", "module": "time", "description": "View own time entries"},
    {"name": "time.view_all", "display_name": "View All Time", "module": "time", "description": "View all time entries"},
    {"name": "time.edit_own", "display_name": "Edit Own Time", "module": "time", "description": "Edit own time entries"},
    {"name": "time.edit_all", "display_name": "Edit All Time", "module": "time", "description": "Edit all time entries"},
    {"name": "time.approve", "display_name": "Approve Time", "module": "time", "description": "Approve time entries"},
    # Reports module
    {"name": "reports.view", "display_name": "View Reports", "module": "reports", "description": "View basic reports"},
    {"name": "reports.export", "display_name": "Export Reports", "module": "reports", "description": "Export reports"},
    {"name": "reports.advanced", "display_name": "Advanced Reports", "module": "reports", "description": "Access advanced analytics"},
    # Settings module
    {"name": "settings.view", "display_name": "View Settings", "module": "settings", "description": "View system settings"},
    {"name": "settings.edit", "display_name": "Edit Settings", "module": "settings", "description": "Edit system settings"},
    # Billing module
    {"name": "billing.view", "display_name": "View Billing", "module": "billing", "description": "View billing information"},
    {"name": "billing.manage", "display_name": "Manage Billing", "module": "billing", "description": "Manage invoices and payments"},
    # AI module
    {"name": "ai.use", "display_name": "Use AI Features", "module": "ai", "description": "Access AI features"},
    {"name": "ai.manage_costs", "display_name": "Manage AI Costs", "module": "ai", "description": "View and manage AI cost tracking"},
    # Organization module
    {"name": "organization.view", "display_name": "View Organization", "module": "organization", "description": "View organization structure"},
    {"name": "organization.manage", "display_name": "Manage Organization", "module": "organization", "description": "Manage departments and teams"},
    # Tickets module
    {"name": "tickets.view", "display_name": "View Tickets", "module": "tickets", "description": "View own and public tickets"},
    {"name": "tickets.create", "display_name": "Create Tickets", "module": "tickets", "description": "Create new tickets"},
    {"name": "tickets.edit", "display_name": "Edit Tickets", "module": "tickets", "description": "Edit own tickets"},
    {"name": "tickets.department", "display_name": "Department Tickets", "module": "tickets", "description": "Access department-level tickets"},
    {"name": "tickets.manage_all", "display_name": "Manage All Tickets", "module": "tickets", "description": "Manage all tickets including assignment"},
    {"name": "tickets.admin", "display_name": "Admin Tickets", "module": "tickets", "description": "Full ticket administration including admin tickets"},
    # Finance module
    {"name": "finance.view", "display_name": "View Finance", "module": "finance", "description": "View invoices, payments, and expenses"},
    {"name": "finance.create", "display_name": "Create Finance Records", "module": "finance", "description": "Create invoices, payments, and expenses"},
    {"name": "finance.edit", "display_name": "Edit Finance Records", "module": "finance", "description": "Edit invoices, payments, and expenses"},
    {"name": "finance.approve", "display_name": "Approve Expenses", "module": "finance", "description": "Approve or reject expenses"},
    {"name": "finance.admin", "display_name": "Finance Admin", "module": "finance", "description": "Full finance administration including deletion"},
]


ROLE_PERMISSIONS = {
    "super_admin": [p["name"] for p in PERMISSIONS],
    "admin": [
        "users.view", "users.create", "users.edit", "users.manage_roles",
        "projects.view", "projects.create", "projects.edit", "projects.archive",
        "tasks.view", "tasks.create", "tasks.edit", "tasks.assign",
        "time.view_all", "time.edit_all", "time.approve",
        "reports.view", "reports.export", "reports.advanced",
        "settings.view", "settings.edit",
        "billing.view", "billing.manage",
        "ai.use", "ai.manage_costs",
        "organization.view", "organization.manage",
        "tickets.view", "tickets.create", "tickets.edit", "tickets.department", "tickets.manage_all", "tickets.admin",
        "finance.view", "finance.create", "finance.edit", "finance.approve", "finance.admin",
    ],
    "manager": [
        "users.view",
        "projects.view", "projects.create", "projects.edit",
        "tasks.view", "tasks.create", "tasks.edit", "tasks.assign",
        "time.view_all", "time.approve",
        "reports.view", "reports.export",
        "ai.use",
        "organization.view",
        "tickets.view", "tickets.create", "tickets.edit", "tickets.department", "tickets.manage_all",
        "finance.view", "finance.create", "finance.edit", "finance.approve",
    ],
    "team_lead": [
        "users.view",
        "projects.view", "projects.edit",
        "tasks.view", "tasks.create", "tasks.edit", "tasks.assign",
        "time.view_all",
        "reports.view",
        "ai.use",
        "organization.view",
        "tickets.view", "tickets.create", "tickets.edit", "tickets.department",
        "finance.view", "finance.create",
    ],
    "developer": [
        "projects.view",
        "tasks.view", "tasks.edit",
        "time.view_own", "time.edit_own",
        "ai.use",
        "tickets.view", "tickets.create", "tickets.edit",
    ],
    "designer": [
        "projects.view",
        "tasks.view", "tasks.edit",
        "time.view_own", "time.edit_own",
        "ai.use",
        "tickets.view", "tickets.create", "tickets.edit",
    ],
    "qa": [
        "projects.view",
        "tasks.view", "tasks.edit",
        "time.view_own", "time.edit_own",
        "ai.use",
        "tickets.view", "tickets.create", "tickets.edit",
    ],
    "devops": [
        "projects.view",
        "tasks.view", "tasks.edit",
        "time.view_own", "time.edit_own",
        "settings.view",
        "ai.use",
        "tickets.view", "tickets.create", "tickets.edit",
    ],
    "customer": [
        "projects.view",
        "tasks.view",
        "reports.view",
        "tickets.view", "tickets.create", "tickets.edit",
    ],
    "contractor": [
        "projects.view",
        "tasks.view", "tasks.edit",
        "time.view_own", "time.edit_own",
        "ai.use",
        "tickets.view", "tickets.create", "tickets.edit",
    ],
}


class RBACService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def initialize_rbac(self) -> None:
        """Initialize roles and permissions if not exist."""
        # Create permissions
        for perm_data in PERMISSIONS:
            result = await self.db.execute(
                select(Permission).filter(Permission.name == perm_data["name"])
            )
            if not result.scalar_one_or_none():
                permission = Permission(**perm_data)
                self.db.add(permission)
        await self.db.commit()

        # Create roles
        for role_data in SYSTEM_ROLES:
            result = await self.db.execute(
                select(Role).filter(Role.name == role_data["name"])
            )
            if not result.scalar_one_or_none():
                role = Role(**role_data)
                self.db.add(role)
        await self.db.commit()

        # Assign permissions to roles
        for role_name, perm_names in ROLE_PERMISSIONS.items():
            result = await self.db.execute(
                select(Role).filter(Role.name == role_name)
            )
            role = result.scalar_one_or_none()
            if not role:
                continue

            for perm_name in perm_names:
                result = await self.db.execute(
                    select(Permission).filter(Permission.name == perm_name)
                )
                permission = result.scalar_one_or_none()
                if not permission:
                    continue

                result = await self.db.execute(
                    select(RolePermission).filter(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == permission.id,
                    )
                )
                if not result.scalar_one_or_none():
                    role_perm = RolePermission(
                        role_id=role.id,
                        permission_id=permission.id,
                    )
                    self.db.add(role_perm)
        await self.db.commit()

    async def get_roles(self) -> list[Role]:
        result = await self.db.execute(
            select(Role).options(selectinload(Role.permissions).selectinload(RolePermission.permission)).order_by(Role.name)
        )
        return list(result.scalars().all())

    async def get_role(self, role_id: UUID) -> Role | None:
        result = await self.db.execute(
            select(Role)
            .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
            .filter(Role.id == role_id)
        )
        return result.scalar_one_or_none()

    async def create_role(self, data: RoleCreate) -> Role:
        role = Role(
            name=data.name,
            display_name=data.display_name,
            description=data.description,
            is_system=False,
        )
        self.db.add(role)
        await self.db.commit()
        await self.db.refresh(role)

        if data.permission_ids:
            await self._assign_permissions(role.id, data.permission_ids)

        return role

    async def update_role(self, role_id: UUID, data: RoleUpdate) -> Role | None:
        result = await self.db.execute(select(Role).filter(Role.id == role_id))
        role = result.scalar_one_or_none()
        if not role:
            return None

        if role.is_system:
            if data.name is not None or data.display_name is not None:
                raise ValueError("Cannot modify system role name or display name")

        if data.name is not None:
            role.name = data.name
        if data.display_name is not None:
            role.display_name = data.display_name
        if data.description is not None:
            role.description = data.description

        role.updated_at = datetime.now(timezone.utc)
        await self.db.commit()

        if data.permission_ids is not None:
            await self._assign_permissions(role.id, data.permission_ids)

        return role

    async def delete_role(self, role_id: UUID) -> bool:
        result = await self.db.execute(select(Role).filter(Role.id == role_id))
        role = result.scalar_one_or_none()
        if not role:
            return False

        if role.is_system:
            raise ValueError("Cannot delete system role")

        await self.db.delete(role)
        await self.db.commit()
        return True

    async def _assign_permissions(self, role_id: UUID, permission_ids: list[UUID]) -> None:
        await self.db.execute(
            delete(RolePermission).filter(RolePermission.role_id == role_id)
        )

        for perm_id in permission_ids:
            role_perm = RolePermission(role_id=role_id, permission_id=perm_id)
            self.db.add(role_perm)
        await self.db.commit()

    async def get_permissions(self) -> list[Permission]:
        result = await self.db.execute(select(Permission).order_by(Permission.module, Permission.name))
        return list(result.scalars().all())

    async def create_permission(self, data: PermissionCreate) -> Permission:
        permission = Permission(**data.model_dump())
        self.db.add(permission)
        await self.db.commit()
        await self.db.refresh(permission)
        return permission

    async def assign_role_to_user(
        self, user_id: UUID, role_id: UUID, assigned_by: UUID | None = None
    ) -> UserRole:
        user_role = UserRole(
            user_id=user_id,
            role_id=role_id,
            assigned_by=assigned_by,
        )
        self.db.add(user_role)
        await self.db.commit()
        await self.db.refresh(user_role)
        return user_role

    async def remove_role_from_user(self, user_id: UUID, role_id: UUID) -> bool:
        result = await self.db.execute(
            delete(UserRole).filter(
                UserRole.user_id == user_id,
                UserRole.role_id == role_id,
            )
        )
        await self.db.commit()
        return result.rowcount > 0

    async def get_user_roles(self, user_id: UUID) -> list[Role]:
        result = await self.db.execute(
            select(Role)
            .join(UserRole)
            .filter(UserRole.user_id == user_id)
            .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
        )
        return list(result.scalars().all())

    async def get_user_permissions(self, user_id: UUID) -> list[str]:
        roles = await self.get_user_roles(user_id)
        permission_names = set()
        for role in roles:
            for rp in role.permissions:
                permission_names.add(rp.permission.name)
        return list(permission_names)

    async def user_has_permission(self, user_id: UUID, permission_name: str) -> bool:
        permissions = await self.get_user_permissions(user_id)
        return permission_name in permissions
