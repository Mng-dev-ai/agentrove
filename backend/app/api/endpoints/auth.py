from fastapi import APIRouter, Depends, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.auth import (
    GetUserUsageAction,
    LoginAction,
    LogoutAction,
    RefreshAccessTokenAction,
    RegisterAction,
)
from app.core.deps import (
    get_login_action,
    get_logout_action,
    get_refresh_access_token_action,
    get_register_action,
    get_user_usage_action,
)
from app.core.user_manager import (
    UserDatabase,
    UserManager,
    current_active_user,
    fastapi_users,
    get_user_db,
    get_user_manager,
)
from app.db.session import get_db
from app.models.db_models import User
from app.models.schemas import (
    LogoutRequest,
    RefreshTokenRequest,
    Token,
    UserCreate,
    UserOut,
    UserRead,
    UserUsage,
)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/jwt/login", response_model=Token)
@limiter.limit("5/minute")
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_db: UserDatabase = Depends(get_user_db),
    db: AsyncSession = Depends(get_db),
    login_action: LoginAction = Depends(get_login_action),
) -> Token:
    return await login_action.execute(
        request=request,
        form_data=form_data,
        user_db=user_db,
        db=db,
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/minute")
async def register(
    request: Request,
    user_create: UserCreate,
    user_manager: UserManager = Depends(get_user_manager),
    register_action: RegisterAction = Depends(get_register_action),
) -> User:
    return await register_action.execute(user_create, user_manager)


router.include_router(
    fastapi_users.get_reset_password_router(),
)
router.include_router(
    fastapi_users.get_verify_router(UserRead),
)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(current_active_user)) -> User:
    return current_user


@router.get("/usage", response_model=UserUsage)
async def get_user_usage(
    current_user: User = Depends(current_active_user),
    user_usage_action: GetUserUsageAction = Depends(get_user_usage_action),
) -> UserUsage:
    return await user_usage_action.execute(current_user)


@router.post("/jwt/refresh", response_model=Token)
@limiter.limit("10/minute")
async def refresh_access_token(
    request: Request,
    refresh_request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
    refresh_access_token_action: RefreshAccessTokenAction = Depends(
        get_refresh_access_token_action
    ),
) -> Token:
    return await refresh_access_token_action.execute(
        request=request,
        refresh_request=refresh_request,
        db=db,
    )


@router.post("/jwt/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    logout_request: LogoutRequest,
    db: AsyncSession = Depends(get_db),
    logout_action: LogoutAction = Depends(get_logout_action),
) -> None:
    await logout_action.execute(logout_request, db)
