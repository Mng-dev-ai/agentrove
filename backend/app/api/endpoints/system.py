import logging
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_manager import current_active_user
from app.db.session import get_db
from app.models.db_models.user import User, UserSettings
from app.models.db_models.system import SystemSettings
from app.models.schemas.system import (
    InstanceConfigRequest,
    MasterPasswordSetRequest,
    MasterPasswordVerifyRequest,
    RemoteDbConfigRequest,
    SystemStatusResponse,
    SmtpConfigRequest,
    SmtpStatusResponse,
    SmtpTestRequest,
)
from app.services.system_service import SystemService
from app.services.migration_service import MigrationService

logger = logging.getLogger(__name__)
router = APIRouter()


class EnterpriseModeRequest(BaseModel):
    enabled: bool


class EnterpriseModeResponse(BaseModel):
    enabled: bool


async def get_current_superuser(user: User = Depends(current_active_user)) -> User:
    """Dependency that ensures the current user is a superuser."""
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


# Public endpoints for startup/migration (no auth required)
@router.get("/startup-status")
async def get_startup_status(
    session: AsyncSession = Depends(get_db),
):
    """Get startup status for splash screen (public, used before auth)."""
    service = MigrationService(session)
    return await service.get_startup_status()


@router.post("/run-migrations")
async def run_migrations(
    session: AsyncSession = Depends(get_db),
):
    """Run migrations on startup (public, used before auth)."""
    service = MigrationService(session)
    return await service.run_migrations()


@router.get("/status", response_model=SystemStatusResponse)
async def get_system_status(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Get system configuration status (admin only)."""
    service = SystemService(session)
    return await service.get_status()


@router.post("/master-password")
async def set_master_password(
    data: MasterPasswordSetRequest,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Set master password for remote database connections (admin only)."""
    service = SystemService(session)
    await service.set_master_password(data.password)
    logger.info(f"Master password set by admin user {current_user.id}")
    return {"success": True, "message": "Master password set successfully"}


@router.post("/master-password/verify")
async def verify_master_password(
    data: MasterPasswordVerifyRequest,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Verify master password (admin only)."""
    service = SystemService(session)
    valid = await service.verify_master_password(data.password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid master password",
        )
    return {"success": True, "message": "Master password verified"}


@router.post("/remote-db")
async def configure_remote_db(
    data: RemoteDbConfigRequest,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Configure remote database connection (admin only)."""
    service = SystemService(session)
    try:
        await service.configure_remote_db(
            db_url=data.db_url,
            enabled=data.enabled,
            master_password=data.master_password,
        )
        logger.info(f"Remote DB configured by admin user {current_user.id}")
        return {"success": True, "message": "Remote database configured successfully"}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.delete("/remote-db")
async def disable_remote_db(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Disable remote database connection (admin only)."""
    service = SystemService(session)
    await service.disable_remote_db()
    logger.info(f"Remote DB disabled by admin user {current_user.id}")
    return {"success": True, "message": "Remote database disabled"}


@router.post("/instance")
async def configure_instance(
    data: InstanceConfigRequest,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Configure instance settings (admin only)."""
    service = SystemService(session)
    await service.set_instance_config(
        instance_name=data.instance_name,
        is_web_master=data.is_web_master,
        allow_remote_connections=data.allow_remote_connections,
    )
    logger.info(f"Instance config updated by admin user {current_user.id}")
    return {"success": True, "message": "Instance configuration updated"}


# Enterprise Mode endpoints
@router.get("/enterprise-mode", response_model=EnterpriseModeResponse)
async def get_enterprise_mode(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(current_active_user),
):
    """Get enterprise mode status."""
    # Get the first user's settings (system-wide setting)
    result = await session.execute(
        select(UserSettings).order_by(UserSettings.created_at).limit(1)
    )
    settings = result.scalar_one_or_none()
    return EnterpriseModeResponse(enabled=settings.enterprise_mode if settings else False)


@router.post("/enterprise-mode", response_model=EnterpriseModeResponse)
async def set_enterprise_mode(
    data: EnterpriseModeRequest,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Set enterprise mode status (admin only)."""
    # Get or create settings for the current user (store as system-wide setting)
    result = await session.execute(
        select(UserSettings).filter(UserSettings.user_id == current_user.id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        settings = UserSettings(user_id=current_user.id, enterprise_mode=data.enabled)
        session.add(settings)
    else:
        settings.enterprise_mode = data.enabled

    await session.commit()
    logger.info(f"Enterprise mode {'enabled' if data.enabled else 'disabled'} by admin user {current_user.id}")
    return EnterpriseModeResponse(enabled=data.enabled)


# SMTP Settings endpoints
@router.get("/smtp", response_model=SmtpStatusResponse)
async def get_smtp_settings(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Get SMTP settings (admin only)."""
    result = await session.execute(select(SystemSettings))
    settings = result.scalar_one_or_none()

    if not settings:
        return SmtpStatusResponse(enabled=False)

    return SmtpStatusResponse(
        enabled=settings.smtp_enabled or False,
        host=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        has_password=bool(settings.smtp_password),
        from_email=settings.smtp_from_email,
        from_name=settings.smtp_from_name,
        use_tls=settings.smtp_use_tls if settings.smtp_use_tls is not None else True,
        use_ssl=settings.smtp_use_ssl if settings.smtp_use_ssl is not None else False,
    )


@router.post("/smtp")
async def configure_smtp(
    data: SmtpConfigRequest,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Configure SMTP settings (admin only)."""
    result = await session.execute(select(SystemSettings))
    settings = result.scalar_one_or_none()

    if not settings:
        settings = SystemSettings()
        session.add(settings)

    settings.smtp_host = data.host
    settings.smtp_port = data.port
    settings.smtp_username = data.username
    if data.password:
        settings.smtp_password = data.password
    settings.smtp_from_email = data.from_email
    settings.smtp_from_name = data.from_name
    settings.smtp_use_tls = data.use_tls
    settings.smtp_use_ssl = data.use_ssl
    settings.smtp_enabled = data.enabled

    await session.commit()
    logger.info(f"SMTP settings configured by admin user {current_user.id}")
    return {"success": True, "message": "SMTP settings saved successfully"}


@router.delete("/smtp")
async def disable_smtp(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Disable SMTP (admin only)."""
    result = await session.execute(select(SystemSettings))
    settings = result.scalar_one_or_none()

    if settings:
        settings.smtp_enabled = False
        await session.commit()

    logger.info(f"SMTP disabled by admin user {current_user.id}")
    return {"success": True, "message": "SMTP disabled"}


@router.post("/smtp/test")
async def test_smtp(
    data: SmtpTestRequest,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    """Test SMTP connection by sending a test email (admin only)."""
    import aiosmtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    result = await session.execute(select(SystemSettings))
    settings = result.scalar_one_or_none()

    if not settings or not settings.smtp_host or not settings.smtp_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SMTP not configured",
        )

    try:
        message = MIMEMultipart("alternative")
        message["Subject"] = "Claudex SMTP Test"
        message["From"] = f"{settings.smtp_from_name or 'Claudex'} <{settings.smtp_from_email}>"
        message["To"] = data.test_email

        html_part = MIMEText(
            "<p>This is a test email from Claudex.</p>"
            "<p>If you received this email, your SMTP settings are working correctly.</p>",
            "html"
        )
        message.attach(html_part)

        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            start_tls=settings.smtp_use_tls,
            use_tls=settings.smtp_use_ssl,
        )

        logger.info(f"SMTP test email sent to {data.test_email} by admin user {current_user.id}")
        return {"success": True, "message": f"Test email sent to {data.test_email}"}
    except Exception as e:
        logger.error(f"SMTP test failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to send test email: {str(e)}",
        )
