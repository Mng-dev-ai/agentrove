import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.db_models.organization import Department, Team, TeamMember
from app.models.schemas.organization import (
    DepartmentCreate,
    DepartmentUpdate,
    DepartmentOut,
    DepartmentWithChildrenOut,
    TeamCreate,
    TeamUpdate,
    TeamOut,
    TeamWithMembersOut,
    TeamMemberCreate,
    TeamMemberUpdate,
    TeamMemberOut,
    TeamMemberWithUserOut,
)
from app.services.organization_service import OrganizationService

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_admin_user(user: User = Depends(current_active_user)) -> User:
    """Dependency that ensures the current user is a superuser."""
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


# Department endpoints
@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[DepartmentOut]:
    """List all departments."""
    service = OrganizationService(db)
    departments = await service.get_departments()
    return [DepartmentOut.model_validate(d) for d in departments]


@router.get("/departments/tree")
async def get_department_tree(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Get department hierarchy as a tree structure."""
    service = OrganizationService(db)
    return await service.get_department_tree()


@router.get("/departments/{department_id}", response_model=DepartmentOut)
async def get_department(
    department_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> DepartmentOut:
    """Get a specific department."""
    service = OrganizationService(db)
    department = await service.get_department(UUID(department_id))
    if not department:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Department not found",
        )
    return DepartmentOut.model_validate(department)


@router.post(
    "/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED
)
async def create_department(
    data: DepartmentCreate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> DepartmentOut:
    """Create a new department."""
    service = OrganizationService(db)
    department = await service.create_department(data)
    return DepartmentOut.model_validate(department)


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: str,
    data: DepartmentUpdate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> DepartmentOut:
    """Update a department."""
    service = OrganizationService(db)
    department = await service.update_department(UUID(department_id), data)
    if not department:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Department not found",
        )
    return DepartmentOut.model_validate(department)


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_department(
    department_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a department."""
    service = OrganizationService(db)
    deleted = await service.delete_department(UUID(department_id))
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Department not found",
        )


# Team endpoints
@router.get("/teams", response_model=list[TeamWithMembersOut])
async def list_teams(
    department_id: str | None = None,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[TeamWithMembersOut]:
    """List all teams, optionally filtered by department."""
    service = OrganizationService(db)
    dept_uuid = UUID(department_id) if department_id else None
    teams = await service.get_teams(dept_uuid)
    return [
        TeamWithMembersOut(
            id=team.id,
            name=team.name,
            description=team.description,
            department_id=team.department_id,
            lead_id=team.lead_id,
            is_active=team.is_active,
            created_at=team.created_at,
            updated_at=team.updated_at,
            department_name=team.department.name if team.department else None,
            members=[
                TeamMemberWithUserOut(
                    id=m.id,
                    team_id=m.team_id,
                    user_id=m.user_id,
                    role=m.role,
                    joined_at=m.joined_at,
                    user_email="",  # Would need to load user
                    user_name="",
                    user_display_name=None,
                )
                for m in team.members
            ],
        )
        for team in teams
    ]


@router.get("/teams/{team_id}", response_model=TeamWithMembersOut)
async def get_team(
    team_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> TeamWithMembersOut:
    """Get a specific team with members."""
    service = OrganizationService(db)
    team = await service.get_team(UUID(team_id))
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )
    return TeamWithMembersOut(
        id=team.id,
        name=team.name,
        description=team.description,
        department_id=team.department_id,
        lead_id=team.lead_id,
        is_active=team.is_active,
        created_at=team.created_at,
        updated_at=team.updated_at,
        department_name=team.department.name if team.department else None,
        members=[
            TeamMemberWithUserOut(
                id=m.id,
                team_id=m.team_id,
                user_id=m.user_id,
                role=m.role,
                joined_at=m.joined_at,
                user_email="",
                user_name="",
                user_display_name=None,
            )
            for m in team.members
        ],
    )


@router.post("/teams", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
async def create_team(
    data: TeamCreate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> TeamOut:
    """Create a new team."""
    service = OrganizationService(db)
    team = await service.create_team(data)
    return TeamOut.model_validate(team)


@router.patch("/teams/{team_id}", response_model=TeamOut)
async def update_team(
    team_id: str,
    data: TeamUpdate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> TeamOut:
    """Update a team."""
    service = OrganizationService(db)
    team = await service.update_team(UUID(team_id), data)
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )
    return TeamOut.model_validate(team)


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    team_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a team."""
    service = OrganizationService(db)
    deleted = await service.delete_team(UUID(team_id))
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )


# Team member endpoints
@router.post(
    "/teams/{team_id}/members",
    response_model=TeamMemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_team_member(
    team_id: str,
    data: TeamMemberCreate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> TeamMemberOut:
    """Add a member to a team."""
    service = OrganizationService(db)
    try:
        member = await service.add_team_member(UUID(team_id), data)
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is already a member of this team",
            )
        raise
    return TeamMemberOut.model_validate(member)


@router.patch(
    "/teams/{team_id}/members/{user_id}", response_model=TeamMemberOut
)
async def update_team_member(
    team_id: str,
    user_id: str,
    data: TeamMemberUpdate,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> TeamMemberOut:
    """Update a team member's role."""
    service = OrganizationService(db)
    member = await service.update_team_member(UUID(team_id), UUID(user_id), data)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team member not found",
        )
    return TeamMemberOut.model_validate(member)


@router.delete(
    "/teams/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_team_member(
    team_id: str,
    user_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a member from a team."""
    service = OrganizationService(db)
    removed = await service.remove_team_member(UUID(team_id), UUID(user_id))
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team member not found",
        )


@router.get("/users/{user_id}/teams", response_model=list[TeamOut])
async def get_user_teams(
    user_id: str,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[TeamOut]:
    """Get all teams a user belongs to."""
    service = OrganizationService(db)
    teams = await service.get_user_teams(UUID(user_id))
    return [TeamOut.model_validate(t) for t in teams]
