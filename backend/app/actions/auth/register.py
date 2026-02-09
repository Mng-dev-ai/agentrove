from typing import cast

from fastapi import HTTPException, status
from fastapi_users import exceptions as fastapi_users_exceptions
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.user_manager import UserManager
from app.models.db_models import User
from app.models.schemas import UserCreate
from app.services.email import email_service

settings = get_settings()


class RegisterAction:
    async def execute(self, user_create: UserCreate, user_manager: UserManager) -> User:
        if settings.BLOCK_DISPOSABLE_EMAILS:
            if await email_service.is_disposable_email(user_create.email):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Disposable email addresses are not allowed. Please use a permanent email address.",
                )

        try:
            user = await user_manager.create(user_create)
        except fastapi_users_exceptions.UserAlreadyExists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
        except IntegrityError as exc:
            error_info = str(exc.orig).lower()
            if "username" in error_info:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Username already registered",
                )
            if "email" in error_info:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered",
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Registration failed due to a constraint violation",
            )

        return cast(User, user)
