import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.docs import custom_openapi
from app.api.endpoints import (
    ai_models,
    auth,
    chat,
    sandbox,
    sandbox_proxy,
    websocket,
    attachments,
    permissions,
    scheduling,
    skills,
    commands,
    agents,
    mcps,
    marketplace,
)
from app.api.endpoints import settings as settings_router
from app.core.config import get_settings
from app.core.middleware import (
    setup_middleware,
)
from app.db.session import engine, celery_engine, SessionLocal
from app.admin.config import create_admin
from app.admin.views import (
    AIModelAdmin,
    UserAdmin,
    ChatAdmin,
    MessageAdmin,
    MessageAttachmentAdmin,
    UserSettingsAdmin,
)
from prometheus_fastapi_instrumentator import Instrumentator
from granian.utils.proxies import wrap_asgi_with_proxy_headers

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await engine.dispose()
    await celery_engine.dispose()


def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        docs_url=None
        if settings.ENVIRONMENT == "production"
        else f"{settings.API_V1_STR}/docs",
        openapi_url=None
        if settings.ENVIRONMENT == "production"
        else f"{settings.API_V1_STR}/openapi.json",
        lifespan=lifespan,
    )

    try:
        application.mount("/static", StaticFiles(directory="static"), name="static")
    except Exception as e:
        logger.debug("Static files directory not found, skipping mount: %s", e)

    try:
        storage_path = Path(settings.STORAGE_PATH)
        storage_path.mkdir(exist_ok=True)
    except Exception as e:
        logger.warning(
            "Failed to create storage directory at %s: %s", settings.STORAGE_PATH, e
        )

    setup_middleware(application)

    application.include_router(
        auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Authentication"]
    )
    application.include_router(
        chat.router, prefix=f"{settings.API_V1_STR}/chat", tags=["Chat"]
    )
    application.include_router(
        sandbox.router, prefix=f"{settings.API_V1_STR}/sandbox", tags=["Sandbox"]
    )
    application.include_router(
        sandbox_proxy.router, prefix=f"{settings.API_V1_STR}/sandbox", tags=["Sandbox Proxy"]
    )
    application.include_router(
        websocket.router, prefix=f"{settings.API_V1_STR}/ws", tags=["WebSocket"]
    )
    application.include_router(
        settings_router.router,
        prefix=f"{settings.API_V1_STR}/settings",
        tags=["Settings"],
    )
    application.include_router(
        skills.router,
        prefix=f"{settings.API_V1_STR}/skills",
        tags=["Skills"],
    )
    application.include_router(
        commands.router,
        prefix=f"{settings.API_V1_STR}/commands",
        tags=["Commands"],
    )
    application.include_router(
        agents.router,
        prefix=f"{settings.API_V1_STR}/agents",
        tags=["Agents"],
    )
    application.include_router(
        mcps.router,
        prefix=f"{settings.API_V1_STR}/mcps",
        tags=["MCPs"],
    )
    application.include_router(
        attachments.router,
        prefix=f"{settings.API_V1_STR}",
        tags=["Attachments"],
    )
    application.include_router(
        permissions.router,
        prefix=f"{settings.API_V1_STR}",
        tags=["Permissions"],
    )
    application.include_router(
        scheduling.router,
        prefix=f"{settings.API_V1_STR}/scheduling",
        tags=["Scheduling"],
    )
    application.include_router(
        ai_models.router,
        prefix=f"{settings.API_V1_STR}/models",
        tags=["Models"],
    )
    application.include_router(
        marketplace.router,
        prefix=f"{settings.API_V1_STR}/marketplace",
        tags=["Marketplace"],
    )

    application.openapi = lambda: custom_openapi(application)

    admin = create_admin(application, engine, SessionLocal)

    admin.add_view(AIModelAdmin)
    admin.add_view(UserAdmin)
    admin.add_view(ChatAdmin)
    admin.add_view(MessageAdmin)
    admin.add_view(MessageAttachmentAdmin)
    admin.add_view(UserSettingsAdmin)

    @application.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "healthy"}

    return application


app = create_application()
Instrumentator().instrument(app).expose(app)

app = wrap_asgi_with_proxy_headers(app, trusted_hosts=settings.TRUSTED_PROXY_HOSTS)
