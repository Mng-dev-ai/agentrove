import logging
import time
import uuid
from typing import Any

import jwt
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security.utils import get_authorization_scheme_param
from fastapi_users.jwt import decode_jwt
from sqlalchemy import select
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.core.security import SANDBOX_MCP_AUDIENCE, create_scoped_mcp_token
from app.core.user_manager import DEVICE_IDS, password_fingerprint
from app.db.session import SessionLocal
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.services.exceptions import ServiceException
from app.services.pairing import PairingService
from app.services.sandbox_providers import SandboxProviderType
from app.services.session_registry import session_registry

settings = get_settings()
logger = logging.getLogger(__name__)


class _RequestIdSend:
    def __init__(self, send: Send, scope: Scope, request_id: str) -> None:
        self.send = send
        self.scope = scope
        self.request_id = request_id
        self.start_time = time.perf_counter()

    async def __call__(self, message: Message) -> None:
        # Log at response start — SSE bodies never complete.
        if message["type"] == "http.response.start":
            process_time = time.perf_counter() - self.start_time
            headers = MutableHeaders(scope=message)
            headers["X-Request-ID"] = self.request_id
            headers["X-Process-Time"] = f"{process_time:.4f}"
            client = self.scope.get("client")
            logger.info(
                "request_completed",
                extra={
                    "request_id": self.request_id,
                    "method": self.scope["method"],
                    "path": self.scope["path"],
                    "status_code": message["status"],
                    "process_time_ms": round(process_time * 1000, 2),
                    "client_ip": client[0] if client else None,
                },
            )
        await self.send(message)


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Pure ASGI: BaseHTTPMiddleware buffers streams and deadlocks SSE.
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = Headers(scope=scope).get("X-Request-ID") or str(uuid.uuid4())
        # Request.state is scope["state"], so handlers still see request_id.
        scope.setdefault("state", {})["request_id"] = request_id
        await self.app(scope, receive, _RequestIdSend(send, scope, request_id))


class _SecurityHeadersSend:
    def __init__(self, send: Send) -> None:
        self.send = send

    async def __call__(self, message: Message) -> None:
        if message["type"] == "http.response.start":
            headers = MutableHeaders(scope=message)
            headers["X-Content-Type-Options"] = settings.CONTENT_TYPE_OPTIONS
            headers["X-Frame-Options"] = settings.FRAME_OPTIONS
            headers["X-XSS-Protection"] = settings.XSS_PROTECTION
            headers["Referrer-Policy"] = settings.REFERRER_POLICY
            headers["Permissions-Policy"] = settings.PERMISSIONS_POLICY

            if settings.ENVIRONMENT == "production":
                hsts_value = f"max-age={settings.HSTS_MAX_AGE}"
                if settings.HSTS_INCLUDE_SUBDOMAINS:
                    hsts_value += "; includeSubDomains"
                if settings.HSTS_PRELOAD:
                    hsts_value += "; preload"
                headers["Strict-Transport-Security"] = hsts_value
        await self.send(message)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Pure ASGI: BaseHTTPMiddleware buffers streams and deadlocks SSE.
        if scope["type"] != "http" or not settings.ENABLE_SECURITY_HEADERS:
            await self.app(scope, receive, send)
            return
        await self.app(scope, receive, _SecurityHeadersSend(send))


class McpAuthMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Reject before the MCP handshake. The endpoint never sees the caller's
        # token: it gets a short-lived one scoped to the sandbox's workspace.
        scheme, token = get_authorization_scheme_param(
            Headers(scope=scope).get("Authorization")
        )
        if scheme.lower() == "bearer" and token:
            claims = await self._verified_claims(token)
            if claims is not None:
                state = scope.setdefault("state", {})
                state["agentrove_token"] = create_scoped_mcp_token(claims)
                state["agentrove_chat_id"] = claims["cid"]
                await self.app(scope, receive, send)
                return
        response = JSONResponse(
            {"detail": "Could not validate credentials"},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )
        await response(scope, receive, send)

    @staticmethod
    async def _verified_claims(token: str) -> dict[str, Any] | None:
        try:
            claims: dict[str, Any] = decode_jwt(
                token,
                settings.SECRET_KEY,
                [SANDBOX_MCP_AUDIENCE],
                algorithms=[settings.ALGORITHM],
            )
            user_id = uuid.UUID(claims["sub"])
            workspace_id = uuid.UUID(claims["wid"])
            chat_id = None if claims["cid"] is None else uuid.UUID(claims["cid"])
            device_ids = DEVICE_IDS.validate_python(claims["did"])
        except (jwt.PyJWTError, KeyError, TypeError, ValueError):
            return None
        if not session_registry.is_mcp_session_live(claims.get("sid", "")):
            return None
        async with SessionLocal() as db:
            user = await db.get(User, user_id)
            if (
                user is None
                or not user.is_active
                or claims.get("pwd") != password_fingerprint(user.hashed_password)
                or not await PairingService.all_active(db, user_id, device_ids)
            ):
                return None
            workspace = await db.scalar(
                select(Workspace.id).where(
                    Workspace.id == workspace_id,
                    Workspace.user_id == user_id,
                    Workspace.deleted_at.is_(None),
                    Workspace.sandbox_provider == SandboxProviderType.DOCKER.value,
                )
            )
            if workspace is None:
                return None
            if chat_id is not None and (
                await db.scalar(
                    select(Chat.id).where(
                        Chat.id == chat_id,
                        Chat.user_id == user_id,
                        Chat.workspace_id == workspace_id,
                        Chat.deleted_at.is_(None),
                    )
                )
                is None
            ):
                return None
        return claims


async def _service_exception_handler(
    request: Request, exc: ServiceException
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())

    logger.warning(
        "service_exception",
        extra={
            "request_id": request_id,
            "error_code": exc.error_code.value,
            "exception_message": exc.message,
            "details": exc.details,
            "path": request.url.path,
            "method": request.method,
        },
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.message,
            "error_code": exc.error_code.value,
            "message": exc.message,
            "details": exc.details,
            "request_id": request_id,
        },
    )


async def _http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "error_code": "HTTP_ERROR",
            "message": exc.detail,
            "details": {},
            "request_id": request_id,
        },
    )


async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())

    logger.error(
        "unhandled_exception",
        extra={
            "request_id": request_id,
            "path": request.url.path,
            "method": request.method,
            "exception_type": type(exc).__name__,
            "exception_message": str(exc),
        },
        exc_info=True,
    )

    return JSONResponse(
        status_code=500,
        content={
            "detail": "An internal server error occurred",
            "error_code": "INTERNAL_SERVER_ERROR",
            "message": "An internal server error occurred",
            "details": {},
            "request_id": request_id,
        },
    )


def setup_middleware(app: FastAPI) -> None:

    session_secret = settings.SESSION_SECRET_KEY or settings.SECRET_KEY
    app.add_middleware(SessionMiddleware, secret_key=session_secret)

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "X-Requested-With",
            "Accept",
            "Origin",
        ],
        expose_headers=["X-Message-Id", "X-Request-ID", "X-Process-Time"],
    )

    app.add_exception_handler(ServiceException, _service_exception_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(Exception, _global_exception_handler)
