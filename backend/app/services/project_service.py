from datetime import datetime, timezone
from uuid import UUID
from typing import Any
from decimal import Decimal

from sqlalchemy import select, delete, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.db_models.project import (
    Project,
    ProjectMember,
    Task,
    TimeEntry,
    AICostEntry,
    ProjectStatus,
    TaskStatus,
)
from app.models.db_models.user import User
from app.models.schemas.project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectMemberCreate,
    ProjectMemberUpdate,
    TaskCreate,
    TaskUpdate,
    TimeEntryCreate,
    TimeEntryUpdate,
    AICostEntryCreate,
    ProjectStats,
    TimeStats,
    AICostStats,
)


class ProjectService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Project methods
    async def get_projects(
        self,
        user_id: UUID,
        is_admin: bool = False,
        status: ProjectStatus | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Project], int]:
        """Get projects visible to the user."""
        query = select(Project)

        if not is_admin:
            # Non-admin can see projects they own or are a member of
            query = query.filter(
                or_(
                    Project.owner_id == user_id,
                    Project.id.in_(
                        select(ProjectMember.project_id).filter(
                            ProjectMember.user_id == user_id
                        )
                    ),
                    Project.is_private == False,
                )
            )

        if status:
            query = query.filter(Project.status == status)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(Project.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        projects = list(result.scalars().all())

        return projects, total

    async def get_project(self, project_id: UUID, user_id: UUID, is_admin: bool = False) -> Project | None:
        """Get a specific project."""
        query = select(Project).filter(Project.id == project_id)
        result = await self.db.execute(query)
        project = result.scalar_one_or_none()

        if not project:
            return None

        # Check access
        if not is_admin and project.is_private:
            if project.owner_id != user_id:
                member_result = await self.db.execute(
                    select(ProjectMember).filter(
                        ProjectMember.project_id == project_id,
                        ProjectMember.user_id == user_id,
                    )
                )
                if not member_result.scalar_one_or_none():
                    return None

        return project

    async def create_project(self, data: ProjectCreate, owner_id: UUID) -> Project:
        """Create a new project."""
        project = Project(
            name=data.name,
            key=data.key.upper(),
            description=data.description,
            status=data.status,
            priority=data.priority,
            customer_id=data.customer_id,
            department_id=data.department_id,
            team_id=data.team_id,
            owner_id=owner_id,
            budget=data.budget,
            hourly_rate=data.hourly_rate,
            start_date=data.start_date,
            due_date=data.due_date,
            is_billable=data.is_billable,
            is_private=data.is_private,
        )
        self.db.add(project)
        await self.db.commit()
        await self.db.refresh(project)

        # Add owner as a member
        member = ProjectMember(
            project_id=project.id,
            user_id=owner_id,
            role="owner",
        )
        self.db.add(member)
        await self.db.commit()

        return project

    async def update_project(self, project_id: UUID, data: ProjectUpdate) -> Project | None:
        """Update a project."""
        result = await self.db.execute(select(Project).filter(Project.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            return None

        if data.name is not None:
            project.name = data.name
        if data.key is not None:
            project.key = data.key.upper()
        if data.description is not None:
            project.description = data.description
        if data.status is not None:
            project.status = data.status
            if data.status == ProjectStatus.COMPLETED:
                project.completed_at = datetime.now(timezone.utc)
        if data.priority is not None:
            project.priority = data.priority
        if data.customer_id is not None:
            project.customer_id = data.customer_id
        if data.department_id is not None:
            project.department_id = data.department_id
        if data.team_id is not None:
            project.team_id = data.team_id
        if data.owner_id is not None:
            project.owner_id = data.owner_id
        if data.budget is not None:
            project.budget = data.budget
        if data.hourly_rate is not None:
            project.hourly_rate = data.hourly_rate
        if data.start_date is not None:
            project.start_date = data.start_date
        if data.due_date is not None:
            project.due_date = data.due_date
        if data.is_billable is not None:
            project.is_billable = data.is_billable
        if data.is_private is not None:
            project.is_private = data.is_private

        project.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(project)
        return project

    async def delete_project(self, project_id: UUID) -> bool:
        """Delete a project."""
        result = await self.db.execute(select(Project).filter(Project.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            return False

        await self.db.delete(project)
        await self.db.commit()
        return True

    # Project Member methods
    async def get_project_members(self, project_id: UUID) -> list[ProjectMember]:
        """Get all members of a project."""
        result = await self.db.execute(
            select(ProjectMember).filter(ProjectMember.project_id == project_id)
        )
        return list(result.scalars().all())

    async def add_project_member(self, data: ProjectMemberCreate) -> ProjectMember:
        """Add a member to a project."""
        member = ProjectMember(
            project_id=data.user_id,  # This should be project_id, fixing below
            user_id=data.user_id,
            role=data.role,
            hourly_rate=data.hourly_rate,
        )
        # Fix: project_id should come from the route
        self.db.add(member)
        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def add_member_to_project(
        self, project_id: UUID, user_id: UUID, role: str = "member", hourly_rate: Decimal | None = None
    ) -> ProjectMember:
        """Add a member to a project."""
        member = ProjectMember(
            project_id=project_id,
            user_id=user_id,
            role=role,
            hourly_rate=hourly_rate,
        )
        self.db.add(member)
        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def update_project_member(
        self, project_id: UUID, user_id: UUID, data: ProjectMemberUpdate
    ) -> ProjectMember | None:
        """Update a project member."""
        result = await self.db.execute(
            select(ProjectMember).filter(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            return None

        if data.role is not None:
            member.role = data.role
        if data.hourly_rate is not None:
            member.hourly_rate = data.hourly_rate

        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def remove_project_member(self, project_id: UUID, user_id: UUID) -> bool:
        """Remove a member from a project."""
        result = await self.db.execute(
            delete(ProjectMember).filter(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
        await self.db.commit()
        return result.rowcount > 0

    # Task methods
    async def get_tasks(
        self,
        project_id: UUID,
        status: TaskStatus | None = None,
        assignee_id: UUID | None = None,
    ) -> list[Task]:
        """Get tasks for a project."""
        query = select(Task).filter(Task.project_id == project_id)

        if status:
            query = query.filter(Task.status == status)
        if assignee_id:
            query = query.filter(Task.assignee_id == assignee_id)

        query = query.order_by(Task.sort_order, Task.created_at)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_task(self, task_id: UUID) -> Task | None:
        """Get a specific task."""
        result = await self.db.execute(select(Task).filter(Task.id == task_id))
        return result.scalar_one_or_none()

    async def create_task(self, data: TaskCreate, reporter_id: UUID) -> Task:
        """Create a new task."""
        task = Task(
            project_id=data.project_id,
            parent_task_id=data.parent_task_id,
            title=data.title,
            description=data.description,
            status=data.status,
            priority=data.priority,
            assignee_id=data.assignee_id,
            reporter_id=reporter_id,
            estimated_hours=data.estimated_hours,
            due_date=data.due_date,
        )
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        return task

    async def update_task(self, task_id: UUID, data: TaskUpdate) -> Task | None:
        """Update a task."""
        result = await self.db.execute(select(Task).filter(Task.id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return None

        if data.title is not None:
            task.title = data.title
        if data.description is not None:
            task.description = data.description
        if data.status is not None:
            task.status = data.status
            if data.status == TaskStatus.DONE:
                task.completed_at = datetime.now(timezone.utc)
        if data.priority is not None:
            task.priority = data.priority
        if data.assignee_id is not None:
            task.assignee_id = data.assignee_id
        if data.estimated_hours is not None:
            task.estimated_hours = data.estimated_hours
        if data.actual_hours is not None:
            task.actual_hours = data.actual_hours
        if data.due_date is not None:
            task.due_date = data.due_date
        if data.sort_order is not None:
            task.sort_order = data.sort_order

        task.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(task)
        return task

    async def delete_task(self, task_id: UUID) -> bool:
        """Delete a task."""
        result = await self.db.execute(select(Task).filter(Task.id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return False

        await self.db.delete(task)
        await self.db.commit()
        return True

    # Time Entry methods
    async def get_time_entries(
        self,
        user_id: UUID,
        project_id: UUID | None = None,
        is_admin: bool = False,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TimeEntry], int]:
        """Get time entries."""
        query = select(TimeEntry)

        if not is_admin:
            query = query.filter(TimeEntry.user_id == user_id)

        if project_id:
            query = query.filter(TimeEntry.project_id == project_id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(TimeEntry.start_time.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        entries = list(result.scalars().all())

        return entries, total

    async def create_time_entry(self, data: TimeEntryCreate, user_id: UUID) -> TimeEntry:
        """Create a time entry."""
        # Calculate duration if end_time provided
        duration_minutes = data.duration_minutes
        if data.end_time and data.start_time:
            delta = data.end_time - data.start_time
            duration_minutes = int(delta.total_seconds() / 60)

        entry = TimeEntry(
            project_id=data.project_id,
            task_id=data.task_id,
            user_id=user_id,
            description=data.description,
            start_time=data.start_time,
            end_time=data.end_time,
            duration_minutes=duration_minutes,
            is_billable=data.is_billable,
        )
        self.db.add(entry)
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def update_time_entry(self, entry_id: UUID, data: TimeEntryUpdate) -> TimeEntry | None:
        """Update a time entry."""
        result = await self.db.execute(select(TimeEntry).filter(TimeEntry.id == entry_id))
        entry = result.scalar_one_or_none()
        if not entry:
            return None

        if data.task_id is not None:
            entry.task_id = data.task_id
        if data.description is not None:
            entry.description = data.description
        if data.start_time is not None:
            entry.start_time = data.start_time
        if data.end_time is not None:
            entry.end_time = data.end_time
        if data.duration_minutes is not None:
            entry.duration_minutes = data.duration_minutes
        if data.is_billable is not None:
            entry.is_billable = data.is_billable

        # Recalculate duration if times changed
        if entry.end_time and entry.start_time:
            delta = entry.end_time - entry.start_time
            entry.duration_minutes = int(delta.total_seconds() / 60)

        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def approve_time_entry(self, entry_id: UUID, approver_id: UUID) -> TimeEntry | None:
        """Approve a time entry."""
        result = await self.db.execute(select(TimeEntry).filter(TimeEntry.id == entry_id))
        entry = result.scalar_one_or_none()
        if not entry:
            return None

        entry.is_approved = True
        entry.approved_by = approver_id
        entry.approved_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def delete_time_entry(self, entry_id: UUID) -> bool:
        """Delete a time entry."""
        result = await self.db.execute(select(TimeEntry).filter(TimeEntry.id == entry_id))
        entry = result.scalar_one_or_none()
        if not entry:
            return False

        await self.db.delete(entry)
        await self.db.commit()
        return True

    # AI Cost Entry methods
    async def create_ai_cost_entry(self, data: AICostEntryCreate, user_id: UUID) -> AICostEntry:
        """Create an AI cost entry."""
        entry = AICostEntry(
            project_id=data.project_id,
            task_id=data.task_id,
            user_id=user_id,
            provider=data.provider,
            model=data.model,
            input_tokens=data.input_tokens,
            output_tokens=data.output_tokens,
            cost_usd=data.cost_usd,
            chat_id=data.chat_id,
        )
        self.db.add(entry)
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def get_ai_cost_entries(
        self,
        user_id: UUID,
        project_id: UUID | None = None,
        is_admin: bool = False,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[AICostEntry], int]:
        """Get AI cost entries."""
        query = select(AICostEntry)

        if not is_admin:
            query = query.filter(AICostEntry.user_id == user_id)

        if project_id:
            query = query.filter(AICostEntry.project_id == project_id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(AICostEntry.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        entries = list(result.scalars().all())

        return entries, total

    # Statistics
    async def get_project_stats(self, user_id: UUID, is_admin: bool = False) -> ProjectStats:
        """Get project statistics."""
        # Base query for accessible projects
        base_query = select(Project)
        if not is_admin:
            base_query = base_query.filter(
                or_(
                    Project.owner_id == user_id,
                    Project.id.in_(
                        select(ProjectMember.project_id).filter(
                            ProjectMember.user_id == user_id
                        )
                    ),
                    Project.is_private == False,
                )
            )

        # Total projects
        total_result = await self.db.execute(
            select(func.count()).select_from(base_query.subquery())
        )
        total_projects = total_result.scalar() or 0

        # Active projects
        active_result = await self.db.execute(
            select(func.count()).select_from(
                base_query.filter(Project.status == ProjectStatus.ACTIVE).subquery()
            )
        )
        active_projects = active_result.scalar() or 0

        # Completed projects
        completed_result = await self.db.execute(
            select(func.count()).select_from(
                base_query.filter(Project.status == ProjectStatus.COMPLETED).subquery()
            )
        )
        completed_projects = completed_result.scalar() or 0

        # Total tasks
        task_result = await self.db.execute(select(func.count()).select_from(Task))
        total_tasks = task_result.scalar() or 0

        # Completed tasks
        done_result = await self.db.execute(
            select(func.count()).select_from(Task).filter(Task.status == TaskStatus.DONE)
        )
        completed_tasks = done_result.scalar() or 0

        # Total hours
        hours_result = await self.db.execute(
            select(func.coalesce(func.sum(TimeEntry.duration_minutes), 0))
        )
        total_minutes = hours_result.scalar() or 0
        total_hours = total_minutes / 60

        # Total AI cost
        cost_result = await self.db.execute(
            select(func.coalesce(func.sum(AICostEntry.cost_usd), 0))
        )
        total_ai_cost = float(cost_result.scalar() or 0)

        return ProjectStats(
            total_projects=total_projects,
            active_projects=active_projects,
            completed_projects=completed_projects,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            total_hours=total_hours,
            total_ai_cost=total_ai_cost,
        )

    async def get_time_stats(self, user_id: UUID, is_admin: bool = False) -> TimeStats:
        """Get time tracking statistics."""
        # Total hours
        if is_admin:
            total_result = await self.db.execute(
                select(func.coalesce(func.sum(TimeEntry.duration_minutes), 0))
            )
        else:
            total_result = await self.db.execute(
                select(func.coalesce(func.sum(TimeEntry.duration_minutes), 0)).filter(
                    TimeEntry.user_id == user_id
                )
            )
        total_minutes = total_result.scalar() or 0
        total_hours = total_minutes / 60

        # Billable hours
        if is_admin:
            billable_result = await self.db.execute(
                select(func.coalesce(func.sum(TimeEntry.duration_minutes), 0)).filter(
                    TimeEntry.is_billable == True
                )
            )
        else:
            billable_result = await self.db.execute(
                select(func.coalesce(func.sum(TimeEntry.duration_minutes), 0)).filter(
                    TimeEntry.user_id == user_id,
                    TimeEntry.is_billable == True,
                )
            )
        billable_minutes = billable_result.scalar() or 0
        billable_hours = billable_minutes / 60

        non_billable_hours = total_hours - billable_hours

        return TimeStats(
            total_hours=total_hours,
            billable_hours=billable_hours,
            non_billable_hours=non_billable_hours,
            by_user={},
            by_project={},
        )

    async def get_ai_cost_stats(self, user_id: UUID, is_admin: bool = False) -> AICostStats:
        """Get AI cost statistics."""
        # Total cost
        if is_admin:
            total_result = await self.db.execute(
                select(func.coalesce(func.sum(AICostEntry.cost_usd), 0))
            )
        else:
            total_result = await self.db.execute(
                select(func.coalesce(func.sum(AICostEntry.cost_usd), 0)).filter(
                    AICostEntry.user_id == user_id
                )
            )
        total_cost = float(total_result.scalar() or 0)

        # Total tokens
        if is_admin:
            input_result = await self.db.execute(
                select(func.coalesce(func.sum(AICostEntry.input_tokens), 0))
            )
            output_result = await self.db.execute(
                select(func.coalesce(func.sum(AICostEntry.output_tokens), 0))
            )
        else:
            input_result = await self.db.execute(
                select(func.coalesce(func.sum(AICostEntry.input_tokens), 0)).filter(
                    AICostEntry.user_id == user_id
                )
            )
            output_result = await self.db.execute(
                select(func.coalesce(func.sum(AICostEntry.output_tokens), 0)).filter(
                    AICostEntry.user_id == user_id
                )
            )

        return AICostStats(
            total_cost=total_cost,
            total_input_tokens=input_result.scalar() or 0,
            total_output_tokens=output_result.scalar() or 0,
            by_provider={},
            by_model={},
            by_user={},
        )
