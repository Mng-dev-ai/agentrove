from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as main_module
from app.core.config import get_settings
from app.core.security import get_password_hash, verify_password
from app.main import create_application
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
    # Raising before the yield propagates out of `async with cache_connection()`,
    # exercising _check_redis_ready's broad except branch.
    raise RuntimeError("redis connection refused")
    yield  # unreachable — present only so asynccontextmanager sees a generator


async def test_health_check_returns_healthy(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


async def test_openapi_schema_includes_bearer_auth_and_is_cached(
    client: AsyncClient,
) -> None:
    # Two calls: first builds+caches the schema, second returns the cached copy.
    first = await client.get("/api/v1/openapi.json")
    second = await client.get("/api/v1/openapi.json")

    assert first.status_code == 200
    assert second.status_code == 200
    schema = first.json()
    assert schema["components"]["securitySchemes"]["bearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    assert schema["security"] == [{"bearerAuth": []}]
    assert first.json() == second.json()


async def test_readyz_skips_redis_check_in_desktop_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", True)
    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        response = await test_client.get("/api/v1/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"]["ok"] is True
    assert "redis" not in body["checks"]


async def test_readyz_reports_ready_when_redis_reachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    monkeypatch.setattr(main_module, "cache_connection", healthy_cache_connection)
    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        response = await test_client.get("/api/v1/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["redis"]["ok"] is True


async def test_readyz_reports_not_ready_when_redis_ping_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    monkeypatch.setattr(main_module, "cache_connection", ping_false_cache_connection)
    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        response = await test_client.get("/api/v1/readyz")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["redis"]["ok"] is False
    assert body["checks"]["redis"]["error"] == "Redis ping returned false"


async def test_readyz_reports_not_ready_when_redis_connection_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    monkeypatch.setattr(main_module, "cache_connection", failing_cache_connection)
    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        response = await test_client.get("/api/v1/readyz")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["redis"]["ok"] is False
    assert "redis connection refused" in body["checks"]["redis"]["error"]


async def test_admin_login_page_renders_when_desktop_mode_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        response = await test_client.get("/admin/login")

    assert response.status_code == 200


async def test_admin_login_rejects_non_superuser(
    monkeypatch: pytest.MonkeyPatch,
    create_user: UserFactory,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    await create_user(
        email="regular-admin@example.com",
        username="regularadmin",
        password="password123",
    )

    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        login_response = await test_client.post(
            "/admin/login",
            data={"username": "regular-admin@example.com", "password": "password123"},
        )
        dashboard_response = await test_client.get(
            "/admin/user/list", follow_redirects=False
        )

    assert login_response.status_code == 400
    assert dashboard_response.status_code == 302
    assert dashboard_response.headers["location"].endswith("/admin/login")


async def test_admin_login_rejects_wrong_password(
    monkeypatch: pytest.MonkeyPatch,
    create_user: UserFactory,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    await create_user(email="wrongpass-admin@example.com", username="wrongpassadmin")

    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        response = await test_client.post(
            "/admin/login",
            data={"username": "wrongpass-admin@example.com", "password": "wrongpass"},
        )

    assert response.status_code == 400


async def test_admin_login_authenticates_superuser_and_lists_users(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    admin_user = User(
        email="admin@example.com",
        username="adminuser",
        hashed_password=get_password_hash("adminpass123"),
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin_user)
    await db_session.commit()

    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        login_response = await test_client.post(
            "/admin/login",
            data={"username": "admin@example.com", "password": "adminpass123"},
            follow_redirects=False,
        )
        list_response = await test_client.get("/admin/user/list")
        logout_response = await test_client.get("/admin/logout", follow_redirects=False)
        post_logout_response = await test_client.get(
            "/admin/user/list", follow_redirects=False
        )

    assert login_response.status_code == 302
    assert list_response.status_code == 200
    assert "admin@example.com" in list_response.text
    assert logout_response.status_code == 302
    assert post_logout_response.status_code == 302


async def test_admin_create_user_hashes_grafted_password_field(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    admin_user = User(
        email="creator-admin@example.com",
        username="creatoradmin",
        hashed_password=get_password_hash("adminpass123"),
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin_user)
    await db_session.commit()

    application = create_application()
    transport = httpx.ASGITransport(app=application, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        await test_client.post(
            "/admin/login",
            data={"username": "creator-admin@example.com", "password": "adminpass123"},
            follow_redirects=False,
        )
        form_response = await test_client.get("/admin/user/create")
        create_response = await test_client.post(
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
