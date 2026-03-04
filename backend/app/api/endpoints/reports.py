import logging
from datetime import date
from uuid import UUID
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.services.reports_service import ReportsService
from app.services.rbac_service import RBACService

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_user_permissions(
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, list[str]]:
    """Get current user with their permissions."""
    rbac_service = RBACService(db)
    permissions = await rbac_service.get_user_permissions(user.id)
    return user, permissions


@router.get("/projects")
async def get_project_report(
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get project statistics report."""
    user, permissions = user_data
    if "reports.view" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reports access required",
        )

    service = ReportsService(db)
    # If not admin/manager, only show user's own projects
    user_id = None
    if "projects.view" not in permissions or "customer" in [p for p in permissions]:
        user_id = user.id

    return await service.get_project_stats(user_id)


@router.get("/time-tracking")
async def get_time_tracking_report(
    start_date: date | None = None,
    end_date: date | None = None,
    user_id: str | None = None,
    project_id: str | None = None,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get time tracking report."""
    user, permissions = user_data
    if "reports.view" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reports access required",
        )

    service = ReportsService(db)

    # Non-managers can only see their own time
    filter_user_id = UUID(user_id) if user_id else None
    if "time.view_all" not in permissions:
        filter_user_id = user.id

    return await service.get_time_tracking_report(
        start_date=start_date,
        end_date=end_date,
        user_id=filter_user_id,
        project_id=UUID(project_id) if project_id else None,
    )


@router.get("/ai-costs")
async def get_ai_cost_report(
    start_date: date | None = None,
    end_date: date | None = None,
    user_id: str | None = None,
    project_id: str | None = None,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get AI cost tracking report."""
    user, permissions = user_data
    if "ai.manage_costs" not in permissions and "reports.advanced" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="AI cost access required",
        )

    service = ReportsService(db)
    return await service.get_ai_cost_report(
        start_date=start_date,
        end_date=end_date,
        user_id=UUID(user_id) if user_id else None,
        project_id=UUID(project_id) if project_id else None,
    )


@router.get("/financial")
async def get_financial_report(
    start_date: date | None = None,
    end_date: date | None = None,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get financial report."""
    user, permissions = user_data
    if "finance.view" not in permissions and "reports.view" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Finance access required",
        )

    service = ReportsService(db)
    return await service.get_financial_report(start_date=start_date, end_date=end_date)


@router.get("/tickets")
async def get_ticket_report(
    start_date: date | None = None,
    end_date: date | None = None,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get ticket statistics report."""
    user, permissions = user_data
    if "reports.view" not in permissions and "tickets.view" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reports or tickets access required",
        )

    service = ReportsService(db)
    return await service.get_ticket_report(start_date=start_date, end_date=end_date)


@router.get("/dashboard/customer")
async def get_customer_dashboard(
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get customer dashboard data."""
    user, permissions = user_data
    service = ReportsService(db)
    return await service.get_customer_dashboard(user.id)


@router.get("/dashboard/manager")
async def get_manager_dashboard(
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get manager dashboard data."""
    user, permissions = user_data
    if "reports.view" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reports access required",
        )

    service = ReportsService(db)
    return await service.get_manager_dashboard()


@router.get("/dashboard/admin")
async def get_admin_dashboard(
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get admin dashboard data."""
    user, permissions = user_data
    if "reports.advanced" not in permissions and "settings.view" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = ReportsService(db)
    return await service.get_admin_dashboard()
