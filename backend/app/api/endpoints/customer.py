import logging
from uuid import UUID
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.schemas.customer import (
    BankAccountCreate,
    BankAccountUpdate,
    BankAccountOut,
    PaymentNotificationCreate,
    PaymentNotificationOut,
    PaymentNotificationWithCustomerOut,
    ProjectRequestCreate,
    ProjectRequestOut,
    ProjectRequestWithCustomerOut,
    ProjectRequestReview,
)
from app.services.customer_service import CustomerService
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


# ============ Bank Accounts (Admin only) ============

@router.get("/bank-accounts", response_model=list[BankAccountOut])
async def list_bank_accounts(
    active_only: bool = True,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> list[BankAccountOut]:
    """List all bank accounts (admin only)."""
    user, permissions = user_data
    if "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = CustomerService(db)
    accounts = await service.get_bank_accounts(active_only=active_only)
    return [BankAccountOut.model_validate(a) for a in accounts]


@router.post("/bank-accounts", response_model=BankAccountOut, status_code=status.HTTP_201_CREATED)
async def create_bank_account(
    data: BankAccountCreate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> BankAccountOut:
    """Create a new bank account (admin only)."""
    user, permissions = user_data
    if "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = CustomerService(db)
    account = await service.create_bank_account(data, user.id)
    return BankAccountOut.model_validate(account)


@router.patch("/bank-accounts/{account_id}", response_model=BankAccountOut)
async def update_bank_account(
    account_id: str,
    data: BankAccountUpdate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> BankAccountOut:
    """Update a bank account (admin only)."""
    user, permissions = user_data
    if "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = CustomerService(db)
    account = await service.update_bank_account(UUID(account_id), data)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank account not found",
        )
    return BankAccountOut.model_validate(account)


@router.delete("/bank-accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bank_account(
    account_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a bank account (admin only)."""
    user, permissions = user_data
    if "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    service = CustomerService(db)
    deleted = await service.delete_bank_account(UUID(account_id))
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bank account not found",
        )


# ============ Customer Bank Account View ============

@router.get("/bank-info", response_model=list[BankAccountOut])
async def get_customer_bank_info(
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> list[BankAccountOut]:
    """Get active bank account information for customers."""
    user, permissions = user_data
    service = CustomerService(db)
    accounts = await service.get_active_bank_accounts()
    return [BankAccountOut.model_validate(a) for a in accounts]


# ============ Payment Notifications ============

@router.get("/payment-notifications", response_model=dict)
async def list_payment_notifications(
    notification_status: str | None = Query(None, alias="status"),
    customer_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List payment notifications (admin/manager view)."""
    user, permissions = user_data
    if "finance.view" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Finance access required",
        )

    service = CustomerService(db)
    notifications, total = await service.get_payment_notifications(
        status=notification_status,
        customer_id=UUID(customer_id) if customer_id else None,
        page=page,
        page_size=page_size,
    )

    return {
        "items": [PaymentNotificationOut.model_validate(n) for n in notifications],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/payment-notifications/my", response_model=dict)
async def list_my_payment_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List current user's payment notifications."""
    user, permissions = user_data
    service = CustomerService(db)
    notifications, total = await service.get_customer_payment_notifications(
        customer_id=user.id,
        page=page,
        page_size=page_size,
    )

    return {
        "items": [PaymentNotificationOut.model_validate(n) for n in notifications],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.post("/payment-notifications", response_model=PaymentNotificationOut, status_code=status.HTTP_201_CREATED)
async def create_payment_notification(
    data: PaymentNotificationCreate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> PaymentNotificationOut:
    """Create a payment notification (customer)."""
    user, permissions = user_data
    service = CustomerService(db)
    notification = await service.create_payment_notification(data, user.id, permissions)
    return PaymentNotificationOut.model_validate(notification)


@router.post("/payment-notifications/{notification_id}/verify", response_model=PaymentNotificationOut)
async def verify_payment_notification(
    notification_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> PaymentNotificationOut:
    """Verify a payment notification (admin/manager)."""
    user, permissions = user_data
    if "finance.approve" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Finance approval permission required",
        )

    service = CustomerService(db)
    notification = await service.verify_payment_notification(UUID(notification_id), user.id)
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment notification not found",
        )
    return PaymentNotificationOut.model_validate(notification)


@router.post("/payment-notifications/{notification_id}/reject", response_model=PaymentNotificationOut)
async def reject_payment_notification(
    notification_id: str,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> PaymentNotificationOut:
    """Reject a payment notification (admin/manager)."""
    user, permissions = user_data
    if "finance.approve" not in permissions and "finance.admin" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Finance approval permission required",
        )

    service = CustomerService(db)
    notification = await service.reject_payment_notification(UUID(notification_id), user.id)
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment notification not found",
        )
    return PaymentNotificationOut.model_validate(notification)


# ============ Project Requests ============

@router.get("/project-requests", response_model=dict)
async def list_project_requests(
    request_status: str | None = Query(None, alias="status"),
    customer_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List project requests (admin/manager view)."""
    user, permissions = user_data
    if "projects.view" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Projects access required",
        )

    service = CustomerService(db)
    requests, total = await service.get_project_requests(
        status=request_status,
        customer_id=UUID(customer_id) if customer_id else None,
        page=page,
        page_size=page_size,
    )

    return {
        "items": [ProjectRequestOut.model_validate(r) for r in requests],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/project-requests/my", response_model=dict)
async def list_my_project_requests(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List current user's project requests."""
    user, permissions = user_data
    service = CustomerService(db)
    requests, total = await service.get_customer_project_requests(
        customer_id=user.id,
        page=page,
        page_size=page_size,
    )

    return {
        "items": [ProjectRequestOut.model_validate(r) for r in requests],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.post("/project-requests", response_model=ProjectRequestOut, status_code=status.HTTP_201_CREATED)
async def create_project_request(
    data: ProjectRequestCreate,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> ProjectRequestOut:
    """Create a project request (customer)."""
    user, permissions = user_data
    service = CustomerService(db)
    request = await service.create_project_request(data, user.id)
    return ProjectRequestOut.model_validate(request)


@router.post("/project-requests/{request_id}/review", response_model=ProjectRequestOut)
async def review_project_request(
    request_id: str,
    data: ProjectRequestReview,
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> ProjectRequestOut:
    """Review a project request (admin/manager)."""
    user, permissions = user_data
    if "projects.create" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project creation permission required",
        )

    service = CustomerService(db)
    request = await service.review_project_request(UUID(request_id), data, user.id)
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project request not found",
        )
    return ProjectRequestOut.model_validate(request)


@router.post("/project-requests/{request_id}/convert", response_model=ProjectRequestOut)
async def convert_project_request(
    request_id: str,
    project_id: str = Query(..., alias="project_id"),
    user_data: tuple[User, list[str]] = Depends(get_user_permissions),
    db: AsyncSession = Depends(get_db),
) -> ProjectRequestOut:
    """Convert a project request to an actual project."""
    user, permissions = user_data
    if "projects.create" not in permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project creation permission required",
        )

    service = CustomerService(db)
    request = await service.convert_to_project(UUID(request_id), UUID(project_id), user.id)
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project request not found",
        )
    return ProjectRequestOut.model_validate(request)
