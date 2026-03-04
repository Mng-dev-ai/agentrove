from datetime import datetime
from uuid import UUID
from enum import Enum
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class InvoiceStatus(str, Enum):
    DRAFT = "draft"
    SENT = "sent"
    VIEWED = "viewed"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class PaymentStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"


class PaymentMethod(str, Enum):
    BANK_TRANSFER = "bank_transfer"
    CREDIT_CARD = "credit_card"
    PAYPAL = "paypal"
    STRIPE = "stripe"
    CASH = "cash"
    OTHER = "other"


class ExpenseStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    PAID = "paid"
    REJECTED = "rejected"


# Invoice Item
class InvoiceItemBase(BaseModel):
    description: str = Field(..., min_length=1, max_length=256)
    quantity: Decimal = Decimal("1")
    unit_price: Decimal
    sort_order: int = 0


class InvoiceItemCreate(InvoiceItemBase):
    pass


class InvoiceItemOut(InvoiceItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    invoice_id: UUID
    total: Decimal
    created_at: datetime


# Invoice
class InvoiceBase(BaseModel):
    invoice_number: str = Field(..., min_length=1, max_length=32)
    project_id: UUID | None = None
    customer_id: UUID
    issue_date: datetime
    due_date: datetime
    subtotal: Decimal = Decimal("0")
    tax_rate: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    currency: str = "USD"
    notes: str | None = None
    terms: str | None = None


class InvoiceCreate(InvoiceBase):
    items: list[InvoiceItemCreate] = []


class InvoiceUpdate(BaseModel):
    invoice_number: str | None = None
    project_id: UUID | None = None
    customer_id: UUID | None = None
    status: InvoiceStatus | None = None
    issue_date: datetime | None = None
    due_date: datetime | None = None
    subtotal: Decimal | None = None
    tax_rate: Decimal | None = None
    discount: Decimal | None = None
    currency: str | None = None
    notes: str | None = None
    terms: str | None = None
    items: list[InvoiceItemCreate] | None = None


class InvoiceOut(InvoiceBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: InvoiceStatus
    tax_amount: Decimal
    total: Decimal
    paid_at: datetime | None = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class InvoiceWithItemsOut(InvoiceOut):
    items: list[InvoiceItemOut] = []
    customer_name: str
    customer_email: str
    project_name: str | None = None
    payments_total: Decimal = Decimal("0")
    amount_due: Decimal = Decimal("0")


# Payment
class PaymentBase(BaseModel):
    invoice_id: UUID
    amount: Decimal
    currency: str = "USD"
    payment_method: PaymentMethod = PaymentMethod.BANK_TRANSFER
    transaction_id: str | None = None
    payment_date: datetime
    notes: str | None = None


class PaymentCreate(PaymentBase):
    pass


class PaymentOut(PaymentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: PaymentStatus
    recorded_by: UUID
    created_at: datetime


class PaymentWithInvoiceOut(PaymentOut):
    invoice_number: str
    customer_name: str


# Expense
class ExpenseBase(BaseModel):
    project_id: UUID | None = None
    category: str = Field(..., min_length=1, max_length=64)
    description: str = Field(..., min_length=1, max_length=256)
    amount: Decimal
    currency: str = "USD"
    expense_date: datetime
    receipt_url: str | None = None
    notes: str | None = None


class ExpenseCreate(ExpenseBase):
    pass


class ExpenseUpdate(BaseModel):
    project_id: UUID | None = None
    category: str | None = None
    description: str | None = None
    amount: Decimal | None = None
    currency: str | None = None
    expense_date: datetime | None = None
    status: ExpenseStatus | None = None
    receipt_url: str | None = None
    notes: str | None = None


class ExpenseOut(ExpenseBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: ExpenseStatus
    submitted_by: UUID
    approved_by: UUID | None = None
    approved_at: datetime | None = None
    paid_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ExpenseWithUserOut(ExpenseOut):
    submitter_name: str
    submitter_email: str
    approver_name: str | None = None
    project_name: str | None = None


# Statistics
class FinanceStats(BaseModel):
    total_revenue: float
    total_expenses: float
    outstanding_invoices: float
    overdue_amount: float
    paid_this_month: float
    expenses_this_month: float


FinanceStatsOut = FinanceStats
