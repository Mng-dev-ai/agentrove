from datetime import datetime
from uuid import UUID
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


# Bank Account schemas
class BankAccountBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    bank_name: str = Field(..., min_length=1, max_length=128)
    account_holder: str = Field(..., min_length=1, max_length=128)
    iban: str = Field(..., min_length=1, max_length=34)
    account_number: str | None = None
    routing_number: str | None = None
    swift_bic: str | None = None
    currency: str = "USD"
    is_primary: bool = False
    notes: str | None = None


class BankAccountCreate(BankAccountBase):
    pass


class BankAccountUpdate(BaseModel):
    name: str | None = None
    bank_name: str | None = None
    account_holder: str | None = None
    iban: str | None = None
    account_number: str | None = None
    routing_number: str | None = None
    swift_bic: str | None = None
    currency: str | None = None
    is_primary: bool | None = None
    is_active: bool | None = None
    notes: str | None = None


class BankAccountOut(BankAccountBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime


# Payment Notification schemas
class PaymentNotificationBase(BaseModel):
    project_id: UUID | None = None
    invoice_id: UUID | None = None
    amount: Decimal
    currency: str = "USD"
    payment_date: datetime
    payment_method: str = Field(..., min_length=1, max_length=32)
    sender_name: str | None = None
    sender_bank: str | None = None
    reference_number: str | None = None
    notes: str | None = None


class PaymentNotificationCreate(PaymentNotificationBase):
    receipt_file_url: str | None = None
    receipt_file_name: str | None = None


class PaymentNotificationUpdate(BaseModel):
    amount: Decimal | None = None
    currency: str | None = None
    payment_date: datetime | None = None
    payment_method: str | None = None
    sender_name: str | None = None
    sender_bank: str | None = None
    reference_number: str | None = None
    receipt_file_url: str | None = None
    receipt_file_name: str | None = None
    notes: str | None = None


class PaymentNotificationOut(PaymentNotificationBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    customer_id: UUID
    receipt_file_url: str | None
    receipt_file_name: str | None
    status: str
    ticket_id: UUID | None
    verified_by: UUID | None
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime


class PaymentNotificationWithCustomerOut(PaymentNotificationOut):
    customer_name: str
    customer_email: str
    project_name: str | None = None
    invoice_number: str | None = None


# Project Request schemas
class ProjectRequestBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(..., min_length=1)
    budget: Decimal | None = None
    budget_range: str | None = None
    topics: str | None = None
    desired_start_date: datetime | None = None
    desired_end_date: datetime | None = None
    requirements: str | None = None


class ProjectRequestCreate(ProjectRequestBase):
    attachments: str | None = None  # JSON array of file info
    attachment_url: str | None = None
    attachment_name: str | None = None


class ProjectRequestUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    budget: Decimal | None = None
    budget_range: str | None = None
    topics: str | None = None
    desired_start_date: datetime | None = None
    desired_end_date: datetime | None = None
    requirements: str | None = None
    attachments: str | None = None
    attachment_url: str | None = None
    attachment_name: str | None = None


class ProjectRequestReview(BaseModel):
    status: str  # approved, rejected
    review_notes: str | None = None
    rejection_reason: str | None = None  # Required if rejected


class ProjectRequestOut(ProjectRequestBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    customer_id: UUID
    attachments: str | None
    attachment_url: str | None
    attachment_name: str | None
    status: str
    rejection_reason: str | None
    ticket_id: UUID | None
    project_id: UUID | None
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    review_notes: str | None
    created_at: datetime
    updated_at: datetime


class ProjectRequestWithCustomerOut(ProjectRequestOut):
    customer_name: str
    customer_email: str
    project_name: str | None = None
