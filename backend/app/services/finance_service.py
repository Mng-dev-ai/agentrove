from datetime import datetime, timezone
from uuid import UUID
from decimal import Decimal
from typing import Any

from sqlalchemy import select, delete, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.finance import (
    Invoice,
    InvoiceItem,
    Payment,
    Expense,
    InvoiceStatus,
    PaymentStatus,
    ExpenseStatus,
)
from app.models.schemas.finance import (
    InvoiceCreate,
    InvoiceUpdate,
    InvoiceItemCreate,
    PaymentCreate,
    ExpenseCreate,
    ExpenseUpdate,
    FinanceStats,
)


class FinanceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Invoice methods
    async def get_invoices(
        self,
        customer_id: UUID | None = None,
        project_id: UUID | None = None,
        status: InvoiceStatus | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Invoice], int]:
        """Get invoices with optional filtering."""
        query = select(Invoice)

        if customer_id:
            query = query.filter(Invoice.customer_id == customer_id)
        if project_id:
            query = query.filter(Invoice.project_id == project_id)
        if status:
            query = query.filter(Invoice.status == status)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(Invoice.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        invoices = list(result.scalars().all())

        return invoices, total

    async def get_invoice(self, invoice_id: UUID) -> Invoice | None:
        """Get a specific invoice with items."""
        result = await self.db.execute(
            select(Invoice).filter(Invoice.id == invoice_id)
        )
        return result.scalar_one_or_none()

    async def create_invoice(self, data: InvoiceCreate, created_by: UUID) -> Invoice:
        """Create a new invoice with items."""
        # Calculate totals
        subtotal = Decimal("0")
        for item in data.items:
            item_total = item.quantity * item.unit_price
            subtotal += item_total

        tax_amount = subtotal * (data.tax_rate / Decimal("100"))
        total = subtotal + tax_amount - data.discount

        invoice = Invoice(
            invoice_number=data.invoice_number,
            project_id=data.project_id,
            customer_id=data.customer_id,
            issue_date=data.issue_date,
            due_date=data.due_date,
            subtotal=subtotal,
            tax_rate=data.tax_rate,
            tax_amount=tax_amount,
            discount=data.discount,
            total=total,
            currency=data.currency,
            notes=data.notes,
            terms=data.terms,
            created_by=created_by,
        )
        self.db.add(invoice)
        await self.db.flush()

        # Add items
        for idx, item_data in enumerate(data.items):
            item_total = item_data.quantity * item_data.unit_price
            item = InvoiceItem(
                invoice_id=invoice.id,
                description=item_data.description,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                total=item_total,
                sort_order=item_data.sort_order or idx,
            )
            self.db.add(item)

        await self.db.commit()
        await self.db.refresh(invoice)
        return invoice

    async def update_invoice(self, invoice_id: UUID, data: InvoiceUpdate) -> Invoice | None:
        """Update an invoice."""
        result = await self.db.execute(select(Invoice).filter(Invoice.id == invoice_id))
        invoice = result.scalar_one_or_none()
        if not invoice:
            return None

        if data.invoice_number is not None:
            invoice.invoice_number = data.invoice_number
        if data.project_id is not None:
            invoice.project_id = data.project_id
        if data.customer_id is not None:
            invoice.customer_id = data.customer_id
        if data.status is not None:
            invoice.status = data.status
            if data.status == InvoiceStatus.PAID:
                invoice.paid_at = datetime.now(timezone.utc)
        if data.issue_date is not None:
            invoice.issue_date = data.issue_date
        if data.due_date is not None:
            invoice.due_date = data.due_date
        if data.subtotal is not None:
            invoice.subtotal = data.subtotal
        if data.tax_rate is not None:
            invoice.tax_rate = data.tax_rate
        if data.discount is not None:
            invoice.discount = data.discount
        if data.currency is not None:
            invoice.currency = data.currency
        if data.notes is not None:
            invoice.notes = data.notes
        if data.terms is not None:
            invoice.terms = data.terms

        # Recalculate totals if needed
        if data.subtotal is not None or data.tax_rate is not None or data.discount is not None:
            invoice.tax_amount = invoice.subtotal * (invoice.tax_rate / Decimal("100"))
            invoice.total = invoice.subtotal + invoice.tax_amount - invoice.discount

        # Update items if provided
        if data.items is not None:
            await self.db.execute(
                delete(InvoiceItem).filter(InvoiceItem.invoice_id == invoice_id)
            )
            subtotal = Decimal("0")
            for idx, item_data in enumerate(data.items):
                item_total = item_data.quantity * item_data.unit_price
                subtotal += item_total
                item = InvoiceItem(
                    invoice_id=invoice.id,
                    description=item_data.description,
                    quantity=item_data.quantity,
                    unit_price=item_data.unit_price,
                    total=item_total,
                    sort_order=item_data.sort_order or idx,
                )
                self.db.add(item)
            invoice.subtotal = subtotal
            invoice.tax_amount = subtotal * (invoice.tax_rate / Decimal("100"))
            invoice.total = subtotal + invoice.tax_amount - invoice.discount

        invoice.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(invoice)
        return invoice

    async def delete_invoice(self, invoice_id: UUID) -> bool:
        """Delete an invoice."""
        result = await self.db.execute(select(Invoice).filter(Invoice.id == invoice_id))
        invoice = result.scalar_one_or_none()
        if not invoice:
            return False

        await self.db.delete(invoice)
        await self.db.commit()
        return True

    # Payment methods
    async def get_payments(
        self,
        invoice_id: UUID | None = None,
        status: PaymentStatus | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Payment], int]:
        """Get payments with optional filtering."""
        query = select(Payment)

        if invoice_id:
            query = query.filter(Payment.invoice_id == invoice_id)
        if status:
            query = query.filter(Payment.status == status)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(Payment.payment_date.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        payments = list(result.scalars().all())

        return payments, total

    async def create_payment(self, data: PaymentCreate, recorded_by: UUID) -> Payment:
        """Create a payment for an invoice."""
        payment = Payment(
            invoice_id=data.invoice_id,
            amount=data.amount,
            currency=data.currency,
            payment_method=data.payment_method,
            transaction_id=data.transaction_id,
            payment_date=data.payment_date,
            notes=data.notes,
            recorded_by=recorded_by,
            status=PaymentStatus.COMPLETED,
        )
        self.db.add(payment)

        # Check if invoice is now fully paid
        result = await self.db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).filter(
                Payment.invoice_id == data.invoice_id,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
        total_paid = result.scalar() or 0

        invoice_result = await self.db.execute(
            select(Invoice).filter(Invoice.id == data.invoice_id)
        )
        invoice = invoice_result.scalar_one_or_none()
        if invoice and total_paid >= invoice.total:
            invoice.status = InvoiceStatus.PAID
            invoice.paid_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    # Expense methods
    async def get_expenses(
        self,
        project_id: UUID | None = None,
        status: ExpenseStatus | None = None,
        submitted_by: UUID | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Expense], int]:
        """Get expenses with optional filtering."""
        query = select(Expense)

        if project_id:
            query = query.filter(Expense.project_id == project_id)
        if status:
            query = query.filter(Expense.status == status)
        if submitted_by:
            query = query.filter(Expense.submitted_by == submitted_by)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.order_by(Expense.expense_date.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        expenses = list(result.scalars().all())

        return expenses, total

    async def get_expense(self, expense_id: UUID) -> Expense | None:
        """Get a specific expense."""
        result = await self.db.execute(select(Expense).filter(Expense.id == expense_id))
        return result.scalar_one_or_none()

    async def create_expense(self, data: ExpenseCreate, submitted_by: UUID) -> Expense:
        """Create a new expense."""
        expense = Expense(
            project_id=data.project_id,
            category=data.category,
            description=data.description,
            amount=data.amount,
            currency=data.currency,
            expense_date=data.expense_date,
            receipt_url=data.receipt_url,
            notes=data.notes,
            submitted_by=submitted_by,
        )
        self.db.add(expense)
        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def update_expense(self, expense_id: UUID, data: ExpenseUpdate) -> Expense | None:
        """Update an expense."""
        result = await self.db.execute(select(Expense).filter(Expense.id == expense_id))
        expense = result.scalar_one_or_none()
        if not expense:
            return None

        if data.project_id is not None:
            expense.project_id = data.project_id
        if data.category is not None:
            expense.category = data.category
        if data.description is not None:
            expense.description = data.description
        if data.amount is not None:
            expense.amount = data.amount
        if data.currency is not None:
            expense.currency = data.currency
        if data.expense_date is not None:
            expense.expense_date = data.expense_date
        if data.status is not None:
            expense.status = data.status
        if data.receipt_url is not None:
            expense.receipt_url = data.receipt_url
        if data.notes is not None:
            expense.notes = data.notes

        expense.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def approve_expense(self, expense_id: UUID, approved_by: UUID) -> Expense | None:
        """Approve an expense."""
        result = await self.db.execute(select(Expense).filter(Expense.id == expense_id))
        expense = result.scalar_one_or_none()
        if not expense:
            return None

        expense.status = ExpenseStatus.APPROVED
        expense.approved_by = approved_by
        expense.approved_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def reject_expense(self, expense_id: UUID, rejected_by: UUID) -> Expense | None:
        """Reject an expense."""
        result = await self.db.execute(select(Expense).filter(Expense.id == expense_id))
        expense = result.scalar_one_or_none()
        if not expense:
            return None

        expense.status = ExpenseStatus.REJECTED
        expense.approved_by = rejected_by
        expense.approved_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def delete_expense(self, expense_id: UUID) -> bool:
        """Delete an expense."""
        result = await self.db.execute(select(Expense).filter(Expense.id == expense_id))
        expense = result.scalar_one_or_none()
        if not expense:
            return False

        await self.db.delete(expense)
        await self.db.commit()
        return True

    # Statistics
    async def get_finance_stats(self) -> FinanceStats:
        """Get financial statistics."""
        # Total revenue (sum of paid invoices)
        revenue_result = await self.db.execute(
            select(func.coalesce(func.sum(Invoice.total), 0)).filter(
                Invoice.status == InvoiceStatus.PAID
            )
        )
        total_revenue = float(revenue_result.scalar() or 0)

        # Total expenses
        expenses_result = await self.db.execute(
            select(func.coalesce(func.sum(Expense.amount), 0)).filter(
                Expense.status == ExpenseStatus.APPROVED
            )
        )
        total_expenses = float(expenses_result.scalar() or 0)

        # Outstanding invoices
        outstanding_result = await self.db.execute(
            select(func.coalesce(func.sum(Invoice.total), 0)).filter(
                Invoice.status.in_([InvoiceStatus.SENT, InvoiceStatus.VIEWED])
            )
        )
        outstanding_invoices = float(outstanding_result.scalar() or 0)

        # Overdue amount
        overdue_result = await self.db.execute(
            select(func.coalesce(func.sum(Invoice.total), 0)).filter(
                Invoice.status == InvoiceStatus.OVERDUE
            )
        )
        overdue_amount = float(overdue_result.scalar() or 0)

        # Paid this month
        from datetime import date
        from calendar import monthrange
        today = date.today()
        first_day = today.replace(day=1)
        last_day = today.replace(day=monthrange(today.year, today.month)[1])

        paid_month_result = await self.db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).filter(
                Payment.status == PaymentStatus.COMPLETED,
                Payment.payment_date >= first_day,
                Payment.payment_date <= last_day,
            )
        )
        paid_this_month = float(paid_month_result.scalar() or 0)

        # Expenses this month
        expenses_month_result = await self.db.execute(
            select(func.coalesce(func.sum(Expense.amount), 0)).filter(
                Expense.status.in_([ExpenseStatus.APPROVED, ExpenseStatus.PAID]),
                Expense.expense_date >= first_day,
                Expense.expense_date <= last_day,
            )
        )
        expenses_this_month = float(expenses_month_result.scalar() or 0)

        return FinanceStats(
            total_revenue=total_revenue,
            total_expenses=total_expenses,
            outstanding_invoices=outstanding_invoices,
            overdue_amount=overdue_amount,
            paid_this_month=paid_this_month,
            expenses_this_month=expenses_this_month,
        )
