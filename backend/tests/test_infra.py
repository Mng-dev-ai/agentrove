from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as main_module
from app.core.config import get_settings
from app.core.security import get_password_hash, verify_password
from app.models.db_models.user import User

from tests.conftest import UserFactory


pytestmark = pytest.mark.anyio


class FakePingStore:
    def __init__(self, *, healthy: bool) -> None:
        self.healthy = healthy

    async def ping(self) -> bool:
        return self.healthy


@asynccontextmanager
async def healthy_cache_connection() -> AsyncIterator[FakePingStore]:
    yield FakePingStore(healthy=True)


@asynccontextmanager
async def ping_false_cache_connection() -> AsyncIterator[FakePingStore]:
    yield FakePingStore(healthy=False)


@asynccontextmanager
async def failing_cache_connection() -> AsyncIterator[FakePingStore]:
    raise RuntimeError("redis connection refused")
    yield  # unreachable — present only so asynccontextmanager sees a generator


async def create_superuser(db_session: AsyncSession, email: str) -> User:
    admin_user = User(
        email=email,
        username=email.split("@")[0].replace("-", ""),
        hashed_password=get_password_hash("adminpass123"),
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin_user)
    await db_session.commit()
    return admin_user


async def admin_login(client: AsyncClient, email: str) -> httpx.Response:
    return await client.post(
        "/admin/login",
        data={"username": email, "password": "adminpass123"},
        follow_redirects=False,
    )


async def test_health_check_responds_with_security_headers(
    client: AsyncClient,
) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "req-health"})

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
    assert response.headers["X-Request-ID"] == "req-health"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


async def test_unhandled_error_returns_generic_500_without_leaking_details(
    app: FastAPI,
) -> None:
    async def explode() -> None:
        raise RuntimeError("secret connection string")

    app.add_api_route("/explode", explode)
    transport = httpx.ASGITransport(
        app=app, raise_app_exceptions=False, client=("testclient", 50000)
    )
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        response = await test_client.get(
            "/explode", headers={"X-Request-ID": "req-500"}
        )

    assert response.status_code == 500
    body = response.json()
    assert body["detail"] == "An internal server error occurred"
    assert body["request_id"] == "req-500"
    assert "secret connection string" not in response.text


async def test_readyz_skips_redis_check_in_desktop_mode(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", True)
    monkeypatch.setattr(main_module, "cache_connection", failing_cache_connection)

    response = await client.get("/api/v1/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"]["ok"] is True
    assert "redis" not in body["checks"]


@pytest.mark.parametrize(
    ("cache_connection", "expected_status", "expected_error"),
    [
        (healthy_cache_connection, 200, None),
        (ping_false_cache_connection, 503, "Redis ping returned false"),
        (failing_cache_connection, 503, "redis connection refused"),
    ],
)
async def test_readyz_reflects_redis_health(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    cache_connection: Callable[[], AbstractAsyncContextManager[FakePingStore]],
    expected_status: int,
    expected_error: str | None,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    monkeypatch.setattr(main_module, "cache_connection", cache_connection)

    response = await client.get("/api/v1/readyz")

    assert response.status_code == expected_status
    body = response.json()
    assert body["status"] == ("ready" if expected_status == 200 else "not_ready")
    redis_check = body["checks"]["redis"]
    assert redis_check["ok"] is (expected_error is None)
    if expected_error is not None:
        assert expected_error in redis_check["error"]


@pytest.mark.parametrize(
    "password",
    ["password123", "wrongpass"],
    ids=["non-superuser", "wrong-password"],
)
async def test_admin_login_rejects_non_superuser_and_bad_password(
    client: AsyncClient,
    create_user: UserFactory,
    password: str,
) -> None:
    await create_user(email="regular-admin@example.com", username="regularadmin")

    login_response = await client.post(
        "/admin/login",
        data={"username": "regular-admin@example.com", "password": password},
    )
    dashboard_response = await client.get("/admin/user/list", follow_redirects=False)

    assert login_response.status_code == 400
    assert dashboard_response.status_code == 302
    assert dashboard_response.headers["location"].endswith("/admin/login")


async def test_admin_login_authenticates_superuser_and_lists_users(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await create_superuser(db_session, "admin@example.com")

    login_response = await admin_login(client, "admin@example.com")
    list_response = await client.get("/admin/user/list")
    logout_response = await client.get("/admin/logout", follow_redirects=False)
    post_logout_response = await client.get("/admin/user/list", follow_redirects=False)

    assert login_response.status_code == 302
    assert list_response.status_code == 200
    assert "admin@example.com" in list_response.text
    assert logout_response.status_code == 302
    assert post_logout_response.status_code == 302


async def test_admin_create_user_hashes_grafted_password_field(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await create_superuser(db_session, "creator-admin@example.com")
    await admin_login(client, "creator-admin@example.com")

    form_response = await client.get("/admin/user/create")
    create_response = await client.post(
        "/admin/user/create",
        data={
            "email": "made-in-admin@example.com",
            "username": "madeinadmin",
            "password": "freshpass123",
            "is_active": "on",
            "is_verified": "on",
        },
        follow_redirects=False,
    )

    assert form_response.status_code == 200
    assert 'name="password"' in form_response.text
    assert create_response.status_code == 302, create_response.text
    result = await db_session.execute(
        select(User).where(User.email == "made-in-admin@example.com")
    )
    created = result.scalar_one()
    assert verify_password("freshpass123", created.hashed_password)


async def test_admin_edit_user_username_without_password(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
) -> None:
    # Empty password left in form data crashed SQLAdmin on column.nullable.
    await create_superuser(db_session, "edit-admin@example.com")
    target_user = await create_user(
        email="edit-target@example.com", username="edittarget"
    )
    original_hash = target_user.hashed_password
    await admin_login(client, "edit-admin@example.com")

    edit_response = await client.post(
        f"/admin/user/edit/{target_user.id}",
        data={
            "email": "edit-target@example.com",
            "username": "renamedtarget",
            "password": "",
            "is_active": "on",
            "is_verified": "on",
        },
        follow_redirects=False,
    )

    assert edit_response.status_code == 302, edit_response.text
    await db_session.refresh(target_user)
    assert target_user.username == "renamedtarget"
    assert target_user.hashed_password == original_hash


class AsyncCallRecorder:
    # Awaitable stand-in for lifespan collaborators; counts invocations so a
    # test can assert shutdown wiring without running the real teardown.
    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, *args: object) -> None:
        self.calls += 1


class FakeDisposableEngine:
    async def dispose(self) -> None:
        return None


async def test_lifespan_shutdown_terminates_terminal_sessions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Shutdown must tear down terminal PTY/tmux sessions — host-provider
    # shells would otherwise keep running after the app exits.
    terminal_recorder = AsyncCallRecorder()
    monkeypatch.setattr(main_module.MaintenanceService, "start", AsyncCallRecorder())
    monkeypatch.setattr(main_module.MaintenanceService, "stop", AsyncCallRecorder())
    monkeypatch.setattr(
        main_module.ChatStreamRuntime, "stop_background_chats", AsyncCallRecorder()
    )
    monkeypatch.setattr(
        main_module.session_registry, "terminate_all", AsyncCallRecorder()
    )
    monkeypatch.setattr(
        main_module.terminal_session_registry, "terminate_all", terminal_recorder
    )
    monkeypatch.setattr(main_module, "engine", FakeDisposableEngine())

    async with main_module.lifespan(main_module.app):
        assert terminal_recorder.calls == 0

    assert terminal_recorder.calls == 1
