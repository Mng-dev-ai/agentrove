import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.refresh_token import RefreshToken
from app.models.db_models.user import User, UserSettings
from app.models.db_models.workspace import Workspace
from app.utils.cache import CacheStore, MemoryStore
from app.services.sandbox_providers.base import SandboxProvider
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    FileMetadata,
    PtyDataCallbackType,
    PtySize,
)

if TYPE_CHECKING:
    from tests.conftest import LoginClient, UserFactory


class FakeSandboxProvider(SandboxProvider):
    def __init__(self, workspace_path: str | None = None) -> None:
        self._workspace_root = workspace_path or "/tmp/agentrove-test-sandbox"
        self.files = {
            "README.md": FileContent(
                path="README.md",
                content="Initial readme",
                type="file",
                is_binary=False,
            )
        }
        self.writes: list[tuple[str, str, str | bytes]] = []
        self.commands: list[tuple[str, str, dict[str, str] | None]] = []

    @property
    def workspace_root(self) -> str:
        return self._workspace_root

    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        return "sandbox-1"

    async def delete_sandbox(self, sandbox_id: str) -> None:
        return None

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        envs: dict[str, str] | None = None,
        timeout: int = 120,
    ) -> CommandResult:
        self.commands.append((sandbox_id, command, envs))
        if "git for-each-ref" in command:
            return CommandResult(
                stdout=(
                    "main\n"
                    "__BRANCHES_LOCAL__\n"
                    "main\n"
                    "__BRANCHES_REMOTE__\n"
                    "origin/HEAD\n"
                    "origin/feature\n"
                ),
                stderr="",
                exit_code=0,
            )
        if "git rev-parse --is-inside-work-tree" in command:
            return CommandResult(stdout="true\n", stderr="", exit_code=0)
        if "git diff" in command:
            return CommandResult(
                stdout="diff --git a/app.py b/app.py\n",
                stderr="",
                exit_code=0,
            )
        if "git checkout 'feature'" in command:
            return CommandResult(stdout="", stderr="", exit_code=0)
        if "git rev-parse --abbrev-ref HEAD" in command:
            return CommandResult(stdout="feature\n", stderr="", exit_code=0)
        if "git add -A && git commit" in command:
            return CommandResult(stdout="committed\n", stderr="", exit_code=0)
        if "git checkout HEAD --" in command:
            return CommandResult(stdout="restored\n", stderr="", exit_code=0)
        if "git checkout -b 'feature-two' 'main'" in command:
            return CommandResult(stdout="", stderr="", exit_code=0)
        if "git remote get-url origin" in command:
            return CommandResult(
                stdout="https://github.com/agentrove/app.git\n",
                stderr="",
                exit_code=0,
            )
        if "rg " in command:
            payload = {
                "type": "match",
                "data": {
                    "path": {"text": "./app.py"},
                    "line_number": 1,
                    "lines": {"text": "needle = True\n"},
                    "submatches": [{"start": 0, "end": 6}],
                },
            }
            return CommandResult(
                stdout=json.dumps(payload) + "\n",
                stderr="",
                exit_code=0,
            )
        return CommandResult(stdout="", stderr="", exit_code=0)

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        self.writes.append((sandbox_id, path, content))
        self.files[path] = FileContent(
            path=path,
            content=str(content),
            type="file",
            is_binary=False,
        )

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        return self.files[path]

    async def list_files(
        self,
        sandbox_id: str,
        path: str = "",
    ) -> list[FileMetadata]:
        return [
            FileMetadata(path="src", type="directory"),
            *[
                FileMetadata(path=file_path, type="file", is_binary=file.is_binary)
                for file_path, file in self.files.items()
            ],
        ]

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        on_data: PtyDataCallbackType,
    ) -> str:
        return "pty-1"

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        return None

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        return None

    async def kill_pty(self, sandbox_id: str, pty_id: str) -> None:
        return None

    async def cleanup(self) -> None:
        return None


class FakeProviderFactory:
    def __init__(self, provider: FakeSandboxProvider | None = None) -> None:
        self.provider = provider

    def __call__(
        self,
        provider_type: str,
        workspace_path: str | None = None,
    ) -> FakeSandboxProvider:
        if self.provider is not None:
            return self.provider
        return FakeSandboxProvider(workspace_path=workspace_path)


class EndpointCache:
    def __init__(self) -> None:
        self.store = MemoryStore()

    @asynccontextmanager
    async def connect(self) -> AsyncIterator[CacheStore]:
        yield self.store


async def create_authenticated_workspace(
    db_session: AsyncSession,
    create_user: "UserFactory",
    login: "LoginClient",
    *,
    email: str = "user@example.com",
    username: str = "testuser",
) -> tuple[dict[str, str], User, Workspace]:
    user = await create_user(email=email, username=username)
    tokens = await login(email=email)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    workspace = Workspace(
        name="Test Workspace",
        user_id=user.id,
        sandbox_id=f"sandbox-{username}",
        sandbox_provider="host",
        workspace_path=f"/tmp/agentrove-test-{username}",
        source_type="empty",
        source_url=None,
    )
    db_session.add(workspace)
    await db_session.commit()
    await db_session.refresh(workspace)
    return headers, user, workspace


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_settings(db: AsyncSession, user_id: UUID) -> UserSettings | None:
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def count_refresh_tokens(db: AsyncSession, user_id: UUID) -> int:
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.user_id == user_id)
    )
    return len(result.scalars().all())
