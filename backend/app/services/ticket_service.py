from datetime import datetime, timezone
from uuid import UUID
from typing import Any

from sqlalchemy import select, delete, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.db_models.ticket import (
    Ticket,
    TicketCategory,
    TicketComment,
    TicketAttachment,
    TicketStatusHistory,
    TicketType,
    TicketPriority,
    TicketStatus,
)
from app.models.db_models.user import User
from app.models.schemas.ticket import (
    TicketCreate,
    TicketUpdate,
    TicketCategoryCreate,
    TicketCategoryUpdate,
    TicketCommentCreate,
    TicketCommentUpdate,
    TicketListFilters,
)
from app.services.rbac_service import RBACService


class TicketService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _can_access_ticket_type(self, user_permissions: list[str], ticket_type: TicketType) -> bool:
        """Check if user can access a specific ticket type based on permissions."""
        if ticket_type == TicketType.ADMIN:
            return "tickets.admin" in user_permissions
        elif ticket_type == TicketType.MANAGER:
            return "tickets.admin" in user_permissions or "tickets.manage_all" in user_permissions
        elif ticket_type == TicketType.DEPARTMENT:
            return (
                "tickets.admin" in user_permissions
                or "tickets.manage_all" in user_permissions
                or "tickets.department" in user_permissions
                or "tickets.view" in user_permissions
            )
        else:  # GENERAL
            return True  # All authenticated users can access general tickets

    async def _get_user_permissions(self, user_id: UUID) -> list[str]:
        """Get user permissions."""
        rbac_service = RBACService(self.db)
        return await rbac_service.get_user_permissions(user_id)

    async def _get_next_ticket_number(self) -> int:
        """Get the next ticket number."""
        result = await self.db.execute(
            select(func.coalesce(func.max(Ticket.ticket_number), 0) + 1)
        )
        return result.scalar() or 1

    # Category methods
    async def get_categories(
        self, user_permissions: list[str], ticket_type: TicketType | None = None
    ) -> list[TicketCategory]:
        """Get categories filtered by user permissions."""
        query = select(TicketCategory).filter(TicketCategory.is_active == True)

        if ticket_type:
            query = query.filter(TicketCategory.ticket_type == ticket_type)

        query = query.order_by(TicketCategory.sort_order, TicketCategory.name)
        result = await self.db.execute(query)
        categories = list(result.scalars().all())

        # Filter by access
        return [
            cat for cat in categories
            if self._can_access_ticket_type(user_permissions, cat.ticket_type)
        ]

    async def create_category(self, data: TicketCategoryCreate) -> TicketCategory:
        category = TicketCategory(
            name=data.name,
            description=data.description,
            ticket_type=data.ticket_type,
            department_id=data.department_id,
            sort_order=data.sort_order,
        )
        self.db.add(category)
        await self.db.commit()
        await self.db.refresh(category)
        return category

    async def update_category(
        self, category_id: UUID, data: TicketCategoryUpdate
    ) -> TicketCategory | None:
        result = await self.db.execute(
            select(TicketCategory).filter(TicketCategory.id == category_id)
        )
        category = result.scalar_one_or_none()
        if not category:
            return None

        if data.name is not None:
            category.name = data.name
        if data.description is not None:
            category.description = data.description
        if data.ticket_type is not None:
            category.ticket_type = data.ticket_type
        if data.department_id is not None:
            category.department_id = data.department_id
        if data.is_active is not None:
            category.is_active = data.is_active
        if data.sort_order is not None:
            category.sort_order = data.sort_order

        await self.db.commit()
        await self.db.refresh(category)
        return category

    async def delete_category(self, category_id: UUID) -> bool:
        result = await self.db.execute(
            select(TicketCategory).filter(TicketCategory.id == category_id)
        )
        category = result.scalar_one_or_none()
        if not category:
            return False

        await self.db.delete(category)
        await self.db.commit()
        return True

    # Ticket methods
    async def get_tickets(
        self,
        user_id: UUID,
        user_permissions: list[str],
        filters: TicketListFilters | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Ticket], int]:
        """Get tickets filtered by user permissions and filters."""
        query = select(Ticket)

        # Apply permission-based filtering
        if not self._can_access_ticket_type(user_permissions, TicketType.ADMIN):
            if self._can_access_ticket_type(user_permissions, TicketType.MANAGER):
                query = query.filter(Ticket.ticket_type != TicketType.ADMIN)
            elif self._can_access_ticket_type(user_permissions, TicketType.DEPARTMENT):
                query = query.filter(
                    Ticket.ticket_type.in_([TicketType.DEPARTMENT, TicketType.GENERAL])
                )
            else:
                query = query.filter(Ticket.ticket_type == TicketType.GENERAL)

        # Apply filters
        if filters:
            if filters.ticket_type:
                query = query.filter(Ticket.ticket_type == filters.ticket_type)
            if filters.status:
                query = query.filter(Ticket.status == filters.status)
            if filters.priority:
                query = query.filter(Ticket.priority == filters.priority)
            if filters.category_id:
                query = query.filter(Ticket.category_id == filters.category_id)
            if filters.department_id:
                query = query.filter(Ticket.department_id == filters.department_id)
            if filters.assignee_id:
                query = query.filter(Ticket.assignee_id == filters.assignee_id)
            if filters.requester_id:
                query = query.filter(Ticket.requester_id == filters.requester_id)
            if filters.team_id:
                query = query.filter(Ticket.team_id == filters.team_id)
            if filters.is_private is not None:
                query = query.filter(Ticket.is_private == filters.is_private)
            if filters.search:
                search_term = f"%{filters.search}%"
                query = query.filter(
                    or_(
                        Ticket.title.ilike(search_term),
                        Ticket.description.ilike(search_term),
                    )
                )

        # Non-admin/managers can only see their own tickets or public ones
        if "tickets.manage_all" not in user_permissions and "tickets.admin" not in user_permissions:
            query = query.filter(
                or_(
                    Ticket.requester_id == user_id,
                    Ticket.assignee_id == user_id,
                    Ticket.is_private == False,
                )
            )

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(Ticket.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        tickets = list(result.scalars().all())

        return tickets, total

    async def get_ticket(
        self, ticket_id: UUID, user_id: UUID, user_permissions: list[str]
    ) -> Ticket | None:
        """Get a specific ticket with permission check."""
        result = await self.db.execute(
            select(Ticket)
            .options(
                selectinload(Ticket.comments),
                selectinload(Ticket.attachments),
            )
            .filter(Ticket.id == ticket_id)
        )
        ticket = result.scalar_one_or_none()

        if not ticket:
            return None

        # Check access
        if not self._can_access_ticket_type(user_permissions, ticket.ticket_type):
            return None

        # Check if user can view this specific ticket
        if (
            "tickets.manage_all" not in user_permissions
            and "tickets.admin" not in user_permissions
        ):
            if (
                ticket.requester_id != user_id
                and ticket.assignee_id != user_id
                and ticket.is_private
            ):
                return None

        return ticket

    async def create_ticket(
        self, data: TicketCreate, requester_id: UUID, user_permissions: list[str]
    ) -> Ticket:
        """Create a new ticket."""
        # Check if user can create this ticket type
        if not self._can_access_ticket_type(user_permissions, data.ticket_type):
            raise PermissionError("Cannot create tickets of this type")

        ticket_number = await self._get_next_ticket_number()

        ticket = Ticket(
            ticket_number=ticket_number,
            title=data.title,
            description=data.description,
            ticket_type=data.ticket_type,
            priority=data.priority,
            category_id=data.category_id,
            department_id=data.department_id,
            project_id=data.project_id,
            team_id=data.team_id,
            requester_id=requester_id,
            due_date=data.due_date,
            is_private=data.is_private,
        )
        self.db.add(ticket)
        await self.db.commit()
        await self.db.refresh(ticket)
        return ticket

    async def update_ticket(
        self,
        ticket_id: UUID,
        data: TicketUpdate,
        user_id: UUID,
        user_permissions: list[str],
    ) -> Ticket | None:
        """Update a ticket."""
        ticket = await self.get_ticket(ticket_id, user_id, user_permissions)
        if not ticket:
            return None

        # Check edit permissions
        can_edit = (
            "tickets.admin" in user_permissions
            or "tickets.manage_all" in user_permissions
            or ("tickets.edit" in user_permissions and ticket.requester_id == user_id)
        )

        if not can_edit:
            raise PermissionError("Cannot edit this ticket")

        old_status = ticket.status

        if data.title is not None:
            ticket.title = data.title
        if data.description is not None:
            ticket.description = data.description
        if data.ticket_type is not None:
            if not self._can_access_ticket_type(user_permissions, data.ticket_type):
                raise PermissionError("Cannot change to this ticket type")
            ticket.ticket_type = data.ticket_type
        if data.priority is not None:
            ticket.priority = data.priority
        if data.status is not None:
            ticket.status = data.status
            if data.status == TicketStatus.RESOLVED:
                ticket.resolved_at = datetime.now(timezone.utc)
            elif data.status == TicketStatus.CLOSED:
                ticket.closed_at = datetime.now(timezone.utc)
        if data.category_id is not None:
            ticket.category_id = data.category_id
        if data.department_id is not None:
            ticket.department_id = data.department_id
        if data.project_id is not None:
            ticket.project_id = data.project_id
        if data.assignee_id is not None:
            ticket.assignee_id = data.assignee_id
        if data.team_id is not None:
            ticket.team_id = data.team_id
        if data.due_date is not None:
            ticket.due_date = data.due_date
        if data.is_private is not None:
            ticket.is_private = data.is_private

        ticket.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(ticket)

        # Record status change
        if data.status is not None and old_status != data.status:
            history = TicketStatusHistory(
                ticket_id=ticket.id,
                changed_by=user_id,
                old_status=old_status,
                new_status=data.status,
            )
            self.db.add(history)
            await self.db.commit()

        return ticket

    async def delete_ticket(
        self, ticket_id: UUID, user_id: UUID, user_permissions: list[str]
    ) -> bool:
        """Delete a ticket (admin only)."""
        if "tickets.admin" not in user_permissions:
            raise PermissionError("Only admins can delete tickets")

        result = await self.db.execute(select(Ticket).filter(Ticket.id == ticket_id))
        ticket = result.scalar_one_or_none()
        if not ticket:
            return False

        await self.db.delete(ticket)
        await self.db.commit()
        return True

    # Comment methods
    async def get_comments(self, ticket_id: UUID, user_id: UUID) -> list[TicketComment]:
        """Get comments for a ticket."""
        result = await self.db.execute(
            select(TicketComment)
            .filter(TicketComment.ticket_id == ticket_id)
            .order_by(TicketComment.created_at)
        )
        return list(result.scalars().all())

    async def add_comment(
        self,
        ticket_id: UUID,
        data: TicketCommentCreate,
        author_id: UUID,
        user_permissions: list[str],
    ) -> TicketComment:
        """Add a comment to a ticket."""
        # Verify ticket access
        ticket = await self.get_ticket(ticket_id, author_id, user_permissions)
        if not ticket:
            raise PermissionError("Cannot access this ticket")

        # Only staff can add internal comments
        is_internal = data.is_internal
        if is_internal and "tickets.manage_all" not in user_permissions:
            is_internal = False

        comment = TicketComment(
            ticket_id=ticket_id,
            author_id=author_id,
            content=data.content,
            is_internal=is_internal,
        )
        self.db.add(comment)
        await self.db.commit()
        await self.db.refresh(comment)
        return comment

    async def update_comment(
        self,
        comment_id: UUID,
        data: TicketCommentUpdate,
        user_id: UUID,
    ) -> TicketComment | None:
        """Update a comment (author only)."""
        result = await self.db.execute(
            select(TicketComment).filter(TicketComment.id == comment_id)
        )
        comment = result.scalar_one_or_none()
        if not comment or comment.author_id != user_id:
            return None

        if data.content is not None:
            comment.content = data.content

        comment.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(comment)
        return comment

    async def delete_comment(self, comment_id: UUID, user_id: UUID, user_permissions: list[str]) -> bool:
        """Delete a comment (author or admin)."""
        result = await self.db.execute(
            select(TicketComment).filter(TicketComment.id == comment_id)
        )
        comment = result.scalar_one_or_none()
        if not comment:
            return False

        if comment.author_id != user_id and "tickets.admin" not in user_permissions:
            raise PermissionError("Cannot delete this comment")

        await self.db.delete(comment)
        await self.db.commit()
        return True

    # Statistics
    async def get_ticket_stats(
        self, user_id: UUID, user_permissions: list[str]
    ) -> dict[str, Any]:
        """Get ticket statistics."""
        base_query = select(Ticket)

        # Apply permission-based filtering
        if not self._can_access_ticket_type(user_permissions, TicketType.ADMIN):
            if self._can_access_ticket_type(user_permissions, TicketType.MANAGER):
                base_query = base_query.filter(Ticket.ticket_type != TicketType.ADMIN)
            elif self._can_access_ticket_type(user_permissions, TicketType.DEPARTMENT):
                base_query = base_query.filter(
                    Ticket.ticket_type.in_([TicketType.DEPARTMENT, TicketType.GENERAL])
                )
            else:
                base_query = base_query.filter(Ticket.ticket_type == TicketType.GENERAL)

        # Total count
        total_result = await self.db.execute(
            select(func.count()).select_from(base_query.subquery())
        )
        total = total_result.scalar() or 0

        # By status
        status_query = base_query.with_only_columns(
            Ticket.status, func.count().label("count")
        ).group_by(Ticket.status)
        status_result = await self.db.execute(status_query)
        by_status = {row.status: row.count for row in status_result}

        # By priority
        priority_query = base_query.with_only_columns(
            Ticket.priority, func.count().label("count")
        ).group_by(Ticket.priority)
        priority_result = await self.db.execute(priority_query)
        by_priority = {row.priority: row.count for row in priority_result}

        # By type
        type_query = base_query.with_only_columns(
            Ticket.ticket_type, func.count().label("count")
        ).group_by(Ticket.ticket_type)
        type_result = await self.db.execute(type_query)
        by_type = {row.ticket_type: row.count for row in type_result}

        return {
            "total": total,
            "by_status": by_status,
            "by_priority": by_priority,
            "by_type": by_type,
        }
