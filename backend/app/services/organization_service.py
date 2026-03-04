from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.db_models.organization import Department, Team, TeamMember
from app.models.db_models.user import User
from app.models.schemas.organization import (
    DepartmentCreate,
    DepartmentUpdate,
    TeamCreate,
    TeamUpdate,
    TeamMemberCreate,
    TeamMemberUpdate,
)


class OrganizationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Department methods
    async def get_departments(self) -> list[Department]:
        result = await self.db.execute(
            select(Department)
            .options(selectinload(Department.teams))
            .order_by(Department.name)
        )
        return list(result.scalars().all())

    async def get_department(self, department_id: UUID) -> Department | None:
        result = await self.db.execute(
            select(Department)
            .options(selectinload(Department.teams))
            .filter(Department.id == department_id)
        )
        return result.scalar_one_or_none()

    async def create_department(self, data: DepartmentCreate) -> Department:
        department = Department(
            name=data.name,
            description=data.description,
            parent_id=data.parent_id,
            manager_id=data.manager_id,
        )
        self.db.add(department)
        await self.db.commit()
        await self.db.refresh(department)
        return department

    async def update_department(
        self, department_id: UUID, data: DepartmentUpdate
    ) -> Department | None:
        result = await self.db.execute(
            select(Department).filter(Department.id == department_id)
        )
        department = result.scalar_one_or_none()
        if not department:
            return None

        if data.name is not None:
            department.name = data.name
        if data.description is not None:
            department.description = data.description
        if data.parent_id is not None:
            department.parent_id = data.parent_id
        if data.manager_id is not None:
            department.manager_id = data.manager_id
        if data.is_active is not None:
            department.is_active = data.is_active

        department.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(department)
        return department

    async def delete_department(self, department_id: UUID) -> bool:
        result = await self.db.execute(
            select(Department).filter(Department.id == department_id)
        )
        department = result.scalar_one_or_none()
        if not department:
            return False

        await self.db.delete(department)
        await self.db.commit()
        return True

    async def get_department_tree(self) -> list[dict]:
        """Get department hierarchy as a tree structure."""
        result = await self.db.execute(
            select(Department).order_by(Department.name)
        )
        departments = list(result.scalars().all())

        # Get team counts
        team_counts = {}
        for dept in departments:
            count_result = await self.db.execute(
                select(func.count()).select_from(Team).filter(
                    Team.department_id == dept.id,
                    Team.is_active == True,
                )
            )
            team_counts[str(dept.id)] = count_result.scalar() or 0

        # Build tree
        dept_map = {str(d.id): d for d in departments}
        root_depts = []

        for dept in departments:
            dept_dict = {
                "id": str(dept.id),
                "name": dept.name,
                "description": dept.description,
                "parent_id": str(dept.parent_id) if dept.parent_id else None,
                "manager_id": str(dept.manager_id) if dept.manager_id else None,
                "is_active": dept.is_active,
                "teams_count": team_counts.get(str(dept.id), 0),
                "children": [],
            }

            if dept.parent_id and str(dept.parent_id) in dept_map:
                pass  # Will be added as child
            else:
                root_depts.append(dept_dict)

        # Add children to parents
        for dept in departments:
            if dept.parent_id and str(dept.parent_id) in dept_map:
                for root in root_depts:
                    self._add_child_to_tree(root, dept, team_counts)

        return root_depts

    def _add_child_to_tree(
        self, tree: dict, dept: Department, team_counts: dict
    ) -> bool:
        if tree["id"] == str(dept.parent_id):
            tree["children"].append({
                "id": str(dept.id),
                "name": dept.name,
                "description": dept.description,
                "parent_id": str(dept.parent_id) if dept.parent_id else None,
                "manager_id": str(dept.manager_id) if dept.manager_id else None,
                "is_active": dept.is_active,
                "teams_count": team_counts.get(str(dept.id), 0),
                "children": [],
            })
            return True

        for child in tree.get("children", []):
            if self._add_child_to_tree(child, dept, team_counts):
                return True

        return False

    # Team methods
    async def get_teams(self, department_id: UUID | None = None) -> list[Team]:
        query = select(Team).options(
            selectinload(Team.members),
            selectinload(Team.department),
        )
        if department_id:
            query = query.filter(Team.department_id == department_id)
        query = query.order_by(Team.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_team(self, team_id: UUID) -> Team | None:
        result = await self.db.execute(
            select(Team)
            .options(
                selectinload(Team.members),
                selectinload(Team.department),
            )
            .filter(Team.id == team_id)
        )
        return result.scalar_one_or_none()

    async def create_team(self, data: TeamCreate) -> Team:
        team = Team(
            name=data.name,
            description=data.description,
            department_id=data.department_id,
            lead_id=data.lead_id,
        )
        self.db.add(team)
        await self.db.commit()
        await self.db.refresh(team)
        return team

    async def update_team(self, team_id: UUID, data: TeamUpdate) -> Team | None:
        result = await self.db.execute(select(Team).filter(Team.id == team_id))
        team = result.scalar_one_or_none()
        if not team:
            return None

        if data.name is not None:
            team.name = data.name
        if data.description is not None:
            team.description = data.description
        if data.department_id is not None:
            team.department_id = data.department_id
        if data.lead_id is not None:
            team.lead_id = data.lead_id
        if data.is_active is not None:
            team.is_active = data.is_active

        team.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(team)
        return team

    async def delete_team(self, team_id: UUID) -> bool:
        result = await self.db.execute(select(Team).filter(Team.id == team_id))
        team = result.scalar_one_or_none()
        if not team:
            return False

        await self.db.delete(team)
        await self.db.commit()
        return True

    # Team member methods
    async def add_team_member(
        self, team_id: UUID, data: TeamMemberCreate
    ) -> TeamMember:
        member = TeamMember(
            team_id=team_id,
            user_id=data.user_id,
            role=data.role,
        )
        self.db.add(member)
        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def update_team_member(
        self, team_id: UUID, user_id: UUID, data: TeamMemberUpdate
    ) -> TeamMember | None:
        result = await self.db.execute(
            select(TeamMember).filter(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            return None

        if data.role is not None:
            member.role = data.role

        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def remove_team_member(self, team_id: UUID, user_id: UUID) -> bool:
        result = await self.db.execute(
            delete(TeamMember).filter(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id,
            )
        )
        await self.db.commit()
        return result.rowcount > 0

    async def get_user_teams(self, user_id: UUID) -> list[Team]:
        result = await self.db.execute(
            select(Team)
            .join(TeamMember)
            .filter(TeamMember.user_id == user_id)
            .options(selectinload(Team.department))
        )
        return list(result.scalars().all())
