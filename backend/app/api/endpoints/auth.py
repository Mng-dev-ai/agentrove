import secrets
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions as fastapi_users_exceptions
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_refresh_token_service
from app.core.security import (
    DESKTOP_LOCAL_EMAIL,
    DESKTOP_LOCAL_USERNAME,
    get_current_user,
    get_password_hash,
    is_desktop_local_email,
    is_desktop_local_user,
    is_user_allowed_for_current_mode,
    verify_password,
)
from app.core.user_manager import (
    UserDatabase,
    UserManager,
    fastapi_users,
    get_jwt_strategy,
    get_user_db,
    get_user_manager,
)
from app.db.session import get_db
from app.models.db_models.user import User, UserSettings
from app.models.schemas.auth import (
    DesktopLocalSession,
    LogoutRequest,
    RefreshTokenRequest,
    Token,
    UserCreate,
    UserOut,
    UserRead,
)
from app.services.email import email_service
from app.services.exceptions import AuthException
from app.services.refresh_token import RefreshTokenService

settings = get_settings()
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

DESKTOP_LOCAL_USERNAME_ATTEMPTS = 8


def _disabled_desktop_password_hash() -> str:
    return get_password_hash(secrets.token_urlsafe(64))


async def _fetch_desktop_local_user(db: AsyncSession) -> User | None:
    result = await db.execute(select(User).where(User.email == DESKTOP_LOCAL_EMAIL))
    return result.scalar_one_or_none()


async def _create_desktop_local_user(db: AsyncSession) -> User:
    for attempt in range(DESKTOP_LOCAL_USERNAME_ATTEMPTS):
        username = (
            DESKTOP_LOCAL_USERNAME
            if attempt == 0
            else f"{DESKTOP_LOCAL_USERNAME}_{secrets.token_hex(4)}"
        )
        user = User(
            email=DESKTOP_LOCAL_EMAIL,
            username=username,
            hashed_password=_disabled_desktop_password_hash(),
            is_active=True,
            is_verified=True,
            is_superuser=False,
        )
        db.add(user)
        try:
            await db.flush()
            return user
        except IntegrityError:
            await db.rollback()
            user = await _fetch_desktop_local_user(db)
            if user is not None:
                return user

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Desktop local user could not be created",
    )


async def _get_or_create_desktop_local_user(db: AsyncSession) -> User:
    user = await _fetch_desktop_local_user(db)

    if user is None:
        user = await _create_desktop_local_user(db)

    user.hashed_password = _disabled_desktop_password_hash()
    changed = True
    if not user.is_active:
        user.is_active = True
    if not user.is_verified:
        user.is_verified = True

    settings_result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    if settings_result.scalar_one_or_none() is None:
        db.add(UserSettings(user_id=user.id, github_personal_access_token=None))
        changed = True

    if changed:
        await db.flush()

    await db.commit()
    await db.refresh(user)
    return user


@router.post("/jwt/login", response_model=Token)
@limiter.limit("5/minute")
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_db: UserDatabase = Depends(get_user_db),
    db: AsyncSession = Depends(get_db),
    refresh_token_service: RefreshTokenService = Depends(get_refresh_token_service),
) -> Token:
    user = await user_db.get_by_email(form_data.username)

    if user and is_desktop_local_user(user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or password",
        )

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is inactive",
        )

    if settings.REQUIRE_EMAIL_VERIFICATION and not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please verify your email before logging in",
        )

    strategy = get_jwt_strategy()
    access_token = await strategy.write_token(user)

    user_agent = request.headers.get("user-agent")
    client_ip = request.client.host if request.client else None
    refresh_token = await refresh_token_service.create_refresh_token(
        user_id=user.id,
        db=db,
        user_agent=user_agent,
        ip_address=client_ip,
    )

    return Token(
        access_token=access_token, refresh_token=refresh_token, token_type="bearer"
    )


@router.post("/desktop/local-session", response_model=DesktopLocalSession)
async def desktop_local_session(
    request: Request,
    db: AsyncSession = Depends(get_db),
    refresh_token_service: RefreshTokenService = Depends(get_refresh_token_service),
) -> DesktopLocalSession:
    if not settings.DESKTOP_MODE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    user = await _get_or_create_desktop_local_user(db)
    strategy = get_jwt_strategy()
    access_token = await strategy.write_token(user)

    user_agent = request.headers.get("user-agent")
    client_ip = request.client.host if request.client else None
    refresh_token = await refresh_token_service.create_refresh_token(
        user_id=user.id,
        db=db,
        user_agent=user_agent,
        ip_address=client_ip,
    )

    return DesktopLocalSession(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=UserRead.model_validate(user),
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/minute")
async def register(
    request: Request,
    user_create: UserCreate,
    user_manager: UserManager = Depends(get_user_manager),
) -> User:
    if settings.REGISTRATION_DISABLED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is disabled",
        )

    if is_desktop_local_email(str(user_create.email)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

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
    except IntegrityError as e:
        error_info = str(e.orig).lower()
        if "username" in error_info:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered",
            )
        elif "email" in error_info:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Registration failed due to a constraint violation",
            )
    return cast(User, user)


router.include_router(
    fastapi_users.get_reset_password_router(),
)
router.include_router(
    fastapi_users.get_verify_router(UserRead),
)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/jwt/refresh", response_model=Token)
@limiter.limit("10/minute")
async def refresh_access_token(
    request: Request,
    refresh_request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
    refresh_token_service: RefreshTokenService = Depends(get_refresh_token_service),
) -> Token:
    user_agent = request.headers.get("user-agent")
    client_ip = request.client.host if request.client else None

    try:
        user, new_refresh_token = await refresh_token_service.validate_and_rotate(
            token=refresh_request.refresh_token,
            db=db,
            user_agent=user_agent,
            ip_address=client_ip,
        )
    except AuthException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    if not is_user_allowed_for_current_mode(user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    strategy = get_jwt_strategy()
    access_token = await strategy.write_token(user)

    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
    )


@router.post("/jwt/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    logout_request: LogoutRequest,
    db: AsyncSession = Depends(get_db),
    refresh_token_service: RefreshTokenService = Depends(get_refresh_token_service),
) -> None:
    await refresh_token_service.revoke_token(logout_request.refresh_token, db)
