from datetime import datetime, timezone, date, timedelta
from uuid import UUID
from decimal import Decimal
from typing import Any
from calendar import monthrange

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.project import Project, Task, TimeEntry, AICostEntry, ProjectStatus
from app.models.db_models.finance import Invoice, Payment, Expense, InvoiceStatus, ExpenseStatus
from app.models.db_models.ticket import Ticket, TicketStatus, TicketPriority, TicketType
from app.models.db_models.customer import PaymentNotification, ProjectRequest
from app.models.db_models.user import User
from app.models.db_models.rbac import UserRole, Role


class ReportsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Date helpers
    def _get_date_range(self, period: str) -> tuple[date, date]:
        """Get date range for a period."""
        today = date.today()
        if period == "today":
            return today, today
        elif period == "week":
            start = today - timedelta(days=today.weekday())
            end = start + timedelta(days=6)
            return start, end
        elif period == "month":
            start = today.replace(day=1)
            end = today.replace(day=monthrange(today.year, today.month)[1])
            return start, end
        elif period == "quarter":
            quarter = (today.month - 1) // 3 + 1
            start = date(today.year, (quarter - 1) * 3 + 1, 1)
            end_month = quarter * 3
            end = date(today.year, end_month, monthrange(today.year, end_month)[1])
            return start, end
        elif period == "year":
            return date(today.year, 1, 1), date(today.year, 12, 31)
        else:
            # Default to month
            start = today.replace(day=1)
            end = today.replace(day=monthrange(today.year, today.month)[1])
            return start, end

    # Project Reports
    async def get_project_stats(self, user_id: UUID | None = None) -> dict[str, Any]:
        """Get project statistics."""
        # Total projects
        total_query = select(func.count()).select_from(Project)
        if user_id:
            total_query = total_query.filter(Project.owner_id == user_id)
        total_result = await self.db.execute(total_query)
        total_projects = total_result.scalar() or 0

        # By status
        status_query = select(Project.status, func.count()).group_by(Project.status)
        if user_id:
            status_query = status_query.filter(Project.owner_id == user_id)
        status_result = await self.db.execute(status_query)
        by_status = {str(row[0].value): row[1] for row in status_result.all()}

        # Active tasks count
        active_projects_query = select(Project.id).filter(
            Project.status.in_([ProjectStatus.PLANNING, ProjectStatus.ACTIVE])
        )
        if user_id:
            active_projects_query = active_projects_query.filter(Project.owner_id == user_id)
        active_result = await self.db.execute(active_projects_query)
        active_project_ids = [row[0] for row in active_result.all()]

        total_tasks = 0
        completed_tasks = 0
        if active_project_ids:
            tasks_query = select(func.count()).select_from(Task).filter(Task.project_id.in_(active_project_ids))
            tasks_result = await self.db.execute(tasks_query)
            total_tasks = tasks_result.scalar() or 0

        return {
            "total_projects": total_projects,
            "by_status": by_status,
            "active_project_ids": active_project_ids,
        }

    async def get_time_tracking_report(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        user_id: UUID | None = None,
        project_id: UUID | None = None,
    ) -> dict[str, Any]:
        """Get time tracking report."""
        query = select(TimeEntry)

        if start_date:
            query = query.filter(TimeEntry.start_time >= start_date)
        if end_date:
            query = query.filter(TimeEntry.start_time <= end_date)
        if user_id:
            query = query.filter(TimeEntry.user_id == user_id)
        if project_id:
            query = query.filter(TimeEntry.project_id == project_id)

        result = await self.db.execute(query)
        entries = list(result.scalars().all())

        total_minutes = sum(e.duration_minutes for e in entries)
        billable_minutes = sum(e.duration_minutes for e in entries if e.is_billable)

        # By user
        by_user_query = select(
            TimeEntry.user_id,
            func.sum(TimeEntry.duration_minutes).label("total_minutes"),
        ).group_by(TimeEntry.user_id)
        if start_date:
            by_user_query = by_user_query.filter(TimeEntry.start_time >= start_date)
        if end_date:
            by_user_query = by_user_query.filter(TimeEntry.start_time <= end_date)
        if project_id:
            by_user_query = by_user_query.filter(TimeEntry.project_id == project_id)

        by_user_result = await self.db.execute(by_user_query)
        by_user = {str(row[0]): row[1] for row in by_user_result.all()}

        # By project
        by_project_query = select(
            TimeEntry.project_id,
            func.sum(TimeEntry.duration_minutes).label("total_minutes"),
        ).group_by(TimeEntry.project_id)
        if start_date:
            by_project_query = by_project_query.filter(TimeEntry.start_time >= start_date)
        if end_date:
            by_project_query = by_project_query.filter(TimeEntry.start_time <= end_date)
        if user_id:
            by_project_query = by_project_query.filter(TimeEntry.user_id == user_id)

        by_project_result = await self.db.execute(by_project_query)
        by_project = {str(row[0]): row[1] for row in by_project_result.all()}

        return {
            "total_hours": round(total_minutes / 60, 2),
            "billable_hours": round(billable_minutes / 60, 2),
            "total_entries": len(entries),
            "by_user": by_user,
            "by_project": by_project,
        }

    async def get_ai_cost_report(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        user_id: UUID | None = None,
        project_id: UUID | None = None,
    ) -> dict[str, Any]:
        """Get AI cost tracking report."""
        query = select(AICostEntry)

        if start_date:
            query = query.filter(AICostEntry.created_at >= start_date)
        if end_date:
            query = query.filter(AICostEntry.created_at <= end_date)
        if user_id:
            query = query.filter(AICostEntry.user_id == user_id)
        if project_id:
            query = query.filter(AICostEntry.project_id == project_id)

        result = await self.db.execute(query)
        entries = list(result.scalars().all())

        total_cost = sum(float(e.cost_usd) for e in entries)
        total_input_tokens = sum(e.input_tokens for e in entries)
        total_output_tokens = sum(e.output_tokens for e in entries)

        # By provider
        by_provider_query = select(
            AICostEntry.provider,
            func.sum(AICostEntry.cost_usd).label("total_cost"),
            func.sum(AICostEntry.input_tokens).label("input_tokens"),
            func.sum(AICostEntry.output_tokens).label("output_tokens"),
        ).group_by(AICostEntry.provider)
        if start_date:
            by_provider_query = by_provider_query.filter(AICostEntry.created_at >= start_date)
        if end_date:
            by_provider_query = by_provider_query.filter(AICostEntry.created_at <= end_date)

        by_provider_result = await self.db.execute(by_provider_query)
        by_provider = {}
        for row in by_provider_result.all():
            by_provider[row[0]] = {
                "cost": float(row[1]),
                "input_tokens": row[2],
                "output_tokens": row[3],
            }

        # By model
        by_model_query = select(
            AICostEntry.model,
            func.sum(AICostEntry.cost_usd).label("total_cost"),
        ).group_by(AICostEntry.model)
        if start_date:
            by_model_query = by_model_query.filter(AICostEntry.created_at >= start_date)
        if end_date:
            by_model_query = by_model_query.filter(AICostEntry.created_at <= end_date)

        by_model_result = await self.db.execute(by_model_query)
        by_model = {row[0]: float(row[1]) for row in by_model_result.all()}

        return {
            "total_cost_usd": round(total_cost, 4),
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_entries": len(entries),
            "by_provider": by_provider,
            "by_model": by_model,
        }

    # Financial Reports
    async def get_financial_report(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> dict[str, Any]:
        """Get financial report."""
        # Revenue (from paid invoices)
        revenue_query = select(func.coalesce(func.sum(Invoice.total), 0)).filter(
            Invoice.status == InvoiceStatus.PAID
        )
        if start_date:
            revenue_query = revenue_query.filter(Invoice.paid_at >= start_date)
        if end_date:
            revenue_query = revenue_query.filter(Invoice.paid_at <= end_date)
        revenue_result = await self.db.execute(revenue_query)
        total_revenue = float(revenue_result.scalar() or 0)

        # Expenses
        expense_query = select(func.coalesce(func.sum(Expense.amount), 0)).filter(
            Expense.status.in_([ExpenseStatus.APPROVED, ExpenseStatus.PAID])
        )
        if start_date:
            expense_query = expense_query.filter(Expense.expense_date >= start_date)
        if end_date:
            expense_query = expense_query.filter(Expense.expense_date <= end_date)
        expense_result = await self.db.execute(expense_query)
        total_expenses = float(expense_result.scalar() or 0)

        # Outstanding invoices
        outstanding_query = select(func.coalesce(func.sum(Invoice.total), 0)).filter(
            Invoice.status.in_([InvoiceStatus.SENT, InvoiceStatus.VIEWED, InvoiceStatus.OVERDUE])
        )
        outstanding_result = await self.db.execute(outstanding_query)
        outstanding_invoices = float(outstanding_result.scalar() or 0)

        # Overdue amount
        overdue_query = select(func.coalesce(func.sum(Invoice.total), 0)).filter(
            Invoice.status == InvoiceStatus.OVERDUE
        )
        overdue_result = await self.db.execute(overdue_query)
        overdue_amount = float(overdue_result.scalar() or 0)

        # Invoice counts by status
        invoice_status_query = select(
            Invoice.status,
            func.count().label("count"),
            func.sum(Invoice.total).label("total"),
        ).group_by(Invoice.status)
        invoice_status_result = await self.db.execute(invoice_status_query)
        invoices_by_status = {}
        for row in invoice_status_result.all():
            invoices_by_status[str(row[0].value)] = {
                "count": row[1],
                "total": float(row[2] or 0),
            }

        # Expense by category
        expense_cat_query = select(
            Expense.category,
            func.sum(Expense.amount).label("total"),
        ).filter(
            Expense.status.in_([ExpenseStatus.APPROVED, ExpenseStatus.PAID])
        ).group_by(Expense.category)
        expense_cat_result = await self.db.execute(expense_cat_query)
        expenses_by_category = {row[0]: float(row[1]) for row in expense_cat_result.all()}

        return {
            "total_revenue": total_revenue,
            "total_expenses": total_expenses,
            "net_profit": total_revenue - total_expenses,
            "outstanding_invoices": outstanding_invoices,
            "overdue_amount": overdue_amount,
            "invoices_by_status": invoices_by_status,
            "expenses_by_category": expenses_by_category,
        }

    # Ticket Reports
    async def get_ticket_report(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> dict[str, Any]:
        """Get ticket statistics report."""
        # Total tickets
        total_query = select(func.count()).select_from(Ticket)
        if start_date:
            total_query = total_query.filter(Ticket.created_at >= start_date)
        if end_date:
            total_query = total_query.filter(Ticket.created_at <= end_date)
        total_result = await self.db.execute(total_query)
        total_tickets = total_result.scalar() or 0

        # By status
        status_query = select(
            Ticket.status,
            func.count().label("count"),
        ).group_by(Ticket.status)
        if start_date:
            status_query = status_query.filter(Ticket.created_at >= start_date)
        if end_date:
            status_query = status_query.filter(Ticket.created_at <= end_date)
        status_result = await self.db.execute(status_query)
        by_status = {str(row[0].value): row[1] for row in status_result.all()}

        # By priority
        priority_query = select(
            Ticket.priority,
            func.count().label("count"),
        ).group_by(Ticket.priority)
        if start_date:
            priority_query = priority_query.filter(Ticket.created_at >= start_date)
        if end_date:
            priority_query = priority_query.filter(Ticket.created_at <= end_date)
        priority_result = await self.db.execute(priority_query)
        by_priority = {str(row[0].value): row[1] for row in priority_result.all()}

        # By type
        type_query = select(
            Ticket.ticket_type,
            func.count().label("count"),
        ).group_by(Ticket.ticket_type)
        if start_date:
            type_query = type_query.filter(Ticket.created_at >= start_date)
        if end_date:
            type_query = type_query.filter(Ticket.created_at <= end_date)
        type_result = await self.db.execute(type_query)
        by_type = {str(row[0].value): row[1] for row in type_result.all()}

        # Open tickets count
        open_query = select(func.count()).select_from(Ticket).filter(
            Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING])
        )
        open_result = await self.db.execute(open_query)
        open_tickets = open_result.scalar() or 0

        return {
            "total_tickets": total_tickets,
            "open_tickets": open_tickets,
            "by_status": by_status,
            "by_priority": by_priority,
            "by_type": by_type,
        }

    # Customer Dashboard
    async def get_customer_dashboard(self, customer_id: UUID) -> dict[str, Any]:
        """Get dashboard data for a customer."""
        # Active projects
        active_projects_query = select(func.count()).select_from(Project).filter(
            Project.customer_id == customer_id,
            Project.status.in_([ProjectStatus.ACTIVE, ProjectStatus.PLANNING]),
        )
        active_projects_result = await self.db.execute(active_projects_query)
        active_projects = active_projects_result.scalar() or 0

        # Total project requests
        project_requests_query = select(func.count()).select_from(ProjectRequest).filter(
            ProjectRequest.customer_id == customer_id
        )
        project_requests_result = await self.db.execute(project_requests_query)
        total_project_requests = project_requests_result.scalar() or 0

        # Pending project requests
        pending_requests_query = select(func.count()).select_from(ProjectRequest).filter(
            ProjectRequest.customer_id == customer_id,
            ProjectRequest.status == "pending",
        )
        pending_requests_result = await self.db.execute(pending_requests_query)
        pending_project_requests = pending_requests_result.scalar() or 0

        # Payment notifications
        payment_notifications_query = select(func.count()).select_from(PaymentNotification).filter(
            PaymentNotification.customer_id == customer_id
        )
        payment_notifications_result = await self.db.execute(payment_notifications_query)
        total_payment_notifications = payment_notifications_result.scalar() or 0

        # Pending payments
        pending_payments_query = select(func.count()).select_from(PaymentNotification).filter(
            PaymentNotification.customer_id == customer_id,
            PaymentNotification.status == "pending",
        )
        pending_payments_result = await self.db.execute(pending_payments_query)
        pending_payments = pending_payments_result.scalar() or 0

        # Total paid
        paid_query = select(func.coalesce(func.sum(PaymentNotification.amount), 0)).filter(
            PaymentNotification.customer_id == customer_id,
            PaymentNotification.status == "verified",
        )
        paid_result = await self.db.execute(paid_query)
        total_paid = float(paid_result.scalar() or 0)

        return {
            "active_projects": active_projects,
            "total_project_requests": total_project_requests,
            "pending_project_requests": pending_project_requests,
            "total_payment_notifications": total_payment_notifications,
            "pending_payments": pending_payments,
            "total_paid": total_paid,
        }

    # Manager Dashboard
    async def get_manager_dashboard(self) -> dict[str, Any]:
        """Get dashboard data for managers."""
        # Project stats
        project_stats = await self.get_project_stats()

        # Financial stats (this month)
        today = date.today()
        start_of_month = today.replace(day=1)
        financial_stats = await self.get_financial_report(start_of_month, today)

        # Ticket stats
        ticket_stats = await self.get_ticket_report()

        # Payment notifications pending
        pending_payments_query = select(func.count()).select_from(PaymentNotification).filter(
            PaymentNotification.status == "pending"
        )
        pending_payments_result = await self.db.execute(pending_payments_query)
        pending_payment_notifications = pending_payments_result.scalar() or 0

        # Project requests pending
        pending_requests_query = select(func.count()).select_from(ProjectRequest).filter(
            ProjectRequest.status == "pending"
        )
        pending_requests_result = await self.db.execute(pending_requests_query)
        pending_project_requests = pending_requests_result.scalar() or 0

        return {
            "projects": project_stats,
            "finance": financial_stats,
            "tickets": ticket_stats,
            "pending_payment_notifications": pending_payment_notifications,
            "pending_project_requests": pending_project_requests,
        }

    # Admin Dashboard
    async def get_admin_dashboard(self) -> dict[str, Any]:
        """Get full dashboard data for admins."""
        manager_dashboard = await self.get_manager_dashboard()

        # User stats
        total_users_query = select(func.count()).select_from(User)
        total_users_result = await self.db.execute(total_users_query)
        total_users = total_users_result.scalar() or 0

        active_users_query = select(func.count()).select_from(User).filter(User.is_active == True)
        active_users_result = await self.db.execute(active_users_query)
        active_users = active_users_result.scalar() or 0

        # Users by role
        role_query = select(
            Role.name,
            func.count(UserRole.id).label("count"),
        ).select_from(Role).outerjoin(UserRole).group_by(Role.name)
        role_result = await self.db.execute(role_query)
        users_by_role = {row[0]: row[1] for row in role_result.all()}

        # AI costs (this month)
        today = date.today()
        start_of_month = today.replace(day=1)
        ai_stats = await self.get_ai_cost_report(start_of_month, today)

        return {
            **manager_dashboard,
            "users": {
                "total": total_users,
                "active": active_users,
                "by_role": users_by_role,
            },
            "ai_costs": ai_stats,
        }
