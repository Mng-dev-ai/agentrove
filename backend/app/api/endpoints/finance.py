import logging
from uuid import UUID
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.db_models.finance import InvoiceStatus, PaymentStatus, ExpenseStatus
from app.models.schemas.finance import (
    InvoiceCreate,
    InvoiceUpdate,
    InvoiceOut,
    PaymentCreate,
    PaymentOut,
    ExpenseCreate,
    ExpenseUpdate,
    ExpenseOut,
    FinanceStatsOut,
)
from app.services.finance_service import FinanceService
from app.services.rbac_service import RBACService

logger = logging.getLogger(__name__)
router = APIRouter()


async def check_finance_permission(
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
    permission: str = "finance.view",
) -> tuple[User, list[str]]:
    """Check if user has finance permission."""
    rbac_service = RBACService(db)
    permissions = await rbac_service.get_user_permissions(user.id)
    if permission not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Finance access required",
        )
    return user, permissions


# Invoice endpoints
@router.get("/invoices", response_model=dict)
async def list_invoices(
    customer_id: str | None = None,
    project_id: str | None = None,
    invoice_status: InvoiceStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List invoices with filtering and pagination."""
    user, permissions = user_data
    service = FinanceService(db)

    invoices, total = await service.get_invoices(
        customer_id=UUID(customer_id) if customer_id else None,
        project_id=UUID(project_id) if project_id else None,
        status=invoice_status,
        page=page,
        page_size=page_size,
    )

    return {
        "items": [InvoiceOut.model_validate(i) for i in invoices],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
async def get_invoice(
    invoice_id: str,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    """Get a specific invoice."""
    user, permissions = user_data
    service = FinanceService(db)
    invoice = await service.get_invoice(UUID(invoice_id))

    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not found",
        )

    return InvoiceOut.model_validate(invoice)


@router.post("/invoices", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    data: InvoiceCreate,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    """Create a new invoice."""
    user, permissions = user_data
    if "finance.create" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invoice creation permission required",
        )

    service = FinanceService(db)
    invoice = await service.create_invoice(data, user.id)
    return InvoiceOut.model_validate(invoice)


@router.patch("/invoices/{invoice_id}", response_model=InvoiceOut)
async def update_invoice(
    invoice_id: str,
    data: InvoiceUpdate,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    """Update an invoice."""
    user, permissions = user_data
    if "finance.edit" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invoice edit permission required",
        )

    service = FinanceService(db)
    invoice = await service.update_invoice(UUID(invoice_id), data)

    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not found",
        )

    return InvoiceOut.model_validate(invoice)


@router.delete("/invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invoice(
    invoice_id: str,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an invoice."""
    user, permissions = user_data
    if "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = FinanceService(db)
    deleted = await service.delete_invoice(UUID(invoice_id))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not found",
        )


# Payment endpoints
@router.get("/payments", response_model=dict)
async def list_payments(
    invoice_id: str | None = None,
    payment_status: PaymentStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List payments with filtering and pagination."""
    user, permissions = user_data
    service = FinanceService(db)

    payments, total = await service.get_payments(
        invoice_id=UUID(invoice_id) if invoice_id else None,
        status=payment_status,
        page=page,
        page_size=page_size,
    )

    return {
        "items": [PaymentOut.model_validate(p) for p in payments],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.post("/payments", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
async def create_payment(
    data: PaymentCreate,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> PaymentOut:
    """Record a payment for an invoice."""
    user, permissions = user_data
    if "finance.create" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Payment creation permission required",
        )

    service = FinanceService(db)
    payment = await service.create_payment(data, user.id)
    return PaymentOut.model_validate(payment)


# Expense endpoints
@router.get("/expenses", response_model=dict)
async def list_expenses(
    project_id: str | None = None,
    expense_status: ExpenseStatus | None = Query(None, alias="status"),
    submitted_by: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List expenses with filtering and pagination."""
    user, permissions = user_data
    service = FinanceService(db)

    expenses, total = await service.get_expenses(
        project_id=UUID(project_id) if project_id else None,
        status=expense_status,
        submitted_by=UUID(submitted_by) if submitted_by else None,
        page=page,
        page_size=page_size,
    )

    return {
        "items": [ExpenseOut.model_validate(e) for e in expenses],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/expenses/{expense_id}", response_model=ExpenseOut)
async def get_expense(
    expense_id: str,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    """Get a specific expense."""
    user, permissions = user_data
    service = FinanceService(db)
    expense = await service.get_expense(UUID(expense_id))

    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found",
        )

    return ExpenseOut.model_validate(expense)


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(
    data: ExpenseCreate,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    """Submit a new expense."""
    user, permissions = user_data
    if "finance.create" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Expense creation permission required",
        )

    service = FinanceService(db)
    expense = await service.create_expense(data, user.id)
    return ExpenseOut.model_validate(expense)


@router.patch("/expenses/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    expense_id: str,
    data: ExpenseUpdate,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    """Update an expense."""
    user, permissions = user_data
    if "finance.edit" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Expense edit permission required",
        )

    service = FinanceService(db)
    expense = await service.update_expense(UUID(expense_id), data)

    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found",
        )

    return ExpenseOut.model_validate(expense)


@router.post("/expenses/{expense_id}/approve", response_model=ExpenseOut)
async def approve_expense(
    expense_id: str,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    """Approve an expense."""
    user, permissions = user_data
    if "finance.approve" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Expense approval permission required",
        )

    service = FinanceService(db)
    expense = await service.approve_expense(UUID(expense_id), user.id)

    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found",
        )

    return ExpenseOut.model_validate(expense)


@router.post("/expenses/{expense_id}/reject", response_model=ExpenseOut)
async def reject_expense(
    expense_id: str,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    """Reject an expense."""
    user, permissions = user_data
    if "finance.approve" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Expense approval permission required",
        )

    service = FinanceService(db)
    expense = await service.reject_expense(UUID(expense_id), user.id)

    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found",
        )

    return ExpenseOut.model_validate(expense)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    expense_id: str,
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an expense."""
    user, permissions = user_data
    if "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = FinanceService(db)
    deleted = await service.delete_expense(UUID(expense_id))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found",
        )


# Statistics
@router.get("/stats", response_model=FinanceStatsOut)
async def get_finance_stats(
    user_data: tuple[User, list[str]] = Depends(check_finance_permission),
    db: AsyncSession = Depends(get_db),
) -> FinanceStatsOut:
    """Get financial statistics."""
    user, permissions = user_data
    service = FinanceService(db)
    stats = await service.get_finance_stats()
    return stats
