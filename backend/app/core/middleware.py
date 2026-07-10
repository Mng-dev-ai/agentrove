import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.services.exceptions import ServiceException

settings = get_settings()
logger = logging.getLogger(__name__)


class _RequestIdSend:
    def __init__(self, send: Send, scope: Scope, request_id: str) -> None:
        self.send = send
        self.scope = scope
        self.request_id = request_id
        self.start_time = time.perf_counter()

    async def __call__(self, message: Message) -> None:
        # Stamp headers and log at response start — SSE responses never
        # complete, so waiting for the response end would never log them.
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
        # Pure ASGI on purpose: BaseHTTPMiddleware buffers streaming responses
        # and deadlocks never-ending EventSourceResponse (SSE) bodies.
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = Headers(scope=scope).get("X-Request-ID") or str(uuid.uuid4())
        # Request.state is backed by scope["state"], so handlers and exception
        # handlers keep reading request.state.request_id unchanged.
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
        # Pure ASGI on purpose: BaseHTTPMiddleware buffers streaming responses
        # and deadlocks never-ending EventSourceResponse (SSE) bodies.
        if scope["type"] != "http" or not settings.ENABLE_SECURITY_HEADERS:
            await self.app(scope, receive, send)
            return
        await self.app(scope, receive, _SecurityHeadersSend(send))


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
