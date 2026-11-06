from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions as fastapi_users_exceptions
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_refresh_token_service
from app.core.security import verify_password
from app.core.user_manager import (
    RegistrationClosed,
    UserDatabase,
    UserManager,
    current_active_user,
    fastapi_users,
    get_current_device_id,
    get_jwt_strategy,
    get_user_db,
    get_user_manager,
    reject_agent_token,
)
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.schemas.auth import (
    LogoutRequest,
    PairedDeviceOut,
    PairingSecretOut,
    PairRequest,
    PairResponse,
    RefreshTokenRequest,
    Token,
    UserCreate,
    UserOut,
    UserRead,
)
from app.services.email import email_service
from app.services.exceptions import AuthException
from app.services.instance import get_instance_id
from app.services.pairing import PairingService
from app.services.refresh_token import RefreshTokenService

settings = get_settings()
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


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

    strategy = get_jwt_strategy(db)
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


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/minute")
async def register(
    request: Request,
    user_create: UserCreate,
    user_manager: UserManager = Depends(get_user_manager),
) -> User:
    if settings.BLOCK_DISPOSABLE_EMAILS:
        if await email_service.is_disposable_email(user_create.email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Disposable email addresses are not allowed. Please use a permanent email address.",
            )

    try:
        user = await user_manager.register(user_create)
    except RegistrationClosed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed",
        )
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
    return user


router.include_router(
    fastapi_users.get_reset_password_router(),
)
router.include_router(
    fastapi_users.get_verify_router(UserRead),
)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(current_active_user)) -> User:
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
        (
            user,
            new_refresh_token,
            device_id,
        ) = await refresh_token_service.validate_and_rotate(
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

    strategy = get_jwt_strategy(db)
    access_token = await strategy.write_token(user, device_id)

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


@router.post(
    "/pairing",
    response_model=PairingSecretOut,
    dependencies=[Depends(reject_agent_token)],
)
async def create_pairing_secret(
    current_user: User = Depends(current_active_user),
    current_device_id: UUID | None = Depends(get_current_device_id),
    db: AsyncSession = Depends(get_db),
) -> PairingSecretOut:
    if current_device_id is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Pairing links can only be created from a password sign-in",
        )
    secret, expires_at = await PairingService.create_secret(current_user.id, db)
    return PairingSecretOut(secret=secret, expires_at=expires_at)


@router.post("/pair", response_model=PairResponse)
@limiter.limit("5/minute")
async def pair(
    request: Request,
    pair_request: PairRequest,
    db: AsyncSession = Depends(get_db),
) -> PairResponse:
    try:
        user, device, refresh_token = await PairingService.redeem(
            secret=pair_request.secret,
            device_name=pair_request.device_name,
            db=db,
            user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None,
        )
    except AuthException:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired pairing link",
        )

    access_token = await get_jwt_strategy(db).write_token(user, device.id)
    return PairResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        device_id=device.id,
        instance_id=await get_instance_id(db),
    )


@router.get(
    "/devices",
    response_model=list[PairedDeviceOut],
    dependencies=[Depends(reject_agent_token)],
)
async def list_devices(
    current_user: User = Depends(current_active_user),
    current_device_id: UUID | None = Depends(get_current_device_id),
    db: AsyncSession = Depends(get_db),
) -> list[PairedDeviceOut]:
    devices = await PairingService.list_devices(current_user.id, db)
    return [
        PairedDeviceOut(
            id=device.id,
            name=device.name,
            created_at=device.created_at,
            last_used_at=device.last_used_at,
            current=device.id == current_device_id,
        )
        for device in devices
    ]


@router.delete(
    "/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(reject_agent_token)],
)
async def revoke_device(
    device_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not await PairingService.revoke_device(current_user.id, device_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Device not found"
        )
