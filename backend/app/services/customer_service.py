from datetime import datetime, timezone
from uuid import UUID
from decimal import Decimal
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.customer import BankAccount, PaymentNotification, ProjectRequest
from app.models.db_models.ticket import Ticket, TicketType, TicketPriority, TicketStatus
from app.models.schemas.customer import (
    BankAccountCreate,
    BankAccountUpdate,
    PaymentNotificationCreate,
    PaymentNotificationUpdate,
    ProjectRequestCreate,
    ProjectRequestUpdate,
    ProjectRequestReview,
)


class CustomerService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Bank Account methods
    async def get_bank_accounts(self, active_only: bool = True) -> list[BankAccount]:
        """Get all bank accounts (admin view)."""
        query = select(BankAccount)
        if active_only:
            query = query.filter(BankAccount.is_active == True)
        query = query.order_by(BankAccount.is_primary.desc(), BankAccount.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_active_bank_accounts(self) -> list[BankAccount]:
        """Get active bank accounts for customer view."""
        query = select(BankAccount).filter(BankAccount.is_active == True)
        query = query.order_by(BankAccount.is_primary.desc(), BankAccount.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_bank_account(self, account_id: UUID) -> BankAccount | None:
        """Get a specific bank account."""
        result = await self.db.execute(
            select(BankAccount).filter(BankAccount.id == account_id)
        )
        return result.scalar_one_or_none()

    async def create_bank_account(self, data: BankAccountCreate, created_by: UUID) -> BankAccount:
        """Create a new bank account."""
        if data.is_primary:
            # Unset other primary accounts
            await self.db.execute(
                select(BankAccount).filter(BankAccount.is_primary == True)
            )
            existing = await self.db.execute(
                select(BankAccount).filter(BankAccount.is_primary == True)
            )
            for acc in existing.scalars().all():
                acc.is_primary = False

        account = BankAccount(
            name=data.name,
            bank_name=data.bank_name,
            account_holder=data.account_holder,
            iban=data.iban,
            account_number=data.account_number,
            routing_number=data.routing_number,
            swift_bic=data.swift_bic,
            currency=data.currency,
            is_primary=data.is_primary,
            notes=data.notes,
            created_by=created_by,
        )
        self.db.add(account)
        await self.db.commit()
        await self.db.refresh(account)
        return account

    async def update_bank_account(self, account_id: UUID, data: BankAccountUpdate) -> BankAccount | None:
        """Update a bank account."""
        result = await self.db.execute(
            select(BankAccount).filter(BankAccount.id == account_id)
        )
        account = result.scalar_one_or_none()
        if not account:
            return None

        if data.is_primary == True and not account.is_primary:
            # Unset other primary accounts
            existing = await self.db.execute(
                select(BankAccount).filter(
                    BankAccount.is_primary == True,
                    BankAccount.id != account_id,
                )
            )
            for acc in existing.scalars().all():
                acc.is_primary = False

        update_fields = [
            "name", "bank_name", "account_holder", "iban", "account_number",
            "routing_number", "swift_bic", "currency", "is_primary", "is_active", "notes"
        ]
        for field in update_fields:
            value = getattr(data, field, None)
            if value is not None:
                setattr(account, field, value)

        account.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(account)
        return account

    async def delete_bank_account(self, account_id: UUID) -> bool:
        """Delete a bank account."""
        result = await self.db.execute(
            select(BankAccount).filter(BankAccount.id == account_id)
        )
        account = result.scalar_one_or_none()
        if not account:
            return False

        await self.db.delete(account)
        await self.db.commit()
        return True

    # Payment Notification methods
    async def get_payment_notifications(
        self,
        status: str | None = None,
        customer_id: UUID | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[PaymentNotification], int]:
        """Get payment notifications (admin/manager view)."""
        query = select(PaymentNotification)

        if status:
            query = query.filter(PaymentNotification.status == status)
        if customer_id:
            query = query.filter(PaymentNotification.customer_id == customer_id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(PaymentNotification.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        notifications = list(result.scalars().all())

        return notifications, total

    async def get_customer_payment_notifications(
        self,
        customer_id: UUID,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[PaymentNotification], int]:
        """Get payment notifications for a specific customer."""
        query = select(PaymentNotification).filter(PaymentNotification.customer_id == customer_id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(PaymentNotification.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        notifications = list(result.scalars().all())

        return notifications, total

    async def get_payment_notification(self, notification_id: UUID) -> PaymentNotification | None:
        """Get a specific payment notification."""
        result = await self.db.execute(
            select(PaymentNotification).filter(PaymentNotification.id == notification_id)
        )
        return result.scalar_one_or_none()

    async def create_payment_notification(
        self,
        data: PaymentNotificationCreate,
        customer_id: UUID,
        user_permissions: list[str],
    ) -> PaymentNotification:
        """Create a payment notification and a ticket for management."""
        notification = PaymentNotification(
            customer_id=customer_id,
            project_id=data.project_id,
            invoice_id=data.invoice_id,
            amount=data.amount,
            currency=data.currency,
            payment_date=data.payment_date,
            payment_method=data.payment_method,
            sender_name=data.sender_name,
            sender_bank=data.sender_bank,
            reference_number=data.reference_number,
            receipt_file_url=data.receipt_file_url,
            receipt_file_name=data.receipt_file_name,
            notes=data.notes,
            status="pending",
        )
        self.db.add(notification)
        await self.db.flush()

        # Create a ticket for management
        ticket = Ticket(
            ticket_type=TicketType.GENERAL,
            title=f"Ödeme Bildirimi - {notification.amount} {notification.currency}",
            description=f"Müşteri tarafından ödeme bildirimi yapıldı.\n\n"
                       f"Tutar: {notification.amount} {notification.currency}\n"
                       f"Ödeme Yöntemi: {notification.payment_method}\n"
                       f"Ödeme Tarihi: {notification.payment_date.strftime('%Y-%m-%d %H:%M')}\n"
                       f"Gönderen: {notification.sender_name or 'Belirtilmedi'}\n"
                       f"Banka: {notification.sender_bank or 'Belirtilmedi'}\n"
                       f"Referans: {notification.reference_number or 'Belirtilmedi'}\n"
                       f"Notlar: {notification.notes or 'Yok'}\n\n"
                       f"Dekont: {notification.receipt_file_url or 'Yüklenmedi'}",
            priority=TicketPriority.MEDIUM,
            status=TicketStatus.OPEN,
            requester_id=customer_id,
            is_private=False,
        )
        self.db.add(ticket)
        await self.db.flush()

        # Link ticket to notification
        notification.ticket_id = ticket.id
        await self.db.commit()
        await self.db.refresh(notification)
        return notification

    async def verify_payment_notification(
        self,
        notification_id: UUID,
        verified_by: UUID,
    ) -> PaymentNotification | None:
        """Verify a payment notification (approve)."""
        result = await self.db.execute(
            select(PaymentNotification).filter(PaymentNotification.id == notification_id)
        )
        notification = result.scalar_one_or_none()
        if not notification:
            return None

        notification.status = "verified"
        notification.verified_by = verified_by
        notification.verified_at = datetime.now(timezone.utc)

        # Update ticket status
        if notification.ticket_id:
            ticket_result = await self.db.execute(
                select(Ticket).filter(Ticket.id == notification.ticket_id)
            )
            ticket = ticket_result.scalar_one_or_none()
            if ticket:
                ticket.status = TicketStatus.RESOLVED
                ticket.resolved_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(notification)
        return notification

    async def reject_payment_notification(
        self,
        notification_id: UUID,
        rejected_by: UUID,
    ) -> PaymentNotification | None:
        """Reject a payment notification."""
        result = await self.db.execute(
            select(PaymentNotification).filter(PaymentNotification.id == notification_id)
        )
        notification = result.scalar_one_or_none()
        if not notification:
            return None

        notification.status = "rejected"
        notification.verified_by = rejected_by
        notification.verified_at = datetime.now(timezone.utc)

        # Update ticket status
        if notification.ticket_id:
            ticket_result = await self.db.execute(
                select(Ticket).filter(Ticket.id == notification.ticket_id)
            )
            ticket = ticket_result.scalar_one_or_none()
            if ticket:
                ticket.status = TicketStatus.CLOSED
                ticket.closed_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(notification)
        return notification

    # Project Request methods
    async def get_project_requests(
        self,
        status: str | None = None,
        customer_id: UUID | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ProjectRequest], int]:
        """Get project requests (admin/manager view)."""
        query = select(ProjectRequest)

        if status:
            query = query.filter(ProjectRequest.status == status)
        if customer_id:
            query = query.filter(ProjectRequest.customer_id == customer_id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(ProjectRequest.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        requests = list(result.scalars().all())

        return requests, total

    async def get_customer_project_requests(
        self,
        customer_id: UUID,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ProjectRequest], int]:
        """Get project requests for a specific customer."""
        query = select(ProjectRequest).filter(ProjectRequest.customer_id == customer_id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(ProjectRequest.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        requests = list(result.scalars().all())

        return requests, total

    async def get_project_request(self, request_id: UUID) -> ProjectRequest | None:
        """Get a specific project request."""
        result = await self.db.execute(
            select(ProjectRequest).filter(ProjectRequest.id == request_id)
        )
        return result.scalar_one_or_none()

    async def create_project_request(
        self,
        data: ProjectRequestCreate,
        customer_id: UUID,
    ) -> ProjectRequest:
        """Create a project request and a ticket for management."""
        request = ProjectRequest(
            customer_id=customer_id,
            name=data.name,
            description=data.description,
            budget=data.budget,
            budget_range=data.budget_range,
            topics=data.topics,
            desired_start_date=data.desired_start_date,
            desired_end_date=data.desired_end_date,
            requirements=data.requirements,
            attachments=data.attachments,
            attachment_url=data.attachment_url,
            attachment_name=data.attachment_name,
            status="pending",
        )
        self.db.add(request)
        await self.db.flush()

        # Build ticket description
        ticket_desc = f"New project request from customer.\n\n"
        ticket_desc += f"Project Name: {request.name}\n"
        ticket_desc += f"Description: {request.description}\n"
        if request.budget:
            ticket_desc += f"Budget: ${request.budget:,.2f}\n"
        if request.budget_range:
            ticket_desc += f"Budget Range: {request.budget_range}\n"
        if request.topics:
            ticket_desc += f"Topics/Tags: {request.topics}\n"
        if request.desired_start_date:
            ticket_desc += f"Desired Start: {request.desired_start_date.strftime('%Y-%m-%d')}\n"
        if request.desired_end_date:
            ticket_desc += f"Desired End: {request.desired_end_date.strftime('%Y-%m-%d')}\n"
        if request.requirements:
            ticket_desc += f"Requirements: {request.requirements}\n"
        if request.attachment_url:
            ticket_desc += f"Attachment: {request.attachment_url}\n"

        # Create a ticket for management
        ticket = Ticket(
            ticket_type=TicketType.GENERAL,
            title=f"Project Request - {request.name}",
            description=ticket_desc,
            priority=TicketPriority.MEDIUM,
            status=TicketStatus.OPEN,
            requester_id=customer_id,
            is_private=False,
        )
        self.db.add(ticket)
        await self.db.flush()

        # Link ticket to request
        request.ticket_id = ticket.id
        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def review_project_request(
        self,
        request_id: UUID,
        data: ProjectRequestReview,
        reviewed_by: UUID,
    ) -> ProjectRequest | None:
        """Review a project request (approve/reject)."""
        result = await self.db.execute(
            select(ProjectRequest).filter(ProjectRequest.id == request_id)
        )
        request = result.scalar_one_or_none()
        if not request:
            return None

        request.status = data.status
        request.reviewed_by = reviewed_by
        request.reviewed_at = datetime.now(timezone.utc)
        request.review_notes = data.review_notes

        # Store rejection reason if rejected
        if data.status == "rejected" and data.rejection_reason:
            request.rejection_reason = data.rejection_reason

        # Update ticket status
        if request.ticket_id:
            ticket_result = await self.db.execute(
                select(Ticket).filter(Ticket.id == request.ticket_id)
            )
            ticket = ticket_result.scalar_one_or_none()
            if ticket:
                if data.status == "approved":
                    ticket.status = TicketStatus.RESOLVED
                    ticket.resolved_at = datetime.now(timezone.utc)
                    # Add approval note to ticket
                    ticket.description += f"\n\n---\nApproved by admin."
                elif data.status == "rejected":
                    ticket.status = TicketStatus.CLOSED
                    ticket.closed_at = datetime.now(timezone.utc)
                    # Add rejection reason to ticket
                    if data.rejection_reason:
                        ticket.description += f"\n\n---\nRejected: {data.rejection_reason}"

        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def convert_to_project(
        self,
        request_id: UUID,
        project_id: UUID,
        converted_by: UUID,
    ) -> ProjectRequest | None:
        """Convert a project request to an actual project."""
        result = await self.db.execute(
            select(ProjectRequest).filter(ProjectRequest.id == request_id)
        )
        request = result.scalar_one_or_none()
        if not request:
            return None

        request.project_id = project_id
        request.status = "converted"
        request.reviewed_by = converted_by
        request.reviewed_at = datetime.now(timezone.utc)
        request.review_notes = (request.review_notes or "") + f"\nProjeye dönüştürüldü: {project_id}"

        await self.db.commit()
        await self.db.refresh(request)
        return request
