import base64
import io
import shlex
import subprocess
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.models.db_models.workspace import Workspace
from app.services.exceptions import SandboxException
from app.services.git import (
    GIT_CHECKOUT_FROM_REMOTE_TEMPLATE,
    GIT_CHECKOUT_TEMPLATE,
    GIT_CREATE_BRANCH_FROM_REMOTE_TEMPLATE,
    GIT_CURRENT_BRANCH_CMD,
    GIT_IS_REPO_CMD,
    GIT_PULL_CMD,
    GIT_PUSH_CMD,
    GIT_SHOW_HEAD_TEMPLATE,
    GIT_STATUS_PORCELAIN_CMD,
    GIT_WORKTREE_ADD_FROM_BASE_TEMPLATE,
    GIT_WORKTREE_ADD_FROM_REMOTE_BASE_TEMPLATE,
    RESTORE_ALL_CMD,
    GitService,
    _validate_base_ref,
)
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.sandbox_providers.docker_provider import (
    DockerConfig,
    LocalDockerProvider,
)
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    FileMetadata,
)

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    FakeProviderFactory,
    FakeSandboxProvider,
    create_authenticated_workspace,
    get_user_settings,
)


pytestmark = pytest.mark.anyio


async def test_docker_sandbox_chowns_only_managed_workspace(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    storage_root = tmp_path / "storage"
    managed_workspace = storage_root / "workspaces" / "user" / "repo"
    external_workspace = tmp_path / "local-repo"
    monkeypatch.setattr(get_settings(), "STORAGE_PATH", str(storage_root))

    provider = LocalDockerProvider(DockerConfig())
    exec_obj = MagicMock()
    container = MagicMock()
    container.exec = AsyncMock(return_value=exec_obj)
    create_container = AsyncMock(return_value=container)
    collect_exec_output = AsyncMock(return_value=(0, ""))
    monkeypatch.setattr(provider, "_create_container", create_container)
    monkeypatch.setattr(provider, "_collect_exec_output", collect_exec_output)

    await provider.create_sandbox(str(managed_workspace))

    container.exec.assert_awaited_once_with(
        cmd=["chown", "-R", "1000:1000", provider.workspace_root],
        user="root",
    )
    collect_exec_output.assert_awaited_once_with(exec_obj)

    container.exec.reset_mock()
    collect_exec_output.reset_mock()

    await provider.create_sandbox(str(external_workspace))
    await provider.create_sandbox(None)

    container.exec.assert_not_awaited()
    collect_exec_output.assert_not_awaited()


@pytest.mark.parametrize("base_ref", ["main", "feat/api-keys", "release-1.2"])
async def test_validate_base_ref_accepts_valid_branch_names(base_ref: str) -> None:
    assert _validate_base_ref(base_ref) is None


@pytest.mark.parametrize(
    "base_ref",
    ["-evil", "a b", "x'y", "a..b", "a//b", "x.lock", "@{u}", ""],
)
async def test_validate_base_ref_rejects_invalid_branch_names(base_ref: str) -> None:
    with pytest.raises(SandboxException, match="^Invalid base branch name$"):
        _validate_base_ref(base_ref)


async def test_create_worktree_uses_local_base_without_retry() -> None:
    provider = ScriptedSandboxProvider()
    primary_command = GIT_WORKTREE_ADD_FROM_BASE_TEMPLATE.substitute(
        worktree_dir=".worktrees/12345678",
        base_worktrees_dir=".worktrees",
        branch_name="worktree-12345678",
        base_ref="feature",
    )
    provider.script(
        primary_command,
        CommandResult(stdout="", stderr="", exit_code=0),
    )
    service = GitService(SandboxService(provider))

    worktree = await service.create_worktree(
        "sandbox-1",
        "",
        "12345678-1234-1234-1234-123456789012",
        base_ref="feature",
    )

    assert worktree == ".worktrees/12345678"
    assert len(provider.commands) == 1
    assert provider.commands[0][1].endswith(primary_command)


async def test_create_worktree_retries_remote_base() -> None:
    provider = ScriptedSandboxProvider()
    primary_command = GIT_WORKTREE_ADD_FROM_BASE_TEMPLATE.substitute(
        worktree_dir=".worktrees/12345678",
        base_worktrees_dir=".worktrees",
        branch_name="worktree-12345678",
        base_ref="feature",
    )
    remote_command = GIT_WORKTREE_ADD_FROM_REMOTE_BASE_TEMPLATE.substitute(
        worktree_dir=".worktrees/12345678",
        base_worktrees_dir=".worktrees",
        branch_name="worktree-12345678",
        base_ref="feature",
    )
    provider.script(
        primary_command,
        CommandResult(
            stdout="fatal: not a valid object name: 'feature'\n",
            stderr="",
            exit_code=128,
        ),
    )
    provider.script(
        remote_command,
        CommandResult(stdout="", stderr="", exit_code=0),
    )
    service = GitService(SandboxService(provider))

    worktree = await service.create_worktree(
        "sandbox-1",
        "",
        "12345678-1234-1234-1234-123456789012",
        base_ref="feature",
    )

    assert worktree == ".worktrees/12345678"
    assert len(provider.commands) == 2
    assert provider.commands[0][1].endswith(primary_command)
    assert provider.commands[1][1].endswith(remote_command)


async def test_create_worktree_surfaces_remote_retry_error() -> None:
    provider = ScriptedSandboxProvider()
    primary_command = GIT_WORKTREE_ADD_FROM_BASE_TEMPLATE.substitute(
        worktree_dir=".worktrees/12345678",
        base_worktrees_dir=".worktrees",
        branch_name="worktree-12345678",
        base_ref="missing",
    )
    remote_command = GIT_WORKTREE_ADD_FROM_REMOTE_BASE_TEMPLATE.substitute(
        worktree_dir=".worktrees/12345678",
        base_worktrees_dir=".worktrees",
        branch_name="worktree-12345678",
        base_ref="missing",
    )
    provider.script(
        primary_command,
        CommandResult(
            stdout="fatal: not a valid object name: 'missing'\n",
            stderr="",
            exit_code=128,
        ),
    )
    provider.script(
        remote_command,
        CommandResult(
            stdout="",
            stderr="fatal: invalid reference: origin/missing\n",
            exit_code=128,
        ),
    )
    service = GitService(SandboxService(provider))

    with pytest.raises(
        SandboxException, match="^fatal: invalid reference: origin/missing$"
    ):
        await service.create_worktree(
            "sandbox-1",
            "",
            "12345678-1234-1234-1234-123456789012",
            base_ref="missing",
        )

    assert len(provider.commands) == 2
    assert provider.commands[0][1].endswith(primary_command)
    assert provider.commands[1][1].endswith(remote_command)


class ScriptedSandboxProvider(FakeSandboxProvider):
    # Scripted responses/exceptions (helpers.py not editable for error paths).
    def __init__(self) -> None:
        super().__init__()
        self.command_overrides: list[tuple[str, CommandResult]] = []
        self.list_files_error: SandboxException | None = None
        self.read_file_error: SandboxException | None = None
        self.write_file_error: SandboxException | None = None

    def script(self, substring: str, result: CommandResult) -> None:
        self.command_overrides.append((substring, result))

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        envs: dict[str, str] | None = None,
        timeout: int = 120,
    ) -> CommandResult:
        for substring, result in self.command_overrides:
            if substring in command:
                self.commands.append((sandbox_id, command, envs))
                return result
        return await super().execute_command(sandbox_id, command, envs, timeout)

    async def list_files(self, sandbox_id: str, path: str = "") -> list[FileMetadata]:
        if self.list_files_error:
            raise self.list_files_error
        return await super().list_files(sandbox_id, path)

    async def read_file(self, sandbox_id: str, path: str) -> FileContent:
        if self.read_file_error:
            raise self.read_file_error
        return await super().read_file(sandbox_id, path)

    async def write_file(
        self, sandbox_id: str, path: str, content: str | bytes
    ) -> None:
        if self.write_file_error:
            raise self.write_file_error
        await super().write_file(sandbox_id, path, content)


def install_scripted_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> ScriptedSandboxProvider:
    provider = ScriptedSandboxProvider()
    monkeypatch.setattr(
        SandboxProvider, "create_provider", FakeProviderFactory(provider=provider)
    )
    return provider


async def create_host_workspace(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    workspace_dir: Path,
    *,
    email: str = "host-user@example.com",
    username: str = "hostuser",
) -> tuple[dict[str, str], Workspace]:
    # Mirrors create_authenticated_workspace but points workspace_path at a
    # real on-disk temp dir so the real LocalHostProvider runs, not a fake.
    user = await create_user(email=email, username=username)
    tokens = await login(email=email)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    workspace = Workspace(
        name="Host Workspace",
        user_id=user.id,
        sandbox_id=f"sandbox-{username}",
        sandbox_provider="host",
        workspace_path=str(workspace_dir),
        source_type="empty",
        source_url=None,
    )
    db_session.add(workspace)
    await db_session.commit()
    await db_session.refresh(workspace)
    return headers, workspace


@pytest.fixture
def fake_provider(monkeypatch: pytest.MonkeyPatch) -> FakeSandboxProvider:
    provider = FakeSandboxProvider()
    monkeypatch.setattr(
        SandboxProvider,
        "create_provider",
        FakeProviderFactory(provider=provider),
    )
    return provider


async def test_file_endpoints_use_owned_sandbox_and_provider(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    metadata_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata",
        headers=headers,
    )
    worktree_metadata_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata?cwd=.worktrees/wt-1",
        headers=headers,
    )
    content_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/README.md",
        headers=headers,
    )
    update_response = await client.put(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files",
        json={"file_path": "src/app.py", "content": "print('updated')"},
        headers=headers,
    )
    updated_content_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/src/app.py",
        headers=headers,
    )
    invalid_path_response = await client.put(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files",
        json={"file_path": "../outside.py", "content": "blocked"},
        headers=headers,
    )

    assert metadata_response.status_code == 200
    assert metadata_response.json()["files"] == [
        {"path": "src", "type": "directory", "is_binary": False},
        {"path": "README.md", "type": "file", "is_binary": False},
    ]
    assert worktree_metadata_response.status_code == 200
    assert worktree_metadata_response.json()["files"] == [
        {"path": ".worktrees/wt-1/src", "type": "directory", "is_binary": False},
        {"path": ".worktrees/wt-1/README.md", "type": "file", "is_binary": False},
    ]
    assert fake_provider.list_paths == ["", ".worktrees/wt-1"]
    assert content_response.status_code == 200
    assert content_response.json()["content"] == "Initial readme"
    assert update_response.status_code == 200
    assert update_response.json() == {
        "success": True,
        "message": "File src/app.py updated successfully",
    }
    assert fake_provider.writes == [
        (workspace.sandbox_id, "src/app.py", "print('updated')")
    ]
    assert updated_content_response.status_code == 200
    assert updated_content_response.json()["content"] == "print('updated')"
    assert invalid_path_response.status_code == 400


async def test_sandbox_access_requires_owner_and_authentication(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    owner_headers, _owner, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="sandbox-owner@example.com",
        username="sandboxowner",
    )
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="sandbox-other@example.com",
        username="sandboxother",
    )

    owner_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata",
        headers=owner_headers,
    )
    other_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata",
        headers=other_headers,
    )
    missing_token_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata"
    )

    assert owner_response.status_code == 200
    assert other_response.status_code == 404
    assert other_response.json()["detail"] == "Sandbox not found"
    assert missing_token_response.status_code == 401


async def test_download_zip_returns_owned_sandbox_files(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    await fake_provider.write_file(workspace.sandbox_id, "src/app.py", "print('zip')")

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/download-zip",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == (
        f'attachment; filename="sandbox_{workspace.sandbox_id}.zip"'
    )
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["README.md", "src/app.py"]
        assert archive.read("README.md") == b"Initial readme"
        assert archive.read("src/app.py") == b"print('zip')"


async def test_git_endpoints_propagate_cwd_and_request_fields(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    sandbox_id = workspace.sandbox_id

    diff_response = await client.get(
        f"/api/v1/sandbox/{sandbox_id}/git/diff?full_context=true&cwd=packages/api",
        headers=headers,
    )
    branches_response = await client.get(
        f"/api/v1/sandbox/{sandbox_id}/git/branches?cwd=packages/api",
        headers=headers,
    )
    checkout_response = await client.post(
        f"/api/v1/sandbox/{sandbox_id}/git/checkout",
        json={"branch": "feature", "cwd": "packages/api"},
        headers=headers,
    )
    commit_response = await client.post(
        f"/api/v1/sandbox/{sandbox_id}/git/commit",
        json={"message": "Update API", "cwd": "packages/api"},
        headers=headers,
    )
    restore_response = await client.post(
        f"/api/v1/sandbox/{sandbox_id}/git/restore-file",
        json={
            "file_path": "new.py",
            "old_path": "old.py",
            "cwd": "packages/api",
        },
        headers=headers,
    )
    create_branch_response = await client.post(
        f"/api/v1/sandbox/{sandbox_id}/git/create-branch",
        json={
            "name": "feature-two",
            "base_branch": "main",
            "cwd": "packages/api",
        },
        headers=headers,
    )
    remote_response = await client.get(
        f"/api/v1/sandbox/{sandbox_id}/git/remote-url?cwd=packages/api",
        headers=headers,
    )

    assert diff_response.status_code == 200
    assert diff_response.json()["has_changes"] is True
    assert branches_response.status_code == 200
    assert branches_response.json()["branches"] == ["feature", "main"]
    assert checkout_response.status_code == 200
    assert commit_response.status_code == 200
    assert restore_response.status_code == 200
    assert create_branch_response.status_code == 200
    assert remote_response.status_code == 200
    commands = [command for _sandbox_id, command, _envs in fake_provider.commands]
    assert all(
        command.startswith(
            "cd 'packages/api' && export GIT_DISCOVERY_ACROSS_FILESYSTEM=1 && "
        )
        for command in commands
    )
    assert any("git diff -U99999 HEAD" in command for command in commands)
    assert any("git for-each-ref" in command for command in commands)
    assert any("git checkout 'feature'" in command for command in commands)
    assert any("git commit -m 'Update API'" in command for command in commands)
    assert any("git checkout HEAD -- old.py" in command for command in commands)
    assert any(
        "git checkout -b 'feature-two' 'main'" in command for command in commands
    )
    assert any("git remote get-url origin" in command for command in commands)


async def test_git_remote_url_returns_owned_sandbox_remote(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/remote-url",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "remote_url": "https://github.com/agentrove/app.git",
        "owner": "agentrove",
        "repo": "app",
    }
    assert fake_provider.commands[-1] == (
        workspace.sandbox_id,
        "export GIT_DISCOVERY_ACROSS_FILESYSTEM=1 && "
        "git remote get-url origin 2>/dev/null",
        {},
    )


async def test_search_endpoint_propagates_filters(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    sandbox_id = workspace.sandbox_id

    response = await client.get(
        f"/api/v1/sandbox/{sandbox_id}/search"
        "?q=needle&cwd=src&case_sensitive=true&regex=true&whole_word=true"
        "&include=*.py&exclude=vendor/*",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["path"] == "src/app.py"
    search_commands = [
        command
        for _sandbox_id, command, _envs in fake_provider.commands
        if "rg " in command
    ]
    assert search_commands == [
        "cd 'src' && rg --json -n --max-count=100 --max-columns=500 "
        "-w -g '*.py' -g '!vendor/*' -- needle ."
    ]


async def test_get_files_metadata_rejects_invalid_cwd(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata?cwd=../escape",
        headers=headers,
    )

    assert response.status_code == 400


async def test_get_files_metadata_propagates_provider_status_code(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.list_files_error = SandboxException("listing failed", status_code=502)
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata",
        headers=headers,
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "listing failed"


async def test_get_file_content_rejects_invalid_path_and_missing_file(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    invalid_path_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/weird'file.py",
        headers=headers,
    )
    missing_file_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/missing.py",
        headers=headers,
    )

    assert invalid_path_response.status_code == 400
    assert missing_file_response.status_code == 404


async def test_update_file_propagates_provider_error(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.write_file_error = SandboxException("disk full")
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.put(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files",
        json={"file_path": "a.py", "content": "x"},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "disk full"


async def test_download_zip_propagates_provider_error(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.list_files_error = SandboxException("zip listing failed")
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/download-zip",
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "zip listing failed"


async def test_git_diff_not_a_repo(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(GIT_IS_REPO_CMD, CommandResult(stdout="", stderr="", exit_code=128))
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/diff", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {
        "diff": "",
        "has_changes": False,
        "is_git_repo": False,
        "error": None,
    }


async def test_git_diff_default_and_branch_success_modes(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    default_mode_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/diff", headers=headers
    )
    branch_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/diff?mode=branch",
        headers=headers,
    )

    assert default_mode_response.status_code == 200
    assert default_mode_response.json()["is_git_repo"] is True
    assert branch_response.status_code == 200
    assert branch_response.json()["is_git_repo"] is True


async def test_git_diff_branch_mode_reports_unknown_base(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script("git merge-base", CommandResult(stdout="", stderr="", exit_code=2))
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/diff?mode=branch", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {
        "diff": "",
        "has_changes": False,
        "is_git_repo": True,
        "error": "Could not determine base branch",
    }


async def test_git_changed_paths(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        GIT_STATUS_PORCELAIN_CMD,
        CommandResult(stdout="\n M app.py\0?? new_file.py\0", stderr="", exit_code=0),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/changed-paths", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {
        "paths": ["app.py", "new_file.py"],
        "is_git_repo": True,
    }


async def test_git_changed_paths_rebases_to_cwd_prefix(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        GIT_STATUS_PORCELAIN_CMD,
        CommandResult(
            stdout="packages/api/\n M packages/api/app.py\0?? other/file.py\0",
            stderr="",
            exit_code=0,
        ),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/changed-paths?cwd=packages/api",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {"paths": ["app.py"], "is_git_repo": True}


async def test_git_changed_paths_not_a_repo(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        GIT_STATUS_PORCELAIN_CMD, CommandResult(stdout="", stderr="", exit_code=2)
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/changed-paths", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {"paths": [], "is_git_repo": False}


async def test_git_file_baseline_variants(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        GIT_SHOW_HEAD_TEMPLATE.substitute(spec=shlex.quote("HEAD:./not-a-repo.py")),
        CommandResult(stdout="", stderr="", exit_code=2),
    )
    provider.script(
        GIT_SHOW_HEAD_TEMPLATE.substitute(spec=shlex.quote("HEAD:./new-file.py")),
        CommandResult(stdout="", stderr="fatal: path not in HEAD", exit_code=128),
    )
    provider.script(
        GIT_SHOW_HEAD_TEMPLATE.substitute(spec=shlex.quote("HEAD:./tracked.py")),
        CommandResult(stdout="print('baseline')\n", stderr="", exit_code=0),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    not_repo_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/file-baseline?path=not-a-repo.py",
        headers=headers,
    )
    new_file_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/file-baseline?path=new-file.py",
        headers=headers,
    )
    tracked_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/file-baseline?path=tracked.py",
        headers=headers,
    )

    assert not_repo_response.json() == {
        "path": "not-a-repo.py",
        "content": "",
        "is_git_repo": False,
    }
    assert new_file_response.json() == {
        "path": "new-file.py",
        "content": "",
        "is_git_repo": True,
    }
    assert tracked_response.json() == {
        "path": "tracked.py",
        "content": "print('baseline')\n",
        "is_git_repo": True,
    }


async def test_git_file_baseline_rejects_invalid_path(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/file-baseline?path=-rf",
        headers=headers,
    )

    assert response.status_code == 400


async def test_git_branches_not_a_repo_and_malformed_output(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        "git for-each-ref", CommandResult(stdout="", stderr="", exit_code=2)
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    not_repo_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/branches", headers=headers
    )

    assert not_repo_response.json() == {
        "branches": [],
        "current_branch": "",
        "is_git_repo": False,
    }

    other_provider = install_scripted_provider(monkeypatch)
    other_provider.script(
        "git for-each-ref", CommandResult(stdout="main\n", stderr="", exit_code=0)
    )
    other_headers, _other_user, other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="branches-malformed@example.com",
        username="branchesmalformed",
    )

    malformed_response = await client.get(
        f"/api/v1/sandbox/{other_workspace.sandbox_id}/git/branches",
        headers=other_headers,
    )

    assert malformed_response.status_code == 400
    assert malformed_response.json()["detail"] == "Failed to parse git branches output"


async def test_git_checkout_remote_fallback_success(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    branch = "feature-remote"
    provider.script(
        GIT_CHECKOUT_TEMPLATE.substitute(branch=branch),
        CommandResult(stdout="", stderr="error: pathspec", exit_code=1),
    )
    provider.script(
        GIT_CHECKOUT_FROM_REMOTE_TEMPLATE.substitute(branch=branch),
        CommandResult(stdout="", stderr="", exit_code=0),
    )
    provider.script(
        GIT_CURRENT_BRANCH_CMD,
        CommandResult(stdout=f"{branch}\n", stderr="", exit_code=0),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/checkout",
        json={"branch": branch},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "current_branch": branch,
        "error": None,
    }


async def test_git_checkout_fails_when_both_attempts_fail(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    branch = "feature-missing"
    provider.script(
        GIT_CHECKOUT_TEMPLATE.substitute(branch=branch),
        CommandResult(stdout="local fail\n", stderr="", exit_code=1),
    )
    provider.script(
        GIT_CHECKOUT_FROM_REMOTE_TEMPLATE.substitute(branch=branch),
        CommandResult(stdout="remote fail\n", stderr="", exit_code=1),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/checkout",
        json={"branch": branch},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": False,
        "current_branch": "",
        "error": "remote fail",
    }


async def test_git_checkout_reverts_detached_head(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    branch = "v1.0.0"
    provider.script(
        GIT_CHECKOUT_TEMPLATE.substitute(branch=branch),
        CommandResult(stdout="", stderr="", exit_code=0),
    )
    provider.script(
        GIT_CURRENT_BRANCH_CMD, CommandResult(stdout="HEAD\n", stderr="", exit_code=0)
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/checkout",
        json={"branch": branch},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": False,
        "current_branch": "",
        "error": "Cannot checkout: would result in detached HEAD",
    }
    assert any(
        "git checkout - 2>/dev/null" in command
        for _sid, command, _envs in provider.commands
    )


async def test_git_checkout_rejects_invalid_branch_name(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/checkout",
        json={"branch": "-bad"},
        headers=headers,
    )

    assert response.status_code == 400


async def test_git_create_branch_remote_fallback_success(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    name = "new-feature"
    base_branch = "develop"
    primary_base = f" '{base_branch}'"
    provider.script(
        f"git checkout -b '{name}'{primary_base} 2>&1",
        CommandResult(stdout="fatal\n", stderr="", exit_code=1),
    )
    provider.script(
        GIT_CREATE_BRANCH_FROM_REMOTE_TEMPLATE.substitute(name=name, base=base_branch),
        CommandResult(stdout="", stderr="", exit_code=0),
    )
    provider.script(
        GIT_CURRENT_BRANCH_CMD,
        CommandResult(stdout=f"{name}\n", stderr="", exit_code=0),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/create-branch",
        json={"name": name, "base_branch": base_branch},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "current_branch": name, "error": None}


async def test_git_create_branch_rejects_invalid_names(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    invalid_name_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/create-branch",
        json={"name": "bad name"},
        headers=headers,
    )
    invalid_base_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/create-branch",
        json={"name": "ok-name", "base_branch": "bad base"},
        headers=headers,
    )

    assert invalid_name_response.status_code == 400
    assert invalid_base_response.status_code == 400


async def test_git_create_branch_fails_without_base_branch(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No base_branch means create_branch never attempts the remote-fallback
    # retry, so a failed primary checkout must surface directly.
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        "git checkout -b 'taken' 2>&1",
        CommandResult(
            stdout="fatal: A branch named 'taken' already exists\n",
            stderr="",
            exit_code=1,
        ),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/create-branch",
        json={"name": "taken"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": False,
        "current_branch": "",
        "error": "fatal: A branch named 'taken' already exists",
    }


async def test_git_push_and_pull_endpoints(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        f"{GIT_PUSH_CMD} 2>&1",
        CommandResult(stdout="", stderr="fatal: no upstream", exit_code=1),
    )
    provider.script(
        f"{GIT_PULL_CMD} 2>&1",
        CommandResult(stdout="Already up to date.\n", stderr="", exit_code=0),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    push_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/push", headers=headers
    )
    pull_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/pull", headers=headers
    )

    assert push_response.status_code == 200
    assert push_response.json() == {
        "success": False,
        "output": "",
        "error": "fatal: no upstream",
    }
    assert pull_response.status_code == 200
    assert pull_response.json() == {
        "success": True,
        "output": "Already up to date.",
        "error": None,
    }


async def test_git_restore_all_endpoint(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(RESTORE_ALL_CMD, CommandResult(stdout="", stderr="", exit_code=0))
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/restore-all", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "output": "", "error": None}


async def test_git_restore_file_without_rename(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    # No old_path means this is a plain restore (not a rename), which takes
    # the RESTORE_FILE_TEMPLATE branch rather than RESTORE_RENAME_TEMPLATE.
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/restore-file",
        json={"file_path": "app.py"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["success"] is True


async def test_git_restore_file_rejects_invalid_paths(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    invalid_file_path_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/restore-file",
        json={"file_path": "../escape.py"},
        headers=headers,
    )
    invalid_old_path_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/restore-file",
        json={"file_path": "ok.py", "old_path": "-bad"},
        headers=headers,
    )

    assert invalid_file_path_response.status_code == 400
    assert invalid_old_path_response.status_code == 400


async def test_git_remote_url_error_paths(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        "git remote get-url origin", CommandResult(stdout="", stderr="", exit_code=1)
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    no_remote_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/remote-url", headers=headers
    )

    assert no_remote_response.status_code == 400
    assert no_remote_response.json()["detail"] == "No git remote origin found"

    other_provider = install_scripted_provider(monkeypatch)
    other_provider.script(
        "git remote get-url origin",
        CommandResult(stdout="git@gitlab.com:foo/bar.git\n", stderr="", exit_code=0),
    )
    other_headers, _other_user, other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="non-github-remote@example.com",
        username="nongithubremote",
    )

    non_github_response = await client.get(
        f"/api/v1/sandbox/{other_workspace.sandbox_id}/git/remote-url",
        headers=other_headers,
    )

    assert non_github_response.status_code == 400
    assert "GitHub" in non_github_response.json()["detail"]


async def test_git_endpoints_reject_invalid_cwd(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    sandbox_id = workspace.sandbox_id
    bad_cwd = "../escape"

    responses = [
        await client.get(
            f"/api/v1/sandbox/{sandbox_id}/git/diff?cwd={bad_cwd}", headers=headers
        ),
        await client.get(
            f"/api/v1/sandbox/{sandbox_id}/git/changed-paths?cwd={bad_cwd}",
            headers=headers,
        ),
        await client.get(
            f"/api/v1/sandbox/{sandbox_id}/git/file-baseline?path=a.py&cwd={bad_cwd}",
            headers=headers,
        ),
        await client.get(
            f"/api/v1/sandbox/{sandbox_id}/git/branches?cwd={bad_cwd}", headers=headers
        ),
        await client.post(
            f"/api/v1/sandbox/{sandbox_id}/git/checkout",
            json={"branch": "main", "cwd": "../escape"},
            headers=headers,
        ),
        await client.post(
            f"/api/v1/sandbox/{sandbox_id}/git/commit",
            json={"message": "msg", "cwd": "../escape"},
            headers=headers,
        ),
        await client.post(
            f"/api/v1/sandbox/{sandbox_id}/git/push?cwd={bad_cwd}", headers=headers
        ),
        await client.post(
            f"/api/v1/sandbox/{sandbox_id}/git/pull?cwd={bad_cwd}", headers=headers
        ),
        await client.post(
            f"/api/v1/sandbox/{sandbox_id}/git/restore-all?cwd={bad_cwd}",
            headers=headers,
        ),
        await client.post(
            f"/api/v1/sandbox/{sandbox_id}/git/create-branch",
            json={"name": "main", "cwd": "../escape"},
            headers=headers,
        ),
        await client.get(
            f"/api/v1/sandbox/{sandbox_id}/git/remote-url?cwd={bad_cwd}",
            headers=headers,
        ),
        await client.get(
            f"/api/v1/sandbox/{sandbox_id}/search?q=x&cwd={bad_cwd}", headers=headers
        ),
    ]

    assert all(response.status_code == 400 for response in responses)


async def test_search_provider_failure_returns_400(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.script(
        "rg --json",
        CommandResult(stdout="", stderr="regex parse error", exit_code=2),
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/search?q=needle", headers=headers
    )

    assert response.status_code == 400
    assert "regex parse error" in response.json()["detail"]


async def test_host_provider_serves_real_files_from_disk(
    tmp_path: Path,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    # Real LocalHostProvider on tmp disk (walk fallback, skip dirs, symlink guard).
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    (workspace_dir / "README.md").write_text("real readme")
    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "app.py").write_text("print('hi')")
    node_modules = workspace_dir / "node_modules" / "pkg"
    node_modules.mkdir(parents=True)
    (node_modules / "index.js").write_text("module.exports = {}")
    outside_file = tmp_path / "outside.txt"
    outside_file.write_text("secret")
    (workspace_dir / "escape-link").symlink_to(outside_file)
    (workspace_dir / "logo.zip").write_bytes(b"PK\x03\x04binarydata")

    headers, workspace = await create_host_workspace(
        db_session, create_user, login, workspace_dir
    )

    metadata_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata", headers=headers
    )
    content_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/README.md",
        headers=headers,
    )
    binary_content_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/logo.zip",
        headers=headers,
    )
    write_response = await client.put(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files",
        json={"file_path": "src/nested/new.py", "content": "print('new')"},
        headers=headers,
    )
    escape_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/escape-link",
        headers=headers,
    )
    missing_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/content/does-not-exist.py",
        headers=headers,
    )

    assert metadata_response.status_code == 200
    paths = {f["path"] for f in metadata_response.json()["files"]}
    assert "README.md" in paths
    assert "src/app.py" in paths
    assert not any(p.startswith("node_modules") for p in paths)
    assert content_response.status_code == 200
    assert content_response.json()["content"] == "real readme"
    assert binary_content_response.status_code == 200
    binary_body = binary_content_response.json()
    assert binary_body["is_binary"] is True
    assert base64.b64decode(binary_body["content"]) == b"PK\x03\x04binarydata"
    assert write_response.status_code == 200
    assert (workspace_dir / "src" / "nested" / "new.py").read_text() == "print('new')"
    assert escape_response.status_code == 404
    assert missing_response.status_code == 404


async def test_host_provider_runs_real_git_commands(
    tmp_path: Path,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    # Runs real `git`/`bash` subprocesses via LocalHostProvider.execute_command
    # against a real repo in a temp dir — no fakes involved.
    workspace_dir = tmp_path / "git-workspace"
    workspace_dir.mkdir()
    subprocess.run(
        ["git", "-c", "init.defaultBranch=main", "init", "-q"],
        cwd=workspace_dir,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=workspace_dir,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"], cwd=workspace_dir, check=True
    )
    (workspace_dir / "app.py").write_text("print('v1')\n")
    # Nested tracked files exercise parent-dir synthesis + seen_dirs dedup.
    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "nested.py").write_text("print('nested')\n")
    (workspace_dir / "src" / "other.py").write_text("print('other')\n")
    subprocess.run(["git", "add", "."], cwd=workspace_dir, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "initial"], cwd=workspace_dir, check=True
    )
    (workspace_dir / "app.py").write_text("print('v2')\n")

    headers, workspace = await create_host_workspace(
        db_session,
        create_user,
        login,
        workspace_dir,
        email="hostgit@example.com",
        username="hostgit",
    )

    # Seed custom env via DB (not PATCH — Redis invalidation not wired here).
    user_settings = await get_user_settings(db_session, workspace.user_id)
    assert user_settings is not None
    user_settings.custom_env_vars = [{"key": "MY_VAR", "value": "hello"}]
    flag_modified(user_settings, "custom_env_vars")
    await db_session.commit()

    branches_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/branches", headers=headers
    )
    diff_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/diff", headers=headers
    )
    remote_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/remote-url", headers=headers
    )
    commit_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/commit",
        json={"message": "v2"},
        headers=headers,
    )
    # Clean tree → list_files uses git ls-files, not os.walk fallback.
    metadata_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata", headers=headers
    )

    assert branches_response.status_code == 200
    assert branches_response.json()["current_branch"] == "main"
    assert branches_response.json()["is_git_repo"] is True
    assert diff_response.status_code == 200
    assert diff_response.json()["is_git_repo"] is True
    assert "print('v2')" in diff_response.json()["diff"]
    assert remote_response.status_code == 400
    assert remote_response.json()["detail"] == "No git remote origin found"
    assert commit_response.status_code == 200
    assert commit_response.json()["success"] is True
    assert metadata_response.status_code == 200
    metadata_files = metadata_response.json()["files"]
    assert {"path": "app.py", "type": "file", "is_binary": False} in metadata_files
    assert {"path": "src", "type": "directory", "is_binary": False} in metadata_files
    assert {
        "path": "src/nested.py",
        "type": "file",
        "is_binary": False,
    } in metadata_files


async def test_git_diff_unborn_head_emits_each_file_once(
    tmp_path: Path,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    # No commits: "all" diffs empty tree (old fallback double-emitted paths).
    workspace_dir = tmp_path / "unborn-workspace"
    workspace_dir.mkdir()
    subprocess.run(
        ["git", "-c", "init.defaultBranch=main", "init", "-q"],
        cwd=workspace_dir,
        check=True,
    )
    (workspace_dir / "app.py").write_text("print('v1')\n")
    subprocess.run(["git", "add", "."], cwd=workspace_dir, check=True)
    (workspace_dir / "app.py").write_text("print('v1')\nprint('v2')\n")
    (workspace_dir / "notes.txt").write_text("untracked\n")

    headers, workspace = await create_host_workspace(
        db_session,
        create_user,
        login,
        workspace_dir,
        email="unborn@example.com",
        username="unborn",
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/diff", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_git_repo"] is True
    assert body["has_changes"] is True
    diff = body["diff"]
    # One section per file: the staged-then-modified file exactly once, with
    # combined worktree content, plus the untracked file.
    assert diff.count("diff --git a/app.py b/app.py") == 1
    assert "print('v2')" in diff
    assert "diff --git a/notes.txt b/notes.txt" in diff
    assert diff.count("diff --git") == 2


async def test_git_endpoint_injects_github_token_env(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    fake_provider: FakeSandboxProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # PAT + server mode injects GITHUB_TOKEN/GIT_ASKPASS into provider env.
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    user_settings = await get_user_settings(db_session, user.id)
    assert user_settings is not None
    user_settings.github_personal_access_token = "ghp_test_token"
    await db_session.commit()

    # git/branches deliberately bypasses env injection (see GitService.get_branches),
    # so use git/diff instead, which routes through SandboxService.execute_command.
    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/git/diff", headers=headers
    )

    assert response.status_code == 200
    envs_used = [envs for _sid, _cmd, envs in fake_provider.commands if envs]
    assert envs_used
    assert envs_used[0]["GITHUB_TOKEN"] == "ghp_test_token"
    assert "GIT_ASKPASS" in envs_used[0]


async def test_download_zip_includes_binary_files(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    # Force is_binary=True (write_file always stores False on the fake).
    provider.files["logo.zip"] = FileContent(
        path="logo.zip",
        content=base64.b64encode(b"binary-bytes").decode(),
        type="file",
        is_binary=True,
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/download-zip", headers=headers
    )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.read("logo.zip") == b"binary-bytes"


async def test_download_zip_skips_files_that_fail_to_read(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = install_scripted_provider(monkeypatch)
    provider.read_file_error = SandboxException("read failed")
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/download-zip", headers=headers
    )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == []
