import asyncio
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.services.git import GitService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.host_provider import LocalHostProvider

from tests.conftest import LoginClient, UserFactory
from tests.helpers import get_user_by_email, get_user_settings


pytestmark = pytest.mark.anyio


class FakeGitProcess:
    def __init__(
        self, returncode: int, stdout: bytes, stderr: bytes, *, hang: bool = False
    ) -> None:
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr
        self._hang = hang

    async def communicate(self) -> tuple[bytes, bytes]:
        if self._hang:
            await asyncio.Event().wait()
        return self._stdout, self._stderr

    def kill(self) -> None:
        return None

    async def wait(self) -> None:
        return None


class FakeGitClone:
    def __init__(
        self, *, returncode: int = 0, stderr: bytes = b"", hang: bool = False
    ) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.hang = hang
        self.calls: list[tuple[tuple[str, ...], dict[str, str] | None]] = []
        self.askpass_answers: dict[str, str] = {}

    async def __call__(
        self,
        *args: str,
        stdout: int,
        stderr: int,
        env: dict[str, str] | None = None,
    ) -> FakeGitProcess:
        self.calls.append((args, env))
        if env and "GIT_ASKPASS" in env:
            # Ask the helper exactly as git would while the clone is running.
            for prompt in ("Username", "Password"):
                self.askpass_answers[prompt] = subprocess.run(
                    [env["GIT_ASKPASS"], f"{prompt} for 'https://github.com': "],
                    env=env,
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.strip()
        # Real `git clone` creates the target dir before it can fail or stall.
        Path(args[-1]).mkdir(parents=True, exist_ok=True)
        return FakeGitProcess(self.returncode, b"", self.stderr, hang=self.hang)


async def login_headers(
    create_user: UserFactory, login: LoginClient, email: str, username: str
) -> dict[str, str]:
    await create_user(email=email, username=username)
    tokens = await login(email=email)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def create_workspace(
    client: AsyncClient, headers: dict[str, str], **payload: Any
) -> Any:
    return await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Test Workspace",
            "source_type": "empty",
            "sandbox_provider": "host",
            **payload,
        },
        headers=headers,
    )


async def owner_with_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    **payload: Any,
) -> tuple[dict[str, str], dict[str, Any]]:
    headers = await login_headers(
        create_user, login, "workspace@example.com", "workspaceuser"
    )
    response = await create_workspace(client, headers, **payload)
    assert response.status_code == 201
    return headers, response.json()


async def set_github_token(db_session: AsyncSession, email: str, token: str) -> None:
    user = await get_user_by_email(db_session, email)
    assert user is not None
    user_settings = await get_user_settings(db_session, user.id)
    assert user_settings is not None
    user_settings.github_personal_access_token = token
    await db_session.commit()


async def wait_for_workspace_teardown() -> None:
    # Workspace deletion tears the sandbox down in a fire-and-forget task.
    pending = [
        task
        for task in asyncio.all_tasks()
        if task.get_coro().__name__ == "teardown_workspace_sandbox"
    ]
    await asyncio.gather(*pending)


def user_workspace_dir(user_id: str) -> Path:
    return Path(get_settings().STORAGE_PATH) / "workspaces" / user_id


async def test_create_empty_workspace_provisions_directory_and_sandbox(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _headers, body = await owner_with_workspace(
        client, create_user, login, name="New Workspace"
    )

    assert body["name"] == "New Workspace"
    assert body["sandbox_id"]
    assert body["sandbox_provider"] == "host"
    assert body["source_type"] == "empty"
    assert body["source_url"] is None
    workspace_path = Path(body["workspace_path"])
    assert workspace_path.is_dir()
    assert workspace_path.parent == user_workspace_dir(body["user_id"]).resolve()


async def test_list_get_and_update_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, workspace = await owner_with_workspace(
        client, create_user, login, name="Original Name"
    )
    workspace_id = workspace["id"]

    update_response = await client.patch(
        f"/api/v1/workspaces/{workspace_id}",
        json={"name": "Renamed Workspace"},
        headers=headers,
    )
    list_response = await client.get("/api/v1/workspaces", headers=headers)
    get_response = await client.get(
        f"/api/v1/workspaces/{workspace_id}", headers=headers
    )

    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Renamed Workspace"
    listed = list_response.json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == workspace_id
    assert listed["items"][0]["name"] == "Renamed Workspace"
    assert get_response.json()["name"] == "Renamed Workspace"


async def test_list_workspaces_orders_by_latest_chat_and_counts_top_level_chats(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, older = await owner_with_workspace(
        client, create_user, login, name="Older"
    )
    newer = (await create_workspace(client, headers, name="Newer")).json()
    user_id = UUID(older["user_id"])
    older_id = UUID(older["id"])
    parent = Chat(title="Parent", user_id=user_id, workspace_id=older_id)
    db_session.add_all(
        [
            parent,
            Chat(title="Second", user_id=user_id, workspace_id=older_id),
            Chat(
                title="Deleted",
                user_id=user_id,
                workspace_id=older_id,
                deleted_at=datetime.now(timezone.utc),
            ),
        ]
    )
    await db_session.flush()
    db_session.add(
        Chat(
            title="Sub-thread",
            user_id=user_id,
            workspace_id=older_id,
            parent_chat_id=parent.id,
        )
    )
    await db_session.commit()

    response = await client.get("/api/v1/workspaces", headers=headers)

    items = response.json()["items"]
    assert [item["id"] for item in items] == [older["id"], newer["id"]]
    assert items[0]["chat_count"] == 2
    assert items[0]["last_chat_at"] is not None
    assert items[1]["chat_count"] == 0
    assert items[1]["last_chat_at"] is None


async def test_workspace_resources_lists_builtin_slash_commands(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, workspace = await owner_with_workspace(client, create_user, login)

    response = await client.get(
        f"/api/v1/workspaces/{workspace['id']}/resources", headers=headers
    )

    assert response.status_code == 200
    assert set(response.json()["builtin_slash_commands"]) >= {"claude", "codex"}


async def test_workspace_endpoints_hide_other_users_workspaces(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    owner_headers, workspace = await owner_with_workspace(
        client, create_user, login, name="Owner Workspace"
    )
    other_headers = await login_headers(
        create_user, login, "other@example.com", "otheruser"
    )
    url = f"/api/v1/workspaces/{workspace['id']}"
    missing_url = "/api/v1/workspaces/00000000-0000-0000-0000-000000000002"

    other_list = await client.get("/api/v1/workspaces", headers=other_headers)
    other_responses = [
        await client.get(url, headers=other_headers),
        await client.get(f"{url}/resources", headers=other_headers),
        await client.patch(url, json={"name": "Hijacked"}, headers=other_headers),
        await client.delete(url, headers=other_headers),
    ]
    missing_responses = [
        await client.get(missing_url, headers=owner_headers),
        await client.patch(missing_url, json={"name": "x"}, headers=owner_headers),
        await client.delete(missing_url, headers=owner_headers),
    ]
    owner_get = await client.get(url, headers=owner_headers)

    assert other_list.json()["items"] == []
    assert [r.status_code for r in other_responses] == [404, 404, 404, 404]
    assert [r.status_code for r in missing_responses] == [404, 404, 404]
    assert owner_get.status_code == 200
    assert owner_get.json()["name"] == "Owner Workspace"


async def test_workspaces_reject_missing_token(client: AsyncClient) -> None:
    workspace_id = UUID("00000000-0000-0000-0000-000000000001")

    list_response = await client.get("/api/v1/workspaces")
    create_response = await client.post(
        "/api/v1/workspaces",
        json={"name": "No Auth", "source_type": "empty", "sandbox_provider": "host"},
    )
    get_response = await client.get(f"/api/v1/workspaces/{workspace_id}")

    assert list_response.status_code == 401
    assert create_response.status_code == 401
    assert get_response.status_code == 401


async def test_delete_workspace_soft_deletes_chats_and_revokes_sandbox_access(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, workspace = await owner_with_workspace(client, create_user, login)
    workspace_id = workspace["id"]
    chat = Chat(
        title="Doomed Chat",
        user_id=UUID(workspace["user_id"]),
        workspace_id=UUID(workspace_id),
    )
    db_session.add(chat)
    await db_session.flush()
    message = Message(
        chat_id=chat.id,
        content_text="Hello",
        content_render={"events": [{"type": "user_text", "text": "Hello"}]},
        role=MessageRole.USER,
        stream_status=MessageStreamStatus.COMPLETED,
    )
    db_session.add(message)
    await db_session.commit()

    response = await client.delete(
        f"/api/v1/workspaces/{workspace_id}", headers=headers
    )
    await wait_for_workspace_teardown()
    list_response = await client.get("/api/v1/workspaces", headers=headers)
    get_response = await client.get(
        f"/api/v1/workspaces/{workspace_id}", headers=headers
    )
    files_response = await client.get(
        f"/api/v1/sandbox/{workspace['sandbox_id']}/files/metadata", headers=headers
    )

    assert response.status_code == 204
    assert list_response.json()["items"] == []
    assert get_response.status_code == 404
    assert files_response.status_code == 404
    await db_session.refresh(chat)
    await db_session.refresh(message)
    assert chat.deleted_at is not None
    assert message.deleted_at is not None


async def test_delete_local_workspace_removes_chat_worktrees_but_keeps_repo(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    for args in (
        ["-c", "init.defaultBranch=main", "init", "-q"],
        ["config", "user.email", "test@example.com"],
        ["config", "user.name", "Test"],
        ["config", "commit.gpgsign", "false"],
        ["commit", "-q", "--allow-empty", "-m", "initial"],
    ):
        subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)
    (repo / "app.py").write_text("user work\n")
    headers, workspace = await owner_with_workspace(
        client, create_user, login, source_type="local", workspace_path=str(repo)
    )
    chat = Chat(
        title="Worktree Chat",
        user_id=UUID(workspace["user_id"]),
        workspace_id=UUID(workspace["id"]),
    )
    db_session.add(chat)
    await db_session.flush()
    git_service = GitService(SandboxService(LocalHostProvider(str(repo))))
    chat.worktree_cwd = await git_service.create_worktree(
        workspace["sandbox_id"], "", str(chat.id)
    )
    await db_session.commit()
    assert (repo / chat.worktree_cwd).is_dir()

    response = await client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=headers
    )
    await wait_for_workspace_teardown()

    assert response.status_code == 204
    assert not (repo / chat.worktree_cwd).exists()
    assert (repo / "app.py").read_text() == "user work\n"


async def test_create_workspace_from_local_path(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    tmp_path: Path,
) -> None:
    _headers, body = await owner_with_workspace(
        client,
        create_user,
        login,
        source_type="local",
        workspace_path=str(tmp_path / "." / "project" / ".."),
    )

    assert body["source_type"] == "local"
    assert body["source_url"] is None
    assert body["workspace_path"] == str(tmp_path.resolve())


async def test_create_workspace_local_rejects_missing_and_nonexistent_path(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    tmp_path: Path,
) -> None:
    headers = await login_headers(
        create_user, login, "local-invalid@example.com", "localinvalid"
    )
    (tmp_path / "file.txt").write_text("not a dir")

    missing = await create_workspace(client, headers, source_type="local")
    nonexistent = await create_workspace(
        client,
        headers,
        source_type="local",
        workspace_path=str(tmp_path / "does-not-exist"),
    )
    a_file = await create_workspace(
        client,
        headers,
        source_type="local",
        workspace_path=str(tmp_path / "file.txt"),
    )

    assert missing.status_code == 400
    assert missing.json()["detail"] == "workspace_path is required for local workspace"
    assert nonexistent.status_code == 400
    assert (
        nonexistent.json()["detail"] == "workspace_path must be an existing directory"
    )
    assert a_file.status_code == 400


@pytest.mark.parametrize(
    ("git_url", "detail"),
    [
        (None, "git_url is required for git workspace"),
        ("   ", "git_url is required for git workspace"),
        ("ftp://example.com/repo.git", "git_url must be an HTTPS or git@... SSH URL"),
        (
            "https://user:pass@github.com/agentrove/app.git",
            "git_url must not contain embedded credentials",
        ),
    ],
)
async def test_create_workspace_rejects_invalid_git_url_without_cloning(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
    git_url: str | None,
    detail: str,
) -> None:
    headers = await login_headers(create_user, login, "git@example.com", "gituser")
    fake_clone = FakeGitClone()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_clone)

    response = await create_workspace(
        client, headers, source_type="git", git_url=git_url
    )

    assert response.status_code == 400
    assert response.json()["detail"] == detail
    assert fake_clone.calls == []


async def test_create_workspace_clones_github_https_repo_with_askpass_token(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    headers = await login_headers(
        create_user, login, "git-https@example.com", "githttps"
    )
    await set_github_token(db_session, "git-https@example.com", "super-secret-token")
    fake_clone = FakeGitClone()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_clone)

    response = await create_workspace(
        client,
        headers,
        source_type="git",
        git_url="https://github.com/agentrove/app.git",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["source_type"] == "git"
    assert body["source_url"] == "https://github.com/agentrove/app.git"
    assert Path(body["workspace_path"]).name.startswith("app-")
    [(args, env)] = fake_clone.calls
    assert "https://github.com/agentrove/app.git" in args
    assert all("super-secret-token" not in arg for arg in args)
    assert env is not None
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert fake_clone.askpass_answers == {
        "Username": "x-access-token",
        "Password": "super-secret-token",
    }
    assert not Path(env["GIT_ASKPASS"]).exists()


@pytest.mark.parametrize(
    "git_url",
    ["git@github.com:agentrove/app.git", "https://gitlab.com/agentrove/app.git"],
)
async def test_create_workspace_never_sends_github_token_to_other_transports(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
    git_url: str,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    headers = await login_headers(create_user, login, "git-other@example.com", "gito")
    await set_github_token(db_session, "git-other@example.com", "super-secret-token")
    fake_clone = FakeGitClone()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_clone)

    response = await create_workspace(
        client, headers, source_type="git", git_url=git_url
    )

    assert response.status_code == 201
    assert response.json()["source_url"] == git_url
    assert Path(response.json()["workspace_path"]).name.startswith("app-")
    [(_args, env)] = fake_clone.calls
    assert env is None


async def assert_no_clone_dirs_left(db_session: AsyncSession, email: str) -> None:
    user = await get_user_by_email(db_session, email)
    assert user is not None
    assert list(user_workspace_dir(str(user.id)).iterdir()) == []


async def test_create_workspace_git_clone_timeout_cleans_up(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await login_headers(
        create_user, login, "git-timeout@example.com", "gittimeout"
    )
    # The fake clone never finishes, so the deadline always wins.
    monkeypatch.setattr("app.services.workspace.GIT_CLONE_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", FakeGitClone(hang=True))

    response = await create_workspace(
        client,
        headers,
        source_type="git",
        git_url="https://github.com/agentrove/app.git",
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Git clone timed out"
    await assert_no_clone_dirs_left(db_session, "git-timeout@example.com")


async def test_create_workspace_git_clone_failure_masks_token_and_cleans_up(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    headers = await login_headers(
        create_user, login, "git-failure@example.com", "gitfailure"
    )
    await set_github_token(db_session, "git-failure@example.com", "leaky-token")
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        FakeGitClone(
            returncode=128, stderr=b"fatal: authentication failed for leaky-token\n"
        ),
    )

    response = await create_workspace(
        client,
        headers,
        source_type="git",
        git_url="https://github.com/agentrove/app.git",
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "fatal: authentication failed for ***"
    await assert_no_clone_dirs_left(db_session, "git-failure@example.com")
