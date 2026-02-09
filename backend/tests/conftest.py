from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Callable, Generator
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from filelock import FileLock
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault(
    "SECRET_KEY", "test_secret_key_for_testing_at_least_32_characters_long"
)
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5433/claudex_test"
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6380/0")
os.environ.setdefault("REQUIRE_EMAIL_VERIFICATION", "false")
os.environ.setdefault("BLOCK_DISPOSABLE_EMAILS", "false")
os.environ.setdefault("LOG_LEVEL", "ERROR")
os.environ.setdefault("STORAGE_PATH", "/tmp/test_storage")
os.environ.setdefault("MAIL_PASSWORD", "test_sendgrid_api_key")

from app.api.endpoints import auth as auth_module
from app.core.config import get_settings
from app.core.deps import (
    get_chat_service,
    get_provider_service,
    get_sandbox_service,
    get_user_service,
)
from app.core.security import get_password_hash
from app.core.user_manager import get_jwt_strategy
from app.db.base import Base
from app.db.session import get_db
from app.main import create_application
from app.models.db_models import Chat, Message, User, UserSettings
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.services.provider import ProviderService
from app.services.chat import ChatService
from app.services.claude_agent import ClaudeAgentService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.docker_provider import LocalDockerProvider
from app.services.sandbox_providers.types import DockerConfig
from app.services.storage import StorageService
from app.services.streaming.context_usage import ContextUsageTracker
from app.services.streaming.orchestrator import StreamOrchestrator
from app.services.user import UserService

settings = get_settings()

TEST_PASSWORD = "testpassword"
TEST_PASSWORD_ALT = "testpassword123"
STREAMING_TEST_TIMEOUT = 180

ChatServiceClass = type[ChatService]


async def make_auth_headers(user: User) -> dict[str, str]:
    strategy = get_jwt_strategy()
    token = await strategy.write_token(user)
    return {"Authorization": f"Bearer {token}"}


def get_default_test_providers(auth_token: str | None = None) -> list[dict]:
    from app.models.schemas.settings import ProviderType

    return [
        {
            "id": "anthropic",
            "name": "Anthropic",
            "provider_type": ProviderType.ANTHROPIC.value,
            "base_url": "https://api.anthropic.com",
            "auth_token": auth_token or "test_anthropic_token",
            "enabled": True,
            "models": [
                {
                    "model_id": "claude-haiku-4-5",
                    "name": "Claude Haiku 4.5",
                    "enabled": True,
                },
                {
                    "model_id": "claude-sonnet-4-5",
                    "name": "Claude Sonnet 4.5",
                    "enabled": True,
                },
            ],
        }
    ]


async def make_user(
    db_session: AsyncSession,
    *,
    email_prefix: str = "test",
    with_settings: bool = True,
    auth_token: str | None = None,
    commit: bool = False,
) -> User:
    unique_id = uuid.uuid4().hex[:8]
    user = User(
        id=uuid.uuid4(),
        email=f"{email_prefix}_{unique_id}@example.com",
        username=f"{email_prefix}_{unique_id}",
        hashed_password=get_password_hash(TEST_PASSWORD),
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)

    if with_settings:
        user_settings = UserSettings(
            id=uuid.uuid4(),
            user_id=user.id,
            custom_providers=get_default_test_providers(auth_token),
        )
        db_session.add(user_settings)

    if commit:
        await db_session.commit()
        await db_session.refresh(user)
    else:
        await db_session.flush()
        await db_session.refresh(user)

    return user


@pytest.fixture(scope="session")
def event_loop() -> Generator:
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


test_engine = create_async_engine(
    settings.DATABASE_URL,
    poolclass=NullPool,
    echo=False,
)

TestSessionLocal = sessionmaker(
    test_engine,
    class_=AsyncSession,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


@pytest.fixture(scope="session")
def _setup_test_database(tmp_path_factory, event_loop):
    lock_file = tmp_path_factory.getbasetemp().parent / "db_setup.lock"
    done_file = tmp_path_factory.getbasetemp().parent / "db_setup.done"

    with FileLock(str(lock_file)):
        if not done_file.exists():

            async def setup():
                async with test_engine.begin() as conn:
                    await conn.run_sync(Base.metadata.drop_all)
                    await conn.run_sync(Base.metadata.create_all)

            event_loop.run_until_complete(setup())
            done_file.touch()

    yield


@pytest_asyncio.fixture(scope="function")
async def db_session(_setup_test_database) -> AsyncGenerator[AsyncSession, None]:
    connection = await test_engine.connect()
    transaction = await connection.begin()

    session = TestSessionLocal(bind=connection)

    try:
        yield session
    finally:
        try:
            if session.in_transaction():
                await session.rollback()
        except Exception:
            pass
        await session.close()
        try:
            await transaction.rollback()
        except Exception:
            pass
        await connection.close()


@pytest.fixture
def session_factory(db_session: AsyncSession) -> Callable[[], Any]:
    @asynccontextmanager
    async def factory():
        yield db_session

    return factory


@pytest_asyncio.fixture
async def sample_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        username="testuser",
        hashed_password=get_password_hash(TEST_PASSWORD_ALT),
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    db_session.add(user)

    user_settings = UserSettings(
        id=uuid.uuid4(),
        user_id=user.id,
        custom_providers=get_default_test_providers(),
    )
    db_session.add(user_settings)

    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def sample_chat(db_session: AsyncSession, sample_user: User) -> Chat:
    chat = Chat(
        id=uuid.uuid4(),
        title="Test Chat",
        user_id=sample_user.id,
        context_token_usage=0,
    )
    db_session.add(chat)
    await db_session.flush()
    await db_session.refresh(chat)
    return chat


@pytest_asyncio.fixture
async def sample_message(db_session: AsyncSession, sample_chat: Chat) -> Message:
    message = Message(
        id=uuid.uuid4(),
        chat_id=sample_chat.id,
        content_text="Test message content",
        role=MessageRole.USER,
        stream_status=MessageStreamStatus.COMPLETED,
    )
    db_session.add(message)
    await db_session.flush()
    await db_session.refresh(message)
    return message


@pytest_asyncio.fixture
async def redis_client():
    redis: Redis[str] = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        yield redis
    finally:
        await redis.flushdb()
        await redis.close()


def create_e2e_application(
    db_session: AsyncSession,
    sandbox_service: SandboxService,
    session_factory: Callable[[], Any],
    chat_service_cls: ChatServiceClass = ChatService,
):
    application = create_application()

    async def override_get_db():
        yield db_session

    async def override_get_sandbox_service():
        yield sandbox_service

    def override_get_user_service():
        return UserService(session_factory=session_factory)

    async def override_get_chat_service():
        storage_service = StorageService(sandbox_service)
        user_service = UserService(session_factory=session_factory)
        ai_service = ClaudeAgentService(session_factory=session_factory)
        yield chat_service_cls(
            storage_service,
            sandbox_service,
            ai_service,
            user_service,
            session_factory=session_factory,
        )

    def override_get_provider_service():
        return ProviderService()

    application.dependency_overrides[get_db] = override_get_db
    application.dependency_overrides[get_sandbox_service] = override_get_sandbox_service
    application.dependency_overrides[get_user_service] = override_get_user_service
    application.dependency_overrides[get_chat_service] = override_get_chat_service
    application.dependency_overrides[get_provider_service] = (
        override_get_provider_service
    )

    auth_module.limiter.enabled = False

    return application


class TestChatService(ChatService):
    def __init__(
        self,
        storage_service,
        sandbox_service,
        ai_service,
        user_service,
        session_factory=None,
    ):
        super().__init__(
            storage_service, sandbox_service, ai_service, user_service, session_factory
        )
        self._test_sandbox_service = sandbox_service
        self._test_session_factory = session_factory

    async def enqueue_chat_task(
        self,
        *,
        prompt,
        system_prompt,
        custom_instructions,
        user,
        chat,
        permission_mode,
        model_id,
        session_id,
        assistant_message_id,
        thinking_mode,
        attachments,
        is_custom_prompt=False,
    ):
        task_id = str(uuid.uuid4())
        mock_task = MagicMock()
        mock_task.request = MagicMock()
        mock_task.request.id = task_id
        mock_task.update_state = MagicMock()

        chat_data = {
            "id": str(chat.id),
            "user_id": str(chat.user_id),
            "title": chat.title,
            "sandbox_id": chat.sandbox_id,
            "session_id": chat.session_id,
        }

        await StreamOrchestrator.run_chat_stream(
            task=mock_task,
            prompt=prompt,
            system_prompt=system_prompt,
            custom_instructions=custom_instructions,
            chat_data=chat_data,
            model_id=model_id,
            sandbox_service=self._test_sandbox_service,
            permission_mode=permission_mode,
            session_id=session_id,
            assistant_message_id=assistant_message_id,
            thinking_mode=thinking_mode,
            attachments=attachments,
            session_factory=self._test_session_factory,
        )

        async with self._test_session_factory() as session:
            result = await session.execute(select(Chat).filter(Chat.id == chat.id))
            refreshed_chat = result.scalar_one_or_none()

        if refreshed_chat and refreshed_chat.session_id and refreshed_chat.sandbox_id:
            tracker = ContextUsageTracker(
                chat_id=str(refreshed_chat.id),
                session_id=refreshed_chat.session_id,
                sandbox_id=refreshed_chat.sandbox_id,
                user_id=str(user.id),
                model_id=model_id,
            )

            redis_client: Redis[str] = Redis.from_url(
                settings.REDIS_URL, decode_responses=True
            )
            try:
                async with ClaudeAgentService(
                    session_factory=self._test_session_factory
                ) as ai_service:
                    await tracker.fetch_and_broadcast(
                        ai_service, redis_client, self._test_session_factory
                    )
            finally:
                await redis_client.close()

        mock_result = MagicMock()
        mock_result.id = task_id
        return mock_result


class DockerSandboxManager:
    def __init__(self, config: DockerConfig):
        self.config = config
        self.sandbox_id: str | None = None
        provider = LocalDockerProvider(config=config)
        self.service = SandboxService(provider)

    async def get_sandbox(self) -> str:
        if self.sandbox_id:
            if await self.service.provider.is_running(self.sandbox_id):
                return self.sandbox_id
        self.sandbox_id = await self.service.provider.create_sandbox()
        return self.sandbox_id

    async def cleanup(self) -> None:
        if self.sandbox_id:
            try:
                await self.service.provider.delete_sandbox(self.sandbox_id)
            except Exception:
                pass


def _is_docker_available() -> bool:
    try:
        import docker

        client = docker.from_env()
        client.ping()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def docker_available() -> bool:
    return _is_docker_available()


@pytest.fixture(scope="session")
def docker_config() -> DockerConfig:
    return DockerConfig(
        image=os.environ.get(
            "DOCKER_IMAGE", "ghcr.io/mng-dev-ai/claudex-sandbox:latest"
        ),
        network="claudex-sandbox-net",
        host=None,
        preview_base_url="http://localhost",
        user_home="/home/user",
        openvscode_port=8765,
    )


def _ensure_docker_network_exists(network_name: str) -> None:
    import docker

    client = docker.from_env()
    try:
        client.networks.get(network_name)
    except docker.errors.NotFound:
        client.networks.create(network_name, driver="bridge")
    finally:
        client.close()


@pytest_asyncio.fixture(scope="session")
async def docker_sandbox_manager(
    docker_available: bool,
    docker_config: DockerConfig,
) -> AsyncGenerator[DockerSandboxManager, None]:
    if not docker_available:
        pytest.skip("Docker not available")
    _ensure_docker_network_exists(docker_config.network)
    manager = DockerSandboxManager(docker_config)
    await manager.get_sandbox()
    try:
        yield manager
    finally:
        await manager.cleanup()


@pytest_asyncio.fixture
async def docker_sandbox(
    docker_sandbox_manager: DockerSandboxManager,
) -> AsyncGenerator[tuple[SandboxService, str], None]:
    sandbox_id = await docker_sandbox_manager.get_sandbox()
    yield docker_sandbox_manager.service, sandbox_id


@pytest_asyncio.fixture
async def docker_integration_user_fixture(
    db_session: AsyncSession,
    claude_token: str,
) -> User:
    return await make_user(
        db_session,
        email_prefix="docker_integration",
        auth_token=claude_token,
        commit=True,
    )


@pytest_asyncio.fixture
async def docker_integration_chat_fixture(
    db_session: AsyncSession,
    docker_integration_user_fixture: User,
    docker_sandbox: tuple[SandboxService, str],
) -> AsyncGenerator[tuple[User, Chat, SandboxService], None]:
    service, sandbox_id = docker_sandbox
    user = docker_integration_user_fixture

    chat = Chat(
        id=uuid.uuid4(),
        title="Docker Integration Test Chat",
        user_id=user.id,
        sandbox_id=sandbox_id,
    )
    db_session.add(chat)
    await db_session.flush()
    await db_session.refresh(chat)

    yield user, chat, service


@pytest_asyncio.fixture
async def docker_e2e_app(
    db_session: AsyncSession,
    docker_sandbox_manager: DockerSandboxManager,
    session_factory: Callable[[], Any],
    docker_integration_user_fixture: User,
):
    await docker_sandbox_manager.get_sandbox()
    yield create_e2e_application(
        db_session, docker_sandbox_manager.service, session_factory, TestChatService
    )


@pytest_asyncio.fixture
async def docker_async_client(docker_e2e_app) -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(
        transport=ASGITransport(app=docker_e2e_app), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def docker_auth_headers(docker_integration_user_fixture: User) -> dict[str, str]:
    return await make_auth_headers(docker_integration_user_fixture)


@pytest_asyncio.fixture
async def async_client(
    docker_async_client: AsyncClient,
) -> AsyncGenerator[AsyncClient, None]:
    yield docker_async_client


@pytest_asyncio.fixture
async def auth_headers(docker_auth_headers: dict[str, str]) -> dict[str, str]:
    return docker_auth_headers


@pytest_asyncio.fixture
async def streaming_client(
    async_client: AsyncClient,
) -> AsyncGenerator[AsyncClient, None]:
    yield async_client


@pytest.fixture(scope="session")
def claude_token() -> str:
    token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    if not token:
        pytest.skip("CLAUDE_CODE_OAUTH_TOKEN required")
    return token


@pytest_asyncio.fixture
async def integration_user_fixture(
    docker_integration_user_fixture: User,
) -> User:
    return docker_integration_user_fixture


@pytest_asyncio.fixture
async def integration_chat_fixture(
    docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
) -> AsyncGenerator[tuple[User, Chat, SandboxService], None]:
    yield docker_integration_chat_fixture


@dataclass
class SandboxTestContext:
    client: AsyncClient
    user: User
    chat: Chat
    service: SandboxService
    auth_headers: dict[str, str]
    provider: str


@pytest_asyncio.fixture
async def sandbox_test_context(
    docker_available: bool,
    db_session: AsyncSession,
    session_factory: Callable[[], Any],
) -> AsyncGenerator[SandboxTestContext, None]:
    if not docker_available:
        pytest.skip("Docker not available")
    docker_config = DockerConfig(
        image=os.environ.get(
            "DOCKER_IMAGE", "ghcr.io/mng-dev-ai/claudex-sandbox:latest"
        ),
        network="claudex-sandbox-net",
        host=None,
        preview_base_url="http://localhost",
        user_home="/home/user",
        openvscode_port=8765,
    )
    manager = DockerSandboxManager(docker_config)
    sandbox_id = await manager.get_sandbox()

    user = User(
        id=uuid.uuid4(),
        email=f"sandbox_test_docker_{uuid.uuid4().hex[:8]}@example.com",
        username=f"sandbox_test_docker_{uuid.uuid4().hex[:8]}",
        hashed_password=get_password_hash(TEST_PASSWORD),
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)

    user_settings = UserSettings(
        id=uuid.uuid4(),
        user_id=user.id,
        custom_providers=get_default_test_providers(),
    )
    db_session.add(user_settings)
    await db_session.commit()
    await db_session.refresh(user)

    chat = Chat(
        id=uuid.uuid4(),
        title="Sandbox Test Chat (Docker)",
        user_id=user.id,
        sandbox_id=sandbox_id,
    )
    db_session.add(chat)
    await db_session.flush()
    await db_session.refresh(chat)

    app = create_e2e_application(
        db_session, manager.service, session_factory, ChatService
    )
    strategy = get_jwt_strategy()
    token = await strategy.write_token(user)
    auth_headers = {"Authorization": f"Bearer {token}"}

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SandboxTestContext(
            client, user, chat, manager.service, auth_headers, "docker"
        )
    await manager.cleanup()


@pytest_asyncio.fixture
async def marketplace_app(
    db_session: AsyncSession,
    session_factory: Callable[[], Any],
):
    mock_sandbox_service = MagicMock(spec=SandboxService)
    application = create_e2e_application(
        db_session, mock_sandbox_service, session_factory, ChatService
    )
    yield application


@pytest_asyncio.fixture
async def marketplace_client(marketplace_app) -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(
        transport=ASGITransport(app=marketplace_app), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def marketplace_user(
    db_session: AsyncSession,
) -> User:
    return await make_user(
        db_session,
        email_prefix="marketplace_test",
        commit=True,
    )


@pytest_asyncio.fixture
async def marketplace_auth_headers(marketplace_user: User) -> dict[str, str]:
    return await make_auth_headers(marketplace_user)


async def read_sandbox_file(
    sandbox_service: SandboxService, sandbox_id: str, path: str
) -> str | None:
    try:
        result = await sandbox_service.provider.read_file(sandbox_id, path)
        return result.content if not result.is_binary else None
    except Exception:
        return None


async def sandbox_file_exists(
    sandbox_service: SandboxService, sandbox_id: str, path: str
) -> bool:
    try:
        result = await sandbox_service.execute_command(
            sandbox_id, f"test -f {path} && echo 'exists'"
        )
        return "exists" in result.stdout
    except Exception:
        return False
