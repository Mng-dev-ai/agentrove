import base64
import io
import json
import shlex
import subprocess
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from aiodocker.exceptions import DockerError
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.models.db_models.workspace import Workspace
from app.services.exceptions import SandboxException
from app.services.git import GitService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.sandbox_providers.docker_provider import (
    DockerConfig,
    LocalDockerProvider,
)
from app.services.sandbox_providers.host_provider import LocalHostProvider
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    FileMetadata,
)
from app.services.search import SearchService

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    FakeProviderFactory,
    FakeSandboxProvider,
    create_authenticated_workspace,
    get_user_settings,
)


pytestmark = pytest.mark.anyio


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout


def configure_identity(repo: Path) -> None:
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "user.name", "Test")
    git(repo, "config", "commit.gpgsign", "false")


def commit_all(repo: Path, message: str) -> None:
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)


def write_files(root: Path, files: dict[str, str]) -> None:
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def init_repo(
    path: Path, files: dict[str, str] | None = None, *, branch: str = "main"
) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    git(path, "-c", f"init.defaultBranch={branch}", "init", "-q")
    configure_identity(path)
    if files:
        write_files(path, files)
        commit_all(path, "initial")
    return path


def rev(repo: Path, ref: str = "HEAD") -> str:
    return git(repo, "rev-parse", ref).strip()


def clone_with_origin(
    tmp_path: Path, files: dict[str, str] | None = None
) -> tuple[Path, Path]:
    # origin has main (tagged v1.0.0) plus a `release` branch the clone only
    # sees as origin/release.
    seed = init_repo(tmp_path / "seed", files or {"app.py": "v1\n"})
    git(seed, "checkout", "-q", "-b", "release")
    write_files(seed, {"release.txt": "release\n"})
    commit_all(seed, "release")
    git(seed, "checkout", "-q", "main")
    git(seed, "tag", "v1.0.0")
    origin = tmp_path / "origin.git"
    git(tmp_path, "clone", "-q", "--bare", str(seed), str(origin))
    workspace = tmp_path / "workspace"
    git(tmp_path, "clone", "-q", str(origin), str(workspace))
    configure_identity(workspace)
    return workspace, origin


def host_git_service(workspace: Path) -> GitService:
    return GitService(SandboxService(LocalHostProvider(str(workspace))))


@dataclass
class SandboxApi:
    client: AsyncClient
    headers: dict[str, str]
    sandbox_id: str
    user_id: UUID

    def url(self, endpoint: str) -> str:
        return f"/api/v1/sandbox/{self.sandbox_id}/{endpoint}"

    async def get(self, endpoint: str, **params: str) -> Response:
        return await self.client.get(
            self.url(endpoint), params=params, headers=self.headers
        )

    async def post(
        self, endpoint: str, json: dict[str, Any] | None = None, **params: str
    ) -> Response:
        return await self.client.post(
            self.url(endpoint), json=json, params=params, headers=self.headers
        )

    async def put(self, endpoint: str, json: dict[str, Any]) -> Response:
        return await self.client.put(
            self.url(endpoint), json=json, headers=self.headers
        )


OpenHostSandbox = Callable[[Path], Awaitable[SandboxApi]]


async def create_host_workspace(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    workspace_dir: Path,
) -> tuple[dict[str, str], Workspace]:
    # Points workspace_path at a real dir so the real LocalHostProvider runs.
    user = await create_user(email="host-user@example.com", username="hostuser")
    tokens = await login(email="host-user@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    workspace = Workspace(
        name="Host Workspace",
        user_id=user.id,
        sandbox_id="sandbox-hostuser",
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
def open_host_sandbox(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> OpenHostSandbox:
    async def open_sandbox(workspace_dir: Path) -> SandboxApi:
        headers, workspace = await create_host_workspace(
            db_session, create_user, login, workspace_dir
        )
        return SandboxApi(client, headers, workspace.sandbox_id, workspace.user_id)

    return open_sandbox


class ScriptedSandboxProvider(FakeSandboxProvider):
    def __init__(self) -> None:
        super().__init__()
        self.command_overrides: list[tuple[str, CommandResult]] = []
        self.list_files_error: SandboxException | None = None
        self.read_file_error: SandboxException | None = None

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


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> ScriptedSandboxProvider:
    scripted = ScriptedSandboxProvider()
    monkeypatch.setattr(
        SandboxProvider, "create_provider", FakeProviderFactory(provider=scripted)
    )
    return scripted


@pytest_asyncio.fixture
async def fake_api(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    provider: ScriptedSandboxProvider,
) -> SandboxApi:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    return SandboxApi(client, headers, workspace.sandbox_id, user.id)


def rg_match(path: str, line_number: int, line: str, start: int, end: int) -> str:
    return json.dumps(
        {
            "type": "match",
            "data": {
                "path": {"text": path},
                "line_number": line_number,
                "lines": {"text": line},
                "submatches": [{"start": start, "end": end}],
            },
        }
    )


def rg_result(*lines: str) -> CommandResult:
    return CommandResult(stdout="\n".join(lines) + "\n", stderr="", exit_code=0)


class FakeDockerExec:
    def start(self) -> "FakeDockerExec":
        return self

    async def read_out(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def inspect(self) -> dict[str, int]:
        return {"ExitCode": 0}


class FakeDockerContainer:
    def __init__(self, config: dict[str, Any], stop_error: Exception | None) -> None:
        self.config = config
        self.stop_error = stop_error
        self.execs: list[list[str]] = []
        self.deleted = False

    async def start(self) -> None:
        return None

    async def show(self) -> dict[str, Any]:
        if self.deleted:
            raise DockerError(404, {"message": "No such container"})
        return {"State": {"Status": "running"}}

    async def exec(self, cmd: list[str], user: str) -> FakeDockerExec:
        self.execs.append(cmd)
        return FakeDockerExec()

    async def stop(self, t: int) -> None:
        if self.stop_error:
            raise self.stop_error

    async def delete(self, force: bool) -> None:
        self.deleted = True


class FakeDockerContainers:
    def __init__(
        self, create_error: Exception | None, stop_error: Exception | None
    ) -> None:
        self.create_error = create_error
        self.stop_error = stop_error
        self.created: list[FakeDockerContainer] = []
        self.by_name: dict[str, FakeDockerContainer] = {}

    async def create_or_replace(
        self, name: str, config: dict[str, Any]
    ) -> FakeDockerContainer:
        if self.create_error:
            raise self.create_error
        container = FakeDockerContainer(config, self.stop_error)
        self.created.append(container)
        self.by_name[name] = container
        return container

    async def get(self, name: str) -> FakeDockerContainer:
        container = self.by_name.get(name)
        if container is None or container.deleted:
            raise DockerError(404, {"message": "No such container"})
        return container


class FakeDocker:
    def __init__(
        self,
        *,
        create_error: Exception | None = None,
        stop_error: Exception | None = None,
    ) -> None:
        self.containers = FakeDockerContainers(create_error, stop_error)


def install_fake_docker(monkeypatch: pytest.MonkeyPatch, docker: FakeDocker) -> None:
    monkeypatch.setattr(
        "app.services.sandbox_providers.docker_provider.aiodocker.Docker",
        lambda *args, **kwargs: docker,
    )


async def test_docker_sandbox_mounts_workspace_and_chowns_only_managed_dirs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    storage_root = tmp_path / "storage"
    managed_workspace = storage_root / "workspaces" / "user" / "repo"
    external_workspace = tmp_path / "local-repo"
    monkeypatch.setattr(get_settings(), "STORAGE_PATH", str(storage_root))
    docker = FakeDocker()
    install_fake_docker(monkeypatch, docker)
    provider = LocalDockerProvider(DockerConfig())

    await provider.create_sandbox(str(managed_workspace))
    await provider.create_sandbox(str(external_workspace))
    await provider.create_sandbox(None)

    managed, external, unmounted = docker.containers.created
    root = provider.workspace_root
    assert managed.config["HostConfig"]["Binds"] == [f"{managed_workspace}:{root}"]
    assert external.config["HostConfig"]["Binds"] == [f"{external_workspace}:{root}"]
    assert "Binds" not in unmounted.config["HostConfig"]
    assert managed.execs == [["chown", "-R", "1000:1000", root]]
    assert external.execs == []
    assert unmounted.execs == []


@pytest.mark.parametrize(
    ("status", "message", "expects_hint"),
    [(900, "Cannot connect to Docker Engine", True), (404, "No such image", False)],
)
async def test_docker_sandbox_create_error_hints_only_on_connectivity_failures(
    monkeypatch: pytest.MonkeyPatch, status: int, message: str, expects_hint: bool
) -> None:
    install_fake_docker(
        monkeypatch, FakeDocker(create_error=DockerError(status, {"message": message}))
    )

    with pytest.raises(SandboxException) as exc_info:
        await LocalDockerProvider(DockerConfig()).create_sandbox()

    assert exc_info.value.status_code == 502
    assert ("is Docker running?" in exc_info.value.message) is expects_hint
    assert message in exc_info.value.message


async def test_docker_sandbox_reports_constructor_connection_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def missing_docker_host(*args: Any, **kwargs: Any) -> None:
        raise ValueError("Missing valid docker_host")

    monkeypatch.setattr(
        "app.services.sandbox_providers.docker_provider.aiodocker.Docker",
        missing_docker_host,
    )

    with pytest.raises(SandboxException) as exc_info:
        await LocalDockerProvider(DockerConfig()).create_sandbox()

    assert exc_info.value.status_code == 502
    assert "is Docker running?" in exc_info.value.message
    assert "Missing valid docker_host" in exc_info.value.message


async def test_delete_docker_sandbox_removes_container_even_if_stop_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    docker = FakeDocker(stop_error=DockerError(500, {"message": "failed to stop"}))
    install_fake_docker(monkeypatch, docker)
    provider = LocalDockerProvider(DockerConfig())
    sandbox_id = await provider.create_sandbox()

    await provider.delete_sandbox(sandbox_id)

    assert docker.containers.created[0].deleted is True
    assert await provider.connect_sandbox(sandbox_id) is False


async def test_sandbox_access_requires_owner_authentication_and_live_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    provider: ScriptedSandboxProvider,
) -> None:
    owner_headers, _owner, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="sandbox-owner@example.com",
        username="sandboxowner",
    )
    other_headers, _other, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="sandbox-other@example.com",
        username="sandboxother",
    )
    metadata_url = f"/api/v1/sandbox/{workspace.sandbox_id}/files/metadata"

    owner_response = await client.get(metadata_url, headers=owner_headers)
    other_read = await client.get(metadata_url, headers=other_headers)
    other_write = await client.put(
        f"/api/v1/sandbox/{workspace.sandbox_id}/files",
        json={"file_path": "pwned.py", "content": "x"},
        headers=other_headers,
    )
    anonymous_response = await client.get(metadata_url)
    workspace.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()
    deleted_workspace_response = await client.get(metadata_url, headers=owner_headers)

    assert owner_response.status_code == 200
    assert other_read.status_code == 404
    assert other_read.json()["detail"] == "Sandbox not found"
    assert other_write.status_code == 404
    assert provider.writes == []
    assert anonymous_response.status_code == 401
    assert deleted_workspace_response.status_code == 404


@pytest.mark.parametrize("bad_cwd", ["../escape", "/etc", "x'; touch pwned; '"])
async def test_sandbox_endpoints_reject_unsafe_cwd_before_running_anything(
    fake_api: SandboxApi, provider: ScriptedSandboxProvider, bad_cwd: str
) -> None:
    responses = {
        "files/metadata": await fake_api.get("files/metadata", cwd=bad_cwd),
        "git/diff": await fake_api.get("git/diff", cwd=bad_cwd),
        "git/diff-stats": await fake_api.get("git/diff-stats", cwd=bad_cwd),
        "git/fetch-base": await fake_api.post("git/fetch-base", cwd=bad_cwd),
        "git/changed-paths": await fake_api.get("git/changed-paths", cwd=bad_cwd),
        "git/file-baseline": await fake_api.get(
            "git/file-baseline", path="a.py", cwd=bad_cwd
        ),
        "git/branches": await fake_api.get("git/branches", cwd=bad_cwd),
        "git/checkout": await fake_api.post(
            "git/checkout", json={"branch": "main", "cwd": bad_cwd}
        ),
        "git/commit": await fake_api.post(
            "git/commit", json={"message": "msg", "cwd": bad_cwd}
        ),
        "git/push": await fake_api.post("git/push", cwd=bad_cwd),
        "git/pull": await fake_api.post("git/pull", cwd=bad_cwd),
        "git/restore-file": await fake_api.post(
            "git/restore-file", json={"file_path": "a.py", "cwd": bad_cwd}
        ),
        "git/restore-all": await fake_api.post("git/restore-all", cwd=bad_cwd),
        "git/create-branch": await fake_api.post(
            "git/create-branch", json={"name": "main", "cwd": bad_cwd}
        ),
        "git/remote-url": await fake_api.get("git/remote-url", cwd=bad_cwd),
        "search": await fake_api.get("search", q="x", cwd=bad_cwd),
    }

    assert {path: r.status_code for path, r in responses.items()} == {
        path: 400 for path in responses
    }
    assert provider.commands == []
    assert provider.list_paths == []


async def test_host_sandbox_reads_lists_and_writes_real_files(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace_dir = tmp_path / "workspace"
    write_files(
        workspace_dir,
        {
            "README.md": "real readme",
            "src/app.py": "print('hi')",
            "node_modules/pkg/index.js": "module.exports = {}",
        },
    )
    (workspace_dir / "logo.zip").write_bytes(b"PK\x03\x04binarydata")
    outside_dir = tmp_path / "outside"
    write_files(outside_dir, {"secret.txt": "secret"})
    (workspace_dir / "escape-link").symlink_to(outside_dir / "secret.txt")
    (workspace_dir / "escape-dir").symlink_to(outside_dir)
    api = await open_host_sandbox(workspace_dir)

    metadata = await api.get("files/metadata")
    src_metadata = await api.get("files/metadata", cwd="src")
    content = await api.get("files/content/README.md")
    binary_content = await api.get("files/content/logo.zip")
    write = await api.put(
        "files", {"file_path": "src/nested/new.py", "content": "print('new')"}
    )
    written_content = await api.get("files/content/src/nested/new.py")
    traversal_write = await api.put(
        "files", {"file_path": "../outside.py", "content": "x"}
    )
    symlink_write = await api.put(
        "files", {"file_path": "escape-dir/planted.py", "content": "x"}
    )
    symlink_read = await api.get("files/content/escape-link")
    quoted_read = await api.get("files/content/weird'file.py")
    missing_read = await api.get("files/content/does-not-exist.py")

    assert metadata.status_code == 200
    paths = {f["path"] for f in metadata.json()["files"]}
    assert {"README.md", "src", "src/app.py", "logo.zip"} <= paths
    assert not any(p.startswith("node_modules") for p in paths)
    assert src_metadata.json()["files"] == [
        {"path": "src/app.py", "type": "file", "is_binary": False}
    ]
    assert content.json()["content"] == "real readme"
    assert binary_content.json()["is_binary"] is True
    assert base64.b64decode(binary_content.json()["content"]) == b"PK\x03\x04binarydata"
    assert write.status_code == 200
    assert written_content.json()["content"] == "print('new')"
    assert traversal_write.status_code == 400
    assert symlink_write.status_code == 400
    assert sorted(p.name for p in outside_dir.iterdir()) == ["secret.txt"]
    assert not (tmp_path / "outside.py").exists()
    assert symlink_read.status_code == 404
    assert quoted_read.status_code == 400
    assert missing_read.status_code == 404


async def test_host_sandbox_lists_git_files_honoring_gitignore(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(
        tmp_path / "repo",
        {
            ".gitignore": "secrets.env\nbuild/\n",
            "src/a.py": "a",
            "src/b.py": "b",
        },
    )
    write_files(
        repo, {"secrets.env": "TOKEN=1", "build/out.js": "x", "notes.md": "untracked"}
    )
    api = await open_host_sandbox(repo)

    response = await api.get("files/metadata")

    assert response.status_code == 200
    assert sorted(response.json()["files"], key=lambda f: f["path"]) == [
        {"path": ".gitignore", "type": "file", "is_binary": False},
        {"path": "notes.md", "type": "file", "is_binary": False},
        {"path": "src", "type": "directory", "is_binary": False},
        {"path": "src/a.py", "type": "file", "is_binary": False},
        {"path": "src/b.py", "type": "file", "is_binary": False},
    ]


async def test_get_files_metadata_propagates_provider_status_code(
    fake_api: SandboxApi, provider: ScriptedSandboxProvider
) -> None:
    provider.list_files_error = SandboxException("listing failed", status_code=502)

    response = await fake_api.get("files/metadata")

    assert response.status_code == 502
    assert response.json()["detail"] == "listing failed"


async def test_download_zip_contains_workspace_files(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace_dir = tmp_path / "workspace"
    write_files(workspace_dir, {"README.md": "readme", "src/app.py": "print('zip')"})
    (workspace_dir / "logo.png").write_bytes(b"\x89PNG\x00\xff")
    api = await open_host_sandbox(workspace_dir)

    response = await api.get("download-zip")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == (
        f'attachment; filename="sandbox_{api.sandbox_id}.zip"'
    )
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert sorted(archive.namelist()) == ["README.md", "logo.png", "src/app.py"]
        assert archive.read("README.md") == b"readme"
        assert archive.read("src/app.py") == b"print('zip')"
        assert archive.read("logo.png") == b"\x89PNG\x00\xff"


async def test_download_zip_propagates_listing_error(
    fake_api: SandboxApi, provider: ScriptedSandboxProvider
) -> None:
    provider.list_files_error = SandboxException("zip listing failed")

    response = await fake_api.get("download-zip")

    assert response.status_code == 400
    assert response.json()["detail"] == "zip listing failed"


async def test_download_zip_skips_files_that_fail_to_read(
    fake_api: SandboxApi, provider: ScriptedSandboxProvider
) -> None:
    provider.read_file_error = SandboxException("read failed")

    response = await fake_api.get("download-zip")

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == []


async def test_git_endpoints_report_non_repo_workspace(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace_dir = tmp_path / "plain"
    write_files(workspace_dir, {"app.py": "x"})
    api = await open_host_sandbox(workspace_dir)

    diff = await api.get("git/diff")
    diff_stats = await api.get("git/diff-stats")
    changed = await api.get("git/changed-paths")
    branches = await api.get("git/branches")
    baseline = await api.get("git/file-baseline", path="app.py")
    fetch = await api.post("git/fetch-base")

    assert diff.json() == {
        "diff": "",
        "has_changes": False,
        "is_git_repo": False,
        "error": None,
    }
    assert diff_stats.json()["is_git_repo"] is False
    assert changed.json() == {"paths": [], "is_git_repo": False}
    assert branches.json() == {
        "branches": [],
        "current_branch": "",
        "is_git_repo": False,
    }
    assert baseline.json() == {"path": "app.py", "content": "", "is_git_repo": False}
    assert fetch.json() == {"fetched": False}


async def test_git_diff_modes_and_full_context(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    lines = "".join(f"line{i:02d}\n" for i in range(1, 21))
    workspace, _origin = clone_with_origin(tmp_path, {"lines.txt": lines})
    git(workspace, "checkout", "-q", "-b", "feature")
    (workspace / "lines.txt").write_text(lines.replace("line05", "line05 committed"))
    commit_all(workspace, "feature change")
    (workspace / "lines.txt").write_text(
        lines.replace("line05", "line05 committed").replace("line15", "line15 dirty")
    )
    api = await open_host_sandbox(workspace)

    uncommitted = (await api.get("git/diff")).json()
    full = (await api.get("git/diff", full_context="true")).json()
    branch = (await api.get("git/diff", mode="branch")).json()

    assert uncommitted["has_changes"] is True
    assert "+line15 dirty" in uncommitted["diff"]
    assert "line05 committed" not in uncommitted["diff"]
    assert " line01\n" in full["diff"]
    assert " line05 committed\n" in full["diff"]
    assert "+line05 committed" in branch["diff"]
    assert "line15 dirty" not in branch["diff"]
    assert branch["error"] is None


async def test_git_diff_branch_mode_reports_unknown_base(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(tmp_path / "repo", {"app.py": "v1\n"}, branch="work")
    api = await open_host_sandbox(repo)

    response = await api.get("git/diff", mode="branch")

    assert response.json() == {
        "diff": "",
        "has_changes": False,
        "is_git_repo": True,
        "error": "Could not determine base branch",
    }


async def test_git_diff_unborn_head_emits_each_file_once(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    # The old unborn-HEAD fallback double-emitted staged-then-modified paths.
    repo = init_repo(tmp_path / "repo")
    write_files(repo, {"app.py": "print('v1')\n"})
    git(repo, "add", ".")
    write_files(repo, {"app.py": "print('v1')\nprint('v2')\n", "notes.txt": "u\n"})
    api = await open_host_sandbox(repo)

    body = (await api.get("git/diff")).json()

    assert body["is_git_repo"] is True
    assert body["has_changes"] is True
    assert body["diff"].count("diff --git a/app.py b/app.py") == 1
    assert "print('v2')" in body["diff"]
    assert "diff --git a/notes.txt b/notes.txt" in body["diff"]
    assert body["diff"].count("diff --git") == 2


async def test_git_diff_stats_counts_uncommitted_and_branch(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(tmp_path / "repo", {"app.py": "a\nb\nc\n"})
    git(repo, "checkout", "-q", "-b", "feature")
    write_files(repo, {"app.py": "a\nB\nc\nd\n"})
    commit_all(repo, "feature")
    write_files(repo, {"app.py": "a\nB\nc\nd\ne\n", "notes.txt": "x\ny\n"})
    (repo / "logo.bin").write_bytes(b"\x00\x01\x02")
    api = await open_host_sandbox(repo)

    response = await api.get("git/diff-stats")

    assert response.json() == {
        "uncommitted": {"additions": 3, "deletions": 0, "files_changed": 3},
        "branch": {"additions": 2, "deletions": 1, "files_changed": 1},
        "is_git_repo": True,
        "head_sha": rev(repo),
    }
    status = git(repo, "status", "--porcelain").splitlines()
    assert "?? notes.txt" in status
    assert "?? logo.bin" in status
    assert git(repo, "diff", "--cached", "--name-only") == ""


async def test_git_diff_stats_unborn_head(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(tmp_path / "repo")
    write_files(repo, {"app.py": "a\nb\n"})
    git(repo, "add", "app.py")
    write_files(repo, {"notes.txt": "x\n"})
    api = await open_host_sandbox(repo)

    response = await api.get("git/diff-stats")

    assert response.json() == {
        "uncommitted": {"additions": 3, "deletions": 0, "files_changed": 2},
        "branch": {"additions": 0, "deletions": 0, "files_changed": 0},
        "is_git_repo": True,
        "head_sha": None,
    }
    assert git(repo, "diff", "--cached", "--name-only").strip() == "app.py"
    assert "?? notes.txt" in git(repo, "status", "--porcelain").splitlines()


async def test_git_changed_paths_are_relative_to_cwd(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(
        tmp_path / "repo", {"packages/api/app.py": "v1\n", "other/file.py": "x\n"}
    )
    write_files(
        repo,
        {
            "packages/api/app.py": "v2\n",
            "packages/api/new dir/with space.py": "new\n",
            "other/new.py": "new\n",
        },
    )
    api = await open_host_sandbox(repo)

    root = (await api.get("git/changed-paths")).json()
    scoped = (await api.get("git/changed-paths", cwd="packages/api")).json()

    assert sorted(root["paths"]) == [
        "other/new.py",
        "packages/api/app.py",
        "packages/api/new dir/with space.py",
    ]
    assert sorted(scoped["paths"]) == ["app.py", "new dir/with space.py"]
    assert scoped["is_git_repo"] is True


async def test_git_file_baseline_returns_head_content(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(tmp_path / "repo", {"src/app.py": "committed\n"})
    write_files(repo, {"src/app.py": "working\n", "src/new.py": "new\n"})
    api = await open_host_sandbox(repo)

    tracked = await api.get("git/file-baseline", path="src/app.py")
    cwd_relative = await api.get("git/file-baseline", path="app.py", cwd="src")
    new_file = await api.get("git/file-baseline", path="src/new.py")
    option_like = await api.get("git/file-baseline", path="-rf")
    traversal = await api.get("git/file-baseline", path="../secret")

    assert tracked.json() == {
        "path": "src/app.py",
        "content": "committed\n",
        "is_git_repo": True,
    }
    assert cwd_relative.json()["content"] == "committed\n"
    assert new_file.json() == {"path": "src/new.py", "content": "", "is_git_repo": True}
    assert option_like.status_code == 400
    assert traversal.status_code == 400


async def test_git_branches_and_checkout_of_local_and_remote_only_branches(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace, _origin = clone_with_origin(tmp_path)
    git(workspace, "branch", "feature")
    # Disable git's DWIM so the remote-tracking fallback has to do the work.
    git(workspace, "config", "checkout.guess", "false")
    api = await open_host_sandbox(workspace)

    branches = await api.get("git/branches")
    local = await api.post("git/checkout", json={"branch": "feature"})
    remote = await api.post("git/checkout", json={"branch": "release"})

    assert branches.json() == {
        "branches": ["feature", "main", "release"],
        "current_branch": "main",
        "is_git_repo": True,
    }
    assert local.json() == {"success": True, "current_branch": "feature", "error": None}
    assert remote.json() == {
        "success": True,
        "current_branch": "release",
        "error": None,
    }
    assert rev(workspace) == rev(workspace, "origin/release")


async def test_git_checkout_failures_keep_current_branch(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace, _origin = clone_with_origin(tmp_path)
    api = await open_host_sandbox(workspace)

    missing = await api.post("git/checkout", json={"branch": "nope"})
    tag = await api.post("git/checkout", json={"branch": "v1.0.0"})
    option_like = await api.post("git/checkout", json={"branch": "-bad"})

    assert missing.json()["success"] is False
    assert missing.json()["error"]
    assert tag.json() == {
        "success": False,
        "current_branch": "",
        "error": "Cannot checkout: would result in detached HEAD",
    }
    assert option_like.status_code == 400
    assert git(workspace, "symbolic-ref", "--short", "HEAD").strip() == "main"
    assert "nope" not in git(workspace, "branch", "--list", "nope")


async def test_git_create_branch_from_head_and_remote_only_base(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace, _origin = clone_with_origin(tmp_path)
    api = await open_host_sandbox(workspace)

    from_head = await api.post("git/create-branch", json={"name": "from-head"})
    from_remote = await api.post(
        "git/create-branch", json={"name": "from-release", "base_branch": "release"}
    )
    duplicate = await api.post("git/create-branch", json={"name": "from-head"})
    bad_name = await api.post("git/create-branch", json={"name": "bad name"})
    bad_base = await api.post(
        "git/create-branch", json={"name": "ok-name", "base_branch": "bad base"}
    )

    assert from_head.json() == {
        "success": True,
        "current_branch": "from-head",
        "error": None,
    }
    assert from_remote.json() == {
        "success": True,
        "current_branch": "from-release",
        "error": None,
    }
    assert rev(workspace) == rev(workspace, "origin/release")
    assert duplicate.json()["success"] is False
    assert "already exists" in duplicate.json()["error"]
    assert bad_name.status_code == 400
    assert bad_base.status_code == 400


async def test_git_commit_push_and_pull_against_real_remote(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace, origin = clone_with_origin(tmp_path)
    api = await open_host_sandbox(workspace)
    message = "fix: it's `touch pwned-backtick` $(touch pwned-subshell)"
    write_files(workspace, {"app.py": "v2\n"})

    commit = await api.post("git/commit", json={"message": message})
    nothing_to_commit = await api.post("git/commit", json={"message": "empty"})
    push = await api.post("git/push")
    pull = await api.post("git/pull")

    assert commit.json()["success"] is True
    assert git(workspace, "log", "-1", "--format=%s").strip() == message
    assert list(workspace.glob("pwned-*")) == []
    assert nothing_to_commit.json()["success"] is False
    assert push.json()["success"] is True
    assert rev(origin, "main") == rev(workspace)
    assert pull.json() == {
        "success": True,
        "output": "Already up to date.",
        "error": None,
    }

    other = tmp_path / "other"
    git(tmp_path, "clone", "-q", str(origin), str(other))
    configure_identity(other)
    write_files(other, {"other.txt": "x\n"})
    commit_all(other, "concurrent")
    git(other, "push", "-q")
    write_files(workspace, {"app.py": "v3\n"})
    await api.post("git/commit", json={"message": "local"})

    rejected = await api.post("git/push")

    assert rejected.json()["success"] is False
    assert "rejected" in rejected.json()["error"]


async def test_git_commands_receive_custom_env_and_github_askpass(
    tmp_path: Path,
    db_session: AsyncSession,
    open_host_sandbox: OpenHostSandbox,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    repo = init_repo(tmp_path / "repo", {"app.py": "v1\n"})
    hook = repo / ".git" / "hooks" / "pre-commit"
    hook.write_text(
        '#!/bin/sh\necho "var=$MY_VAR askpass=$("$GIT_ASKPASS" Password)"\n'
    )
    hook.chmod(0o755)
    api = await open_host_sandbox(repo)
    user_settings = await get_user_settings(db_session, api.user_id)
    assert user_settings is not None
    user_settings.custom_env_vars = [{"key": "MY_VAR", "value": "hello"}]
    flag_modified(user_settings, "custom_env_vars")
    user_settings.github_personal_access_token = "ghp_test_token"
    await db_session.commit()
    write_files(repo, {"app.py": "v2\n"})

    response = await api.post("git/commit", json={"message": "with env"})

    assert response.json()["success"] is True
    assert "var=hello askpass=ghp_test_token" in response.json()["output"]


async def test_git_restore_all_discards_changes_but_keeps_ignored_files(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(
        tmp_path / "repo",
        {".gitignore": ".env\n", "app.py": "v1\n", "src/lib.py": "lib\n"},
    )
    write_files(repo, {"app.py": "v2\n", "staged.py": "s\n", "scratch/tmp.txt": "t\n"})
    write_files(repo, {".env": "SECRET=1\n"})
    (repo / "src" / "lib.py").unlink()
    git(repo, "add", "staged.py")
    api = await open_host_sandbox(repo)

    response = await api.post("git/restore-all", cwd="src")

    assert response.json()["success"] is True
    assert (repo / "app.py").read_text() == "v1\n"
    assert (repo / "src" / "lib.py").read_text() == "lib\n"
    assert not (repo / "staged.py").exists()
    assert not (repo / "scratch").exists()
    assert (repo / ".env").read_text() == "SECRET=1\n"
    assert git(repo, "status", "--porcelain") == ""


async def test_git_restore_file_handles_modified_new_and_renamed_files(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    repo = init_repo(
        tmp_path / "repo",
        {"app.py": "v1\n", "old.py": "old\n", "src/keep.py": "keep\n"},
    )
    write_files(
        repo,
        {"app.py": "v2\n", "new.py": "n\n", "staged.py": "s\n", "src/keep.py": "x\n"},
    )
    git(repo, "add", "staged.py")
    git(repo, "mv", "old.py", "renamed.py")
    api = await open_host_sandbox(repo)

    responses = [
        await api.post("git/restore-file", json={"file_path": "app.py"}),
        await api.post("git/restore-file", json={"file_path": "new.py"}),
        await api.post("git/restore-file", json={"file_path": "staged.py"}),
        await api.post(
            "git/restore-file", json={"file_path": "renamed.py", "old_path": "old.py"}
        ),
        await api.post(
            "git/restore-file", json={"file_path": "src/keep.py", "cwd": "src"}
        ),
    ]
    invalid = [
        await api.post("git/restore-file", json={"file_path": "../escape.py"}),
        await api.post("git/restore-file", json={"file_path": "/etc/passwd"}),
        await api.post(
            "git/restore-file", json={"file_path": "ok.py", "old_path": "-bad"}
        ),
    ]

    assert [r.json()["success"] for r in responses] == [True] * 5
    assert (repo / "app.py").read_text() == "v1\n"
    assert (repo / "old.py").read_text() == "old\n"
    assert (repo / "src" / "keep.py").read_text() == "keep\n"
    assert not (repo / "new.py").exists()
    assert not (repo / "staged.py").exists()
    assert not (repo / "renamed.py").exists()
    assert git(repo, "status", "--porcelain") == ""
    assert [r.status_code for r in invalid] == [400, 400, 400]


@pytest.mark.parametrize(
    ("remote", "status_code", "body"),
    [
        (
            "https://github.com/agentrove/app.git",
            200,
            {
                "remote_url": "https://github.com/agentrove/app.git",
                "owner": "agentrove",
                "repo": "app",
            },
        ),
        (
            "git@github.com:agentrove/app",
            200,
            {
                "remote_url": "git@github.com:agentrove/app",
                "owner": "agentrove",
                "repo": "app",
            },
        ),
        (
            "https://gitlab.com/foo/bar.git",
            400,
            {
                "detail": "No GitHub remote detected — only github.com remotes "
                "are supported"
            },
        ),
        (None, 400, {"detail": "No git remote origin found"}),
    ],
)
async def test_git_remote_url_parses_github_remotes(
    tmp_path: Path,
    open_host_sandbox: OpenHostSandbox,
    remote: str | None,
    status_code: int,
    body: dict[str, str],
) -> None:
    repo = init_repo(tmp_path / "repo", {"app.py": "v1\n"})
    if remote:
        git(repo, "remote", "add", "origin", remote)
    api = await open_host_sandbox(repo)

    response = await api.get("git/remote-url")

    assert response.status_code == status_code
    assert {k: response.json()[k] for k in body} == body


async def test_git_fetch_base_fetches_default_branch_then_throttles(
    tmp_path: Path, open_host_sandbox: OpenHostSandbox
) -> None:
    workspace, origin = clone_with_origin(tmp_path)
    upstream = tmp_path / "upstream"
    git(tmp_path, "clone", "-q", str(origin), str(upstream))
    configure_identity(upstream)
    write_files(upstream, {"upstream.txt": "new\n"})
    commit_all(upstream, "upstream change")
    git(upstream, "push", "-q")
    api = await open_host_sandbox(workspace)

    first = await api.post("git/fetch-base")
    second = await api.post("git/fetch-base")

    assert first.json() == {"fetched": True}
    assert rev(workspace, "origin/main") == rev(upstream)
    assert second.json() == {"fetched": False}


async def test_create_worktree_from_local_and_remote_only_base(
    tmp_path: Path,
) -> None:
    workspace, _origin = clone_with_origin(tmp_path)
    git(workspace, "branch", "feature/api-keys")
    service = host_git_service(workspace)

    local_cwd = await service.create_worktree(
        "sandbox-1",
        "",
        "aaaaaaaa-0000-0000-0000-000000000000",
        base_ref="feature/api-keys",
    )
    remote_cwd = await service.create_worktree(
        "sandbox-1", "", "bbbbbbbb-0000-0000-0000-000000000000", base_ref="release"
    )
    repeated_cwd = await service.create_worktree(
        "sandbox-1",
        "",
        "aaaaaaaa-0000-0000-0000-000000000000",
        base_ref="feature/api-keys",
    )

    assert local_cwd == repeated_cwd == ".worktrees/aaaaaaaa"
    assert remote_cwd == ".worktrees/bbbbbbbb"
    local_tree = workspace / local_cwd
    remote_tree = workspace / remote_cwd
    assert git(local_tree, "branch", "--show-current").strip() == "worktree-aaaaaaaa"
    assert rev(local_tree) == rev(workspace, "feature/api-keys")
    assert rev(remote_tree) == rev(workspace, "origin/release")
    assert git(workspace, "status", "--porcelain") == ""


@pytest.mark.parametrize("base_ref", ["-evil", "a b", "x'y", "a..b", "@{u}", ""])
async def test_create_worktree_rejects_unsafe_base_ref(
    tmp_path: Path, base_ref: str
) -> None:
    repo = init_repo(tmp_path / "repo", {"app.py": "v1\n"})

    with pytest.raises(SandboxException, match="^Invalid base branch name$"):
        await host_git_service(repo).create_worktree(
            "sandbox-1", "", "12345678-0000", base_ref=base_ref
        )

    assert not (repo / ".worktrees").exists()


async def test_create_worktree_surfaces_git_failures(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "repo", {"app.py": "v1\n"})
    plain = tmp_path / "plain"
    plain.mkdir()

    with pytest.raises(SandboxException, match="origin/missing"):
        await host_git_service(repo).create_worktree(
            "sandbox-1", "", "12345678-0000", base_ref="missing"
        )
    with pytest.raises(
        SandboxException, match="^Worktree mode requires a git workspace$"
    ):
        await host_git_service(plain).create_worktree("sandbox-1", "", "12345678-0000")


async def test_remove_worktree_keeps_dirty_worktrees(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "repo", {"app.py": "v1\n"})
    service = host_git_service(repo)
    clean_cwd = await service.create_worktree("sandbox-1", "", "cccccccc-0000")
    dirty_cwd = await service.create_worktree("sandbox-1", "", "dddddddd-0000")
    write_files(repo / dirty_cwd, {"app.py": "unsaved work\n"})

    await service.remove_worktree("sandbox-1", clean_cwd)
    await service.remove_worktree("sandbox-1", dirty_cwd)
    await service.remove_worktree("sandbox-1", ".worktrees/missing0")

    assert not (repo / clean_cwd).exists()
    assert (repo / dirty_cwd / "app.py").read_text() == "unsaved work\n"
    branches = git(repo, "branch", "--format=%(refname:short)").split()
    assert "worktree-cccccccc" not in branches
    assert "worktree-dddddddd" in branches


async def test_checkpoint_restore_returns_tree_to_pre_run_state(
    tmp_path: Path,
) -> None:
    repo = init_repo(
        tmp_path / "repo", {"app.py": "v1\n", "keep.txt": "keep\n", "src/x.py": "x\n"}
    )
    base_head = rev(repo)
    write_files(
        repo,
        {"app.py": "v1 dirty\n", "notes.txt": "untracked\n", "src/new.py": "new\n"},
    )
    (repo / "logo.png").write_bytes(b"\x89PNG\x00\x01")
    service = host_git_service(repo)

    checkpoint = await service.create_checkpoint("sandbox-1")
    assert checkpoint is not None
    assert checkpoint.base_head == base_head
    write_files(repo, {"app.py": "agent\n", "agent.py": "agent\n"})
    (repo / "keep.txt").unlink()
    commit_all(repo, "agent commit")
    write_files(repo, {"agent-scratch.txt": "tmp\n"})

    result = await service.restore_checkpoint_all(
        "sandbox-1",
        base_head=checkpoint.base_head,
        pre_run_diff=checkpoint.pre_run_diff,
    )

    assert result.success is True
    assert rev(repo) == base_head
    assert (repo / "app.py").read_text() == "v1 dirty\n"
    assert (repo / "notes.txt").read_text() == "untracked\n"
    assert (repo / "src" / "new.py").read_text() == "new\n"
    assert (repo / "logo.png").read_bytes() == b"\x89PNG\x00\x01"
    assert (repo / "keep.txt").read_text() == "keep\n"
    assert not (repo / "agent.py").exists()
    assert not (repo / "agent-scratch.txt").exists()
    assert list(repo.rglob(".agentrove-checkpoint-*")) == []


@pytest.mark.xfail(
    strict=True,
    reason="Checkpoint captures untracked files relative to the workspace dir "
    "but restores (reset/clean/apply) from the repo toplevel, so a workspace "
    "inside a larger repo loses untracked files outside it and misplaces its own.",
)
async def test_checkpoint_restore_in_workspace_below_repo_root(
    tmp_path: Path,
) -> None:
    repo = init_repo(tmp_path / "repo", {"a.py": "a\n", "pkg/x.py": "x\n"})
    base_head = rev(repo)
    write_files(repo, {"outside.txt": "keep me\n", "pkg/new.py": "new\n"})
    service = host_git_service(repo / "pkg")

    checkpoint = await service.create_checkpoint("sandbox-1")
    assert checkpoint is not None
    await service.restore_checkpoint_all(
        "sandbox-1", base_head=base_head, pre_run_diff=checkpoint.pre_run_diff
    )

    assert (repo / "outside.txt").read_text() == "keep me\n"
    assert (repo / "pkg" / "new.py").read_text() == "new\n"


async def test_checkpoint_edge_cases(tmp_path: Path) -> None:
    clean_repo = init_repo(tmp_path / "clean", {"app.py": "v1\n"})
    unborn_repo = init_repo(tmp_path / "unborn")
    plain = tmp_path / "plain"
    plain.mkdir()

    service = host_git_service(clean_repo)

    clean = await service.create_checkpoint("sandbox-1")
    unborn = await host_git_service(unborn_repo).create_checkpoint("sandbox-1")
    not_repo = await host_git_service(plain).create_checkpoint("sandbox-1")
    assert clean is not None
    write_files(clean_repo, {"app.py": "agent\n", "agent.py": "agent\n"})
    restored = await service.restore_checkpoint_all(
        "sandbox-1", base_head=clean.base_head, pre_run_diff=clean.pre_run_diff
    )

    assert clean.base_head == rev(clean_repo)
    assert clean.pre_run_diff == ""
    assert restored.success is True
    assert git(clean_repo, "status", "--porcelain") == ""
    assert (clean_repo / "app.py").read_text() == "v1\n"
    assert unborn is None
    assert not_repo is None
    with pytest.raises(ValueError, match="Invalid checkpoint commit"):
        await service.restore_checkpoint_all(
            "sandbox-1", base_head="HEAD; rm -rf /", pre_run_diff=""
        )


def rg_argv(provider: ScriptedSandboxProvider) -> list[str]:
    [command] = [c for _sid, c, _envs in provider.commands if "rg " in c]
    tokens = shlex.split(command)
    return tokens[tokens.index("rg") :]


@pytest.mark.parametrize(
    ("params", "present", "absent", "globs"),
    [
        ({}, {"-F", "-i"}, {"-w"}, []),
        (
            {"case_sensitive": "true", "regex": "true", "whole_word": "true"},
            {"-w"},
            {"-F", "-i"},
            [],
        ),
        (
            {"include": "*.py", "exclude": "vendor/*"},
            set(),
            set(),
            ["*.py", "!vendor/*"],
        ),
    ],
)
async def test_search_maps_options_to_rg_and_passes_query_verbatim(
    fake_api: SandboxApi,
    provider: ScriptedSandboxProvider,
    params: dict[str, str],
    present: set[str],
    absent: set[str],
    globs: list[str],
) -> None:
    query = "it's $(touch pwned) needle"
    provider.script("rg ", CommandResult(stdout="", stderr="", exit_code=1))

    response = await fake_api.get("search", q=query, **params)

    assert response.json() == {"results": [], "truncated": False}
    argv = rg_argv(provider)
    assert argv[-3:] == ["--", query, "."]
    flags = argv[1:-3]
    assert present <= set(flags)
    assert not absent & set(flags)
    assert [flags[i + 1] for i, flag in enumerate(flags) if flag == "-g"] == globs


async def test_search_groups_matches_and_reports_character_offsets(
    fake_api: SandboxApi, provider: ScriptedSandboxProvider
) -> None:
    long_line = "x" * 1500 + "needle" + "y" * 1000 + "\n"
    accented = "héllo needle\n"
    provider.script(
        "rg ",
        rg_result(
            json.dumps({"type": "begin", "data": {}}),
            "not json",
            rg_match("./app.py", 1, "needle = 1\n", 0, 6),
            rg_match("./app.py", 7, "        return needle\n", 15, 21),
            rg_match(
                "./lib/util.py",
                2,
                accented,
                accented.encode().index(b"needle"),
                accented.encode().index(b"needle") + 6,
            ),
            rg_match("./min.js", 1, long_line, 1500, 1506),
        ),
    )

    response = await fake_api.get("search", q="needle", cwd="src")

    body = response.json()
    assert body["truncated"] is False
    assert [r["path"] for r in body["results"]] == [
        "src/app.py",
        "src/lib/util.py",
        "src/min.js",
    ]
    assert [m["line_number"] for m in body["results"][0]["matches"]] == [1, 7]
    assert body["results"][0]["matches"][1]["line_text"] == "return needle"
    minified = body["results"][2]["matches"][0]["line_text"]
    assert minified.startswith("…") and minified.endswith("…")
    assert len(minified) <= 502
    for result in body["results"]:
        for match in result["matches"]:
            text = match["line_text"]
            assert text[match["match_start"] : match["match_end"]] == "needle"


async def test_search_flags_truncation_per_file_and_in_total() -> None:
    provider = ScriptedSandboxProvider()
    provider.script(
        "rg ",
        rg_result(
            rg_match("./a.py", 1, "needle\n", 0, 6),
            rg_match("./a.py", 2, "needle\n", 0, 6),
            rg_match("./b.py", 1, "needle\n", 0, 6),
            rg_match("./c.py", 1, "needle\n", 0, 6),
        ),
    )
    service = SearchService(SandboxService(provider))

    per_file = await service.search(
        "sandbox-1", "needle", max_file_matches=2, max_total_matches=10
    )
    total = await service.search(
        "sandbox-1", "needle", max_file_matches=5, max_total_matches=3
    )
    complete = await service.search(
        "sandbox-1", "needle", max_file_matches=5, max_total_matches=10
    )

    assert per_file.truncated is True
    assert total.truncated is True
    assert sum(len(r.matches) for r in total.results) == 3
    assert complete.truncated is False
    assert [r.path for r in complete.results] == ["a.py", "b.py", "c.py"]


@pytest.mark.parametrize(
    ("stdout", "stderr"), [("", "regex parse error"), ("regex parse error", "")]
)
async def test_search_failure_surfaces_rg_error(
    fake_api: SandboxApi, provider: ScriptedSandboxProvider, stdout: str, stderr: str
) -> None:
    # Docker merges stderr into stdout, so either stream may carry the error.
    provider.script("rg ", CommandResult(stdout=stdout, stderr=stderr, exit_code=2))

    response = await fake_api.get("search", q="needle")

    assert response.status_code == 400
    assert response.json()["detail"] == "Search failed: regex parse error"
