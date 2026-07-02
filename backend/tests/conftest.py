from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

import tests.bootstrap
from app.api.endpoints import auth as auth_endpoint
from app.core import deps
from app.core.config import get_settings
from app.core.security import get_password_hash
from app.db.base_class import Base
from app.db.session import SessionLocal, engine
from app.main import create_application
from app.models.db_models.user import User, UserSettings
from app.services.email import email_service

TEST_DIR = tests.bootstrap.TEST_DIR


@dataclass
class EmailCapture:
    disposable: bool = False
    verification: list[dict[str, str | None]] = field(default_factory=list)
    password_reset: list[dict[str, str | None]] = field(default_factory=list)

    async def is_disposable_email(self, _email: str) -> bool:
        return self.disposable

    async def send_verification_email(
        self, email: str, verification_token: str, user_name: str | None = None
    ) -> bool:
        self.verification.append(
            {"email": email, "token": verification_token, "user_name": user_name}
        )
        return True

    async def send_password_reset_email(
        self, email: str, reset_token: str, user_name: str | None = None
    ) -> bool:
        self.password_reset.append(
            {"email": email, "token": reset_token, "user_name": user_name}
        )
        return True


class SettingsOverride:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.original = {
            "REGISTRATION_DISABLED": self.settings.REGISTRATION_DISABLED,
            "REQUIRE_EMAIL_VERIFICATION": self.settings.REQUIRE_EMAIL_VERIFICATION,
            "BLOCK_DISPOSABLE_EMAILS": self.settings.BLOCK_DISPOSABLE_EMAILS,
        }

    def __call__(self, **values: bool) -> None:
        for key, value in values.items():
            setattr(self.settings, key, value)

    def restore(self) -> None:
        for key, value in self.original.items():
            setattr(self.settings, key, value)


class UserFactory:
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def __call__(
        self,
        *,
        email: str = "user@example.com",
        username: str = "testuser",
        password: str = "password123",
        is_active: bool = True,
        is_verified: bool = True,
    ) -> User:
        user = User(
            email=email,
            username=username,
            hashed_password=get_password_hash(password),
            is_active=is_active,
            is_verified=is_verified,
            is_superuser=False,
        )
        self.db_session.add(user)
        await self.db_session.flush()
        self.db_session.add(
            UserSettings(
                user_id=user.id,
                github_personal_access_token=None,
            )
        )
        await self.db_session.commit()
        await self.db_session.refresh(user)
        return user


class LoginClient:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def __call__(
        self,
        *,
        email: str = "user@example.com",
        password: str = "password123",
    ) -> dict[str, str]:
        response = await self.client.post(
            "/api/v1/auth/jwt/login",
            data={"username": email, "password": password},
        )
        assert response.status_code == 200
        return response.json()


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest_asyncio.fixture(autouse=True)
async def database() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(autouse=True)
def clear_sandbox_provider_cache() -> Iterator[None]:
    # Providers persist across requests in deps.sandbox_provider_cache — clear
    # it per test so one test's monkeypatched fake isn't served to the next.
    deps.sandbox_provider_cache.clear()
    yield
    deps.sandbox_provider_cache.clear()


@pytest.fixture
def app() -> Iterator[FastAPI]:
    auth_endpoint.limiter.enabled = False
    TEST_DIR.joinpath("storage").mkdir(exist_ok=True)
    application = create_application()
    yield application
    application.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, client=("testclient", 50000))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        yield test_client


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


@pytest.fixture
def email_capture(monkeypatch: pytest.MonkeyPatch) -> EmailCapture:
    capture = EmailCapture()
    monkeypatch.setattr(
        email_service, "is_disposable_email", capture.is_disposable_email
    )
    monkeypatch.setattr(
        email_service, "send_verification_email", capture.send_verification_email
    )
    monkeypatch.setattr(
        email_service, "send_password_reset_email", capture.send_password_reset_email
    )
    return capture


@pytest.fixture
def settings_override() -> Iterator[SettingsOverride]:
    override = SettingsOverride()
    yield override
    override.restore()


@pytest_asyncio.fixture
async def create_user(db_session: AsyncSession) -> UserFactory:
    return UserFactory(db_session)


@pytest_asyncio.fixture
async def login(client: httpx.AsyncClient) -> LoginClient:
    return LoginClient(client)
