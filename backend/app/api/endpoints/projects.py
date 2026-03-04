import logging
from uuid import UUID
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.db_models.project import ProjectStatus, TaskStatus
from app.models.schemas.project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectOut,
    ProjectWithDetailsOut,
    ProjectMemberCreate,
    ProjectMemberUpdate,
    ProjectMemberOut,
    ProjectMemberWithUserOut,
    TaskCreate,
    TaskUpdate,
    TaskOut,
    TaskWithDetailsOut,
    TimeEntryCreate,
    TimeEntryUpdate,
    TimeEntryOut,
    TimeEntryWithUserOut,
    AICostEntryCreate,
    AICostEntryOut,
    ProjectStats,
    TimeStats,
    AICostStats,
)
from app.services.project_service import ProjectService

logger = logging.getLogger(__name__)
router = APIRouter()


def get_user_context(
    user: User = Depends(current_active_user),
) -> tuple[User, bool]:
    """Get current user and admin status."""
    return user, user.is_superuser


# Project endpoints
@router.get("", response_model=dict)
async def list_projects(
    project_status: ProjectStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List projects."""
    user, is_admin = context
    service = ProjectService(db)
    projects, total = await service.get_projects(
        user.id, is_admin, project_status, page, page_size
    )

    return {
        "items": [ProjectOut.model_validate(p) for p in projects],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/stats", response_model=ProjectStats)
async def get_project_stats(
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> ProjectStats:
    """Get project statistics."""
    user, is_admin = context
    service = ProjectService(db)
    return await service.get_project_stats(user.id, is_admin)


@router.get("/{project_id}", response_model=ProjectWithDetailsOut)
async def get_project(
    project_id: str,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> ProjectWithDetailsOut:
    """Get a specific project with details."""
    user, is_admin = context
    service = ProjectService(db)
    project = await service.get_project(UUID(project_id), user.id, is_admin)

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found or access denied",
        )

    return ProjectWithDetailsOut(
        id=project.id,
        name=project.name,
        key=project.key,
        description=project.description,
        status=project.status,
        priority=project.priority,
        customer_id=project.customer_id,
        department_id=project.department_id,
        team_id=project.team_id,
        owner_id=project.owner_id,
        budget=project.budget,
        hourly_rate=project.hourly_rate,
        start_date=project.start_date,
        due_date=project.due_date,
        is_billable=project.is_billable,
        is_private=project.is_private,
        completed_at=project.completed_at,
        created_at=project.created_at,
        updated_at=project.updated_at,
        owner_name="",
        owner_email="",
        customer_name=None,
        department_name=None,
        team_name=None,
        members_count=0,
        tasks_count=0,
        completed_tasks=0,
        total_hours=0,
    )


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    """Create a new project."""
    user, is_admin = context
    service = ProjectService(db)

    try:
        project = await service.create_project(data, user.id)
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Project key already exists",
            )
        raise

    return ProjectOut.model_validate(project)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    """Update a project."""
    user, is_admin = context
    service = ProjectService(db)

    # Check access
    project = await service.get_project(UUID(project_id), user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found or access denied",
        )

    try:
        updated = await service.update_project(UUID(project_id), data)
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Project key already exists",
            )
        raise

    return ProjectOut.model_validate(updated)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a project (owner or admin only)."""
    user, is_admin = context
    service = ProjectService(db)

    project = await service.get_project(UUID(project_id), user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user.id and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project owner or admin can delete the project",
        )

    await service.delete_project(UUID(project_id))


# Project Member endpoints
@router.get("/{project_id}/members", response_model=list[ProjectMemberWithUserOut])
async def list_project_members(
    project_id: str,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectMemberWithUserOut]:
    """List project members."""
    user, is_admin = context
    service = ProjectService(db)

    project = await service.get_project(UUID(project_id), user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    members = await service.get_project_members(UUID(project_id))
    return [
        ProjectMemberWithUserOut(
            id=m.id,
            project_id=m.project_id,
            user_id=m.user_id,
            role=m.role,
            hourly_rate=m.hourly_rate,
            joined_at=m.joined_at,
            user_name="",
            user_email="",
            user_display_name=None,
        )
        for m in members
    ]


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_project_member(
    project_id: str,
    data: ProjectMemberCreate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> ProjectMemberOut:
    """Add a member to a project."""
    user, is_admin = context
    service = ProjectService(db)

    project = await service.get_project(UUID(project_id), user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user.id and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project owner or admin can add members",
        )

    member = await service.add_member_to_project(
        UUID(project_id), data.user_id, data.role, data.hourly_rate
    )
    return ProjectMemberOut.model_validate(member)


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_member(
    project_id: str,
    user_id: str,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a member from a project."""
    user, is_admin = context
    service = ProjectService(db)

    project = await service.get_project(UUID(project_id), user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user.id and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project owner or admin can remove members",
        )

    removed = await service.remove_project_member(UUID(project_id), UUID(user_id))
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )


# Task endpoints
@router.get("/{project_id}/tasks", response_model=list[TaskWithDetailsOut])
async def list_project_tasks(
    project_id: str,
    task_status: TaskStatus | None = Query(None, alias="status"),
    assignee_id: str | None = None,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> list[TaskWithDetailsOut]:
    """List project tasks."""
    user, is_admin = context
    service = ProjectService(db)

    project = await service.get_project(UUID(project_id), user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    assignee_uuid = UUID(assignee_id) if assignee_id else None
    tasks = await service.get_tasks(UUID(project_id), task_status, assignee_uuid)
    return [
        TaskWithDetailsOut(
            id=t.id,
            project_id=t.project_id,
            parent_task_id=t.parent_task_id,
            title=t.title,
            description=t.description,
            status=t.status,
            priority=t.priority,
            assignee_id=t.assignee_id,
            reporter_id=t.reporter_id,
            estimated_hours=t.estimated_hours,
            actual_hours=t.actual_hours,
            due_date=t.due_date,
            completed_at=t.completed_at,
            sort_order=t.sort_order,
            created_at=t.created_at,
            updated_at=t.updated_at,
            project_name=project.name,
            assignee_name=None,
            assignee_email=None,
            reporter_name="",
            reporter_email="",
            subtasks_count=0,
            time_entries_count=0,
            total_hours=0,
        )
        for t in tasks
    ]


@router.post("/{project_id}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(
    project_id: str,
    data: TaskCreate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """Create a new task."""
    user, is_admin = context
    service = ProjectService(db)

    project = await service.get_project(UUID(project_id), user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    task_data = TaskCreate(
        project_id=UUID(project_id),
        parent_task_id=data.parent_task_id,
        title=data.title,
        description=data.description,
        status=data.status,
        priority=data.priority,
        assignee_id=data.assignee_id,
        estimated_hours=data.estimated_hours,
        due_date=data.due_date,
    )

    task = await service.create_task(task_data, user.id)
    return TaskOut.model_validate(task)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """Update a task."""
    user, is_admin = context
    service = ProjectService(db)

    task = await service.get_task(UUID(task_id))
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Check project access
    project = await service.get_project(task.project_id, user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    updated = await service.update_task(UUID(task_id), data)
    return TaskOut.model_validate(updated)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a task."""
    user, is_admin = context
    service = ProjectService(db)

    task = await service.get_task(UUID(task_id))
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    project = await service.get_project(task.project_id, user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    await service.delete_task(UUID(task_id))


# Time Entry endpoints
@router.get("/time-entries", response_model=dict)
async def list_time_entries(
    project_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List time entries."""
    user, is_admin = context
    service = ProjectService(db)

    project_uuid = UUID(project_id) if project_id else None
    entries, total = await service.get_time_entries(
        user.id, project_uuid, is_admin, page, page_size
    )

    return {
        "items": [TimeEntryWithUserOut(
            id=e.id,
            project_id=e.project_id,
            task_id=e.task_id,
            user_id=e.user_id,
            description=e.description,
            start_time=e.start_time,
            end_time=e.end_time,
            duration_minutes=e.duration_minutes,
            is_billable=e.is_billable,
            is_approved=e.is_approved,
            approved_by=e.approved_by,
            approved_at=e.approved_at,
            created_at=e.created_at,
            user_name="",
            user_email="",
            project_name="",
            task_title=None,
        ) for e in entries],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.post("/time-entries", response_model=TimeEntryOut, status_code=status.HTTP_201_CREATED)
async def create_time_entry(
    data: TimeEntryCreate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryOut:
    """Create a time entry."""
    user, is_admin = context
    service = ProjectService(db)

    # Check project access
    project = await service.get_project(data.project_id, user.id, is_admin)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found or access denied",
        )

    entry = await service.create_time_entry(data, user.id)
    return TimeEntryOut.model_validate(entry)


@router.patch("/time-entries/{entry_id}", response_model=TimeEntryOut)
async def update_time_entry(
    entry_id: str,
    data: TimeEntryUpdate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryOut:
    """Update a time entry."""
    user, is_admin = context
    service = ProjectService(db)

    updated = await service.update_time_entry(UUID(entry_id), data)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Time entry not found",
        )

    return TimeEntryOut.model_validate(updated)


@router.post("/time-entries/{entry_id}/approve", response_model=TimeEntryOut)
async def approve_time_entry(
    entry_id: str,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> TimeEntryOut:
    """Approve a time entry (manager+ only)."""
    user, is_admin = context
    service = ProjectService(db)

    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    updated = await service.approve_time_entry(UUID(entry_id), user.id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Time entry not found",
        )

    return TimeEntryOut.model_validate(updated)


@router.delete("/time-entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_time_entry(
    entry_id: str,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a time entry."""
    user, is_admin = context
    service = ProjectService(db)

    deleted = await service.delete_time_entry(UUID(entry_id))
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Time entry not found",
        )


# AI Cost endpoints
@router.get("/ai-costs", response_model=dict)
async def list_ai_costs(
    project_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List AI cost entries."""
    user, is_admin = context
    service = ProjectService(db)

    project_uuid = UUID(project_id) if project_id else None
    entries, total = await service.get_ai_cost_entries(
        user.id, project_uuid, is_admin, page, page_size
    )

    return {
        "items": [AICostEntryOut.model_validate(e) for e in entries],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.post("/ai-costs", response_model=AICostEntryOut, status_code=status.HTTP_201_CREATED)
async def create_ai_cost(
    data: AICostEntryCreate,
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> AICostEntryOut:
    """Create an AI cost entry."""
    user, _ = context
    service = ProjectService(db)

    entry = await service.create_ai_cost_entry(data, user.id)
    return AICostEntryOut.model_validate(entry)


@router.get("/time-stats", response_model=TimeStats)
async def get_time_stats(
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> TimeStats:
    """Get time tracking statistics."""
    user, is_admin = context
    service = ProjectService(db)
    return await service.get_time_stats(user.id, is_admin)


@router.get("/ai-cost-stats", response_model=AICostStats)
async def get_ai_cost_stats(
    context: tuple[User, bool] = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
) -> AICostStats:
    """Get AI cost statistics."""
    user, is_admin = context
    service = ProjectService(db)
    return await service.get_ai_cost_stats(user.id, is_admin)
