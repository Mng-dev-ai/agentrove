import logging
from uuid import UUID
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.db_models.ticket import TicketType, TicketPriority, TicketStatus
from app.models.schemas.ticket import (
    TicketCreate,
    TicketUpdate,
    TicketOut,
    TicketWithDetailsOut,
    TicketCategoryCreate,
    TicketCategoryUpdate,
    TicketCategoryOut,
    TicketCommentCreate,
    TicketCommentUpdate,
    TicketCommentOut,
    TicketCommentWithAuthorOut,
    TicketListFilters,
)
from app.services.ticket_service import TicketService
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


# Category endpoints
@router.get("/categories", response_model=list[TicketCategoryOut])
async def list_categories(
    ticket_type: TicketType | None = None,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> list[TicketCategoryOut]:
    """List ticket categories filtered by user permissions."""
    user, permissions = user_data
    service = TicketService(db)
    categories = await service.get_categories(permissions, ticket_type)
    return [TicketCategoryOut.model_validate(c) for c in categories]


@router.post(
    "/categories", response_model=TicketCategoryOut, status_code=status.HTTP_201_CREATED
)
async def create_category(
    data: TicketCategoryCreate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> TicketCategoryOut:
    """Create a new ticket category (admin only)."""
    user, permissions = user_data
    if "tickets.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = TicketService(db)
    category = await service.create_category(data)
    return TicketCategoryOut.model_validate(category)


@router.patch("/categories/{category_id}", response_model=TicketCategoryOut)
async def update_category(
    category_id: str,
    data: TicketCategoryUpdate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> TicketCategoryOut:
    """Update a ticket category (admin only)."""
    user, permissions = user_data
    if "tickets.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = TicketService(db)
    category = await service.update_category(UUID(category_id), data)
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
    return TicketCategoryOut.model_validate(category)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a ticket category (admin only)."""
    user, permissions = user_data
    if "tickets.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = TicketService(db)
    deleted = await service.delete_category(UUID(category_id))
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )


# Ticket endpoints
@router.get("", response_model=dict)
async def list_tickets(
    ticket_type: TicketType | None = None,
    ticket_status: TicketStatus | None = Query(None, alias="status"),
    priority: TicketPriority | None = None,
    category_id: str | None = None,
    department_id: str | None = None,
    assignee_id: str | None = None,
    requester_id: str | None = None,
    team_id: str | None = None,
    is_private: bool | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List tickets with filtering and pagination."""
    user, permissions = user_data
    service = TicketService(db)

    filters = TicketListFilters(
        ticket_type=ticket_type,
        status=ticket_status,
        priority=priority,
        category_id=UUID(category_id) if category_id else None,
        department_id=UUID(department_id) if department_id else None,
        assignee_id=UUID(assignee_id) if assignee_id else None,
        requester_id=UUID(requester_id) if requester_id else None,
        team_id=UUID(team_id) if team_id else None,
        is_private=is_private,
        search=search,
    )

    tickets, total = await service.get_tickets(
        user.id, permissions, filters, page, page_size
    )

    return {
        "items": [TicketOut.model_validate(t) for t in tickets],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/stats")
async def get_ticket_stats(
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get ticket statistics."""
    user, permissions = user_data
    service = TicketService(db)
    return await service.get_ticket_stats(user.id, permissions)


@router.get("/{ticket_id}", response_model=TicketWithDetailsOut)
async def get_ticket(
    ticket_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> TicketWithDetailsOut:
    """Get a specific ticket with details."""
    user, permissions = user_data
    service = TicketService(db)
    ticket = await service.get_ticket(UUID(ticket_id), user.id, permissions)

    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found or access denied",
        )

    # Get counts and names (would normally join these in the query)
    comments_count = len(ticket.comments) if ticket.comments else 0

    return TicketWithDetailsOut(
        id=ticket.id,
        ticket_number=ticket.ticket_number,
        title=ticket.title,
        description=ticket.description,
        ticket_type=ticket.ticket_type,
        priority=ticket.priority,
        status=ticket.status,
        category_id=ticket.category_id,
        department_id=ticket.department_id,
        project_id=ticket.project_id,
        team_id=ticket.team_id,
        requester_id=ticket.requester_id,
        assignee_id=ticket.assignee_id,
        due_date=ticket.due_date,
        is_private=ticket.is_private,
        resolved_at=ticket.resolved_at,
        closed_at=ticket.closed_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        requester_name="",
        requester_email="",
        assignee_name=None,
        assignee_email=None,
        category_name=None,
        department_name=None,
        team_name=None,
        comments_count=comments_count,
    )


@router.post("", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    data: TicketCreate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    """Create a new ticket."""
    user, permissions = user_data
    service = TicketService(db)

    try:
        ticket = await service.create_ticket(data, user.id, permissions)
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e),
        )

    return TicketOut.model_validate(ticket)


@router.patch("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: str,
    data: TicketUpdate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    """Update a ticket."""
    user, permissions = user_data
    service = TicketService(db)

    try:
        ticket = await service.update_ticket(UUID(ticket_id), data, user.id, permissions)
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e),
        )

    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found",
        )

    return TicketOut.model_validate(ticket)


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ticket(
    ticket_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a ticket (admin only)."""
    user, permissions = user_data
    service = TicketService(db)

    try:
        deleted = await service.delete_ticket(UUID(ticket_id), user.id, permissions)
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e),
        )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found",
        )


# Comment endpoints
@router.get("/{ticket_id}/comments", response_model=list[TicketCommentWithAuthorOut])
async def list_comments(
    ticket_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> list[TicketCommentWithAuthorOut]:
    """List comments for a ticket."""
    user, permissions = user_data
    service = TicketService(db)

    # Verify access
    ticket = await service.get_ticket(UUID(ticket_id), user.id, permissions)
    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found or access denied",
        )

    comments = await service.get_comments(UUID(ticket_id), user.id)
    return [
        TicketCommentWithAuthorOut(
            id=c.id,
            ticket_id=c.ticket_id,
            author_id=c.author_id,
            content=c.content,
            is_internal=c.is_internal,
            created_at=c.created_at,
            updated_at=c.updated_at,
            author_name="",
            author_email="",
        )
        for c in comments
    ]


@router.post(
    "/{ticket_id}/comments",
    response_model=TicketCommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    ticket_id: str,
    data: TicketCommentCreate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> TicketCommentOut:
    """Add a comment to a ticket."""
    user, permissions = user_data
    service = TicketService(db)

    try:
        comment = await service.add_comment(
            UUID(ticket_id), data, user.id, permissions
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e),
        )

    return TicketCommentOut.model_validate(comment)


@router.patch("/{ticket_id}/comments/{comment_id}", response_model=TicketCommentOut)
async def update_comment(
    ticket_id: str,
    comment_id: str,
    data: TicketCommentUpdate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> TicketCommentOut:
    """Update a comment."""
    user, permissions = user_data
    service = TicketService(db)

    comment = await service.update_comment(UUID(comment_id), data, user.id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    return TicketCommentOut.model_validate(comment)


@router.delete("/{ticket_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    ticket_id: str,
    comment_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a comment."""
    user, permissions = user_data
    service = TicketService(db)

    try:
        deleted = await service.delete_comment(UUID(comment_id), user.id, permissions)
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e),
        )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )
