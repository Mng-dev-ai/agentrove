import asyncio
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.services import workspace as workspace_module
from app.services.sandbox_providers.base import SandboxProvider

from tests.conftest import LoginClient, UserFactory
from tests.helpers import FakeProviderFactory, get_user_by_email, get_user_settings


pytestmark = pytest.mark.anyio


@pytest.fixture
def workspace_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())


class FakeGitProcess:
    def __init__(
        self, returncode: int, stdout: bytes, stderr: bytes, *, hang: bool = False
    ) -> None:
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr
        self._hang = hang

    async def communicate(self) -> tuple[bytes, bytes]:
        # `hang` simulates a clone that never finishes so the caller's
        # asyncio.wait_for(...) deadline (patched short in tests) fires first.
        if self._hang:
            await asyncio.sleep(1)
        return self._stdout, self._stderr

    def kill(self) -> None:
        return None

    async def wait(self) -> None:
        return None


class FakeGitClone:
    def __init__(
        self,
        *,
        returncode: int = 0,
        stderr: bytes = b"",
        hang: bool = False,
    ) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.hang = hang
        self.calls: list[tuple[tuple[str, ...], dict[str, str] | None]] = []

    async def __call__(
        self,
        *args: str,
        stdout: int,
        stderr: int,
        env: dict[str, str] | None = None,
    ) -> FakeGitProcess:
        self.calls.append((args, env))
        # Real `git clone` creates the target dir; mirror that so the rest of
        # create_workspace (which persists workspace_path) behaves realistically.
        Path(args[-1]).mkdir(parents=True, exist_ok=True)
        return FakeGitProcess(self.returncode, b"", self.stderr, hang=self.hang)


async def create_authenticated_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    *,
    email: str = "workspace@example.com",
    username: str = "workspaceuser",
    name: str = "Test Workspace",
) -> tuple[dict[str, str], dict[str, Any]]:
    await create_user(email=email, username=username)
    tokens = await login(email=email)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    response = await client.post(
        "/api/v1/workspaces",
        json={"name": name, "source_type": "empty", "sandbox_provider": "host"},
        headers=headers,
    )

    assert response.status_code == 201
    return headers, response.json()


async def test_create_workspace_persists_empty_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    user = await create_user(email="create-workspace@example.com", username="createws")
    tokens = await login(email="create-workspace@example.com")

    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "New Workspace",
            "source_type": "empty",
            "sandbox_provider": "host",
        },
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "New Workspace"
    assert body["user_id"] == str(user.id)
    assert body["sandbox_id"] == "sandbox-1"
    assert body["sandbox_provider"] == "host"
    assert body["source_type"] == "empty"
    assert body["source_url"] is None
    assert Path(body["workspace_path"]).is_dir()


async def test_list_get_and_update_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    headers, workspace = await create_authenticated_workspace(
        client, create_user, login, name="Original Name"
    )
    workspace_id = workspace["id"]

    list_response = await client.get("/api/v1/workspaces", headers=headers)
    get_response = await client.get(
        f"/api/v1/workspaces/{workspace_id}", headers=headers
    )
    update_response = await client.patch(
        f"/api/v1/workspaces/{workspace_id}",
        json={"name": "Renamed Workspace"},
        headers=headers,
    )

    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == workspace_id
    assert listed["items"][0]["chat_count"] == 0
    assert listed["items"][0]["last_chat_at"] is None
    assert get_response.status_code == 200
    assert get_response.json()["id"] == workspace_id
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Renamed Workspace"


async def test_workspace_resources_returns_owner_resources(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    owner_headers, workspace = await create_authenticated_workspace(
        client,
        create_user,
        login,
        email="resources-owner@example.com",
        username="resourcesowner",
    )
    await create_user(email="resources-other@example.com", username="resourcesother")
    other_tokens = await login(email="resources-other@example.com")
    other_headers = {"Authorization": f"Bearer {other_tokens['access_token']}"}
    workspace_id = workspace["id"]

    owner_response = await client.get(
        f"/api/v1/workspaces/{workspace_id}/resources", headers=owner_headers
    )
    other_response = await client.get(
        f"/api/v1/workspaces/{workspace_id}/resources", headers=other_headers
    )

    assert owner_response.status_code == 200
    body = owner_response.json()
    assert isinstance(body["skills"], list)
    assert set(body["builtin_slash_commands"]) >= {"claude", "codex"}
    assert other_response.status_code == 404


async def test_workspace_access_is_limited_to_owner(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    owner_headers, workspace = await create_authenticated_workspace(
        client,
        create_user,
        login,
        email="owner@example.com",
        username="owneruser",
    )
    await create_user(email="other@example.com", username="otheruser")
    other_tokens = await login(email="other@example.com")
    other_headers = {"Authorization": f"Bearer {other_tokens['access_token']}"}
    workspace_id = workspace["id"]

    other_list = await client.get("/api/v1/workspaces", headers=other_headers)
    other_get = await client.get(
        f"/api/v1/workspaces/{workspace_id}", headers=other_headers
    )
    owner_get = await client.get(
        f"/api/v1/workspaces/{workspace_id}", headers=owner_headers
    )

    assert other_list.status_code == 200
    assert other_list.json()["items"] == []
    assert other_get.status_code == 404
    assert owner_get.status_code == 200


async def test_delete_workspace_soft_deletes_it(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    headers, workspace = await create_authenticated_workspace(
        client, create_user, login
    )
    workspace_id = workspace["id"]

    response = await client.delete(
        f"/api/v1/workspaces/{workspace_id}", headers=headers
    )
    list_response = await client.get("/api/v1/workspaces", headers=headers)
    get_response = await client.get(
        f"/api/v1/workspaces/{workspace_id}", headers=headers
    )

    assert response.status_code == 204
    assert list_response.status_code == 200
    assert list_response.json()["items"] == []
    assert get_response.status_code == 404


async def test_create_workspace_rejects_invalid_git_payload(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    await create_user(email="git-workspace@example.com", username="gitworkspace")
    tokens = await login(email="git-workspace@example.com")

    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Git Workspace",
            "source_type": "git",
            "sandbox_provider": "host",
        },
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "git_url is required for git workspace"


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


async def test_create_workspace_from_local_path_succeeds(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
    tmp_path: Path,
) -> None:
    await create_user(email="local-workspace@example.com", username="localworkspace")
    tokens = await login(email="local-workspace@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Local Workspace",
            "source_type": "local",
            "workspace_path": str(tmp_path),
            "sandbox_provider": "host",
        },
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["source_type"] == "local"
    assert body["source_url"] is None
    assert body["workspace_path"] == str(tmp_path.resolve())


async def test_create_workspace_local_rejects_missing_and_nonexistent_path(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
    tmp_path: Path,
) -> None:
    await create_user(email="local-invalid@example.com", username="localinvalid")
    tokens = await login(email="local-invalid@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    missing_response = await client.post(
        "/api/v1/workspaces",
        json={"name": "No Path", "source_type": "local", "sandbox_provider": "host"},
        headers=headers,
    )
    nonexistent_response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Bad Path",
            "source_type": "local",
            "workspace_path": str(tmp_path / "does-not-exist"),
            "sandbox_provider": "host",
        },
        headers=headers,
    )

    assert missing_response.status_code == 400
    assert (
        missing_response.json()["detail"]
        == "workspace_path is required for local workspace"
    )
    assert nonexistent_response.status_code == 400
    assert (
        nonexistent_response.json()["detail"]
        == "workspace_path must be an existing directory"
    )


async def test_create_workspace_clones_https_repo_with_github_token(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Desktop mode ignores the stored PAT and uses host git credentials instead —
    # force server mode so this test exercises the GIT_ASKPASS token path
    # regardless of the DESKTOP_MODE value inherited from the host shell.
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    await create_user(email="git-https@example.com", username="githttps")
    tokens = await login(email="git-https@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    user = await get_user_by_email(db_session, "git-https@example.com")
    assert user is not None
    user_settings = await get_user_settings(db_session, user.id)
    assert user_settings is not None
    user_settings.github_personal_access_token = "super-secret-token"
    await db_session.commit()

    fake_clone = FakeGitClone()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_clone)

    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Https Clone",
            "source_type": "git",
            "git_url": "https://github.com/agentrove/app.git",
            "sandbox_provider": "host",
        },
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["source_type"] == "git"
    assert body["source_url"] == "https://github.com/agentrove/app.git"
    assert Path(body["workspace_path"]).name.startswith("app-")

    assert len(fake_clone.calls) == 1
    args, env = fake_clone.calls[0]
    assert args[:6] == (
        "git",
        "clone",
        "--depth",
        "1",
        "--no-single-branch",
        "https://github.com/agentrove/app.git",
    )
    assert env is not None
    assert env["GIT_PASSWORD"] == "super-secret-token"
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    askpass_path = env["GIT_ASKPASS"]
    # The askpass helper script is a one-shot temp file — cleaned up in the
    # `finally` block once the clone finishes.
    assert not Path(askpass_path).exists()


async def test_create_workspace_clones_ssh_repo_without_token(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await create_user(email="git-ssh@example.com", username="gitssh")
    tokens = await login(email="git-ssh@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    fake_clone = FakeGitClone()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_clone)

    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Ssh Clone",
            "source_type": "git",
            "git_url": "git@github.com:agentrove/app.git",
            "sandbox_provider": "host",
        },
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["source_url"] == "git@github.com:agentrove/app.git"
    assert Path(body["workspace_path"]).name.startswith("app-")
    _args, env = fake_clone.calls[0]
    assert env is None


async def test_create_workspace_git_clone_timeout_returns_400(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await create_user(email="git-timeout@example.com", username="gittimeout")
    tokens = await login(email="git-timeout@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    monkeypatch.setattr(workspace_module, "GIT_CLONE_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", FakeGitClone(hang=True))

    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Timeout Clone",
            "source_type": "git",
            "git_url": "https://github.com/agentrove/app.git",
            "sandbox_provider": "host",
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Git clone timed out"


async def test_create_workspace_git_clone_failure_masks_token_in_error(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    await create_user(email="git-failure@example.com", username="gitfailure")
    tokens = await login(email="git-failure@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    user = await get_user_by_email(db_session, "git-failure@example.com")
    assert user is not None
    user_settings = await get_user_settings(db_session, user.id)
    assert user_settings is not None
    user_settings.github_personal_access_token = "leaky-token"
    await db_session.commit()

    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        FakeGitClone(
            returncode=128,
            stderr=b"fatal: authentication failed for leaky-token\n",
        ),
    )

    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Failed Clone",
            "source_type": "git",
            "git_url": "https://github.com/agentrove/app.git",
            "sandbox_provider": "host",
        },
        headers=headers,
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "leaky-token" not in detail
    assert "***" in detail


async def test_create_workspace_rejects_invalid_git_url_shapes(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    await create_user(email="git-invalid@example.com", username="gitinvalid")
    tokens = await login(email="git-invalid@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    blank_response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Blank Url",
            "source_type": "git",
            "git_url": "   ",
            "sandbox_provider": "host",
        },
        headers=headers,
    )
    non_https_response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Ftp Url",
            "source_type": "git",
            "git_url": "ftp://example.com/repo.git",
            "sandbox_provider": "host",
        },
        headers=headers,
    )
    embedded_creds_response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Creds Url",
            "source_type": "git",
            "git_url": "https://user:pass@github.com/agentrove/app.git",
            "sandbox_provider": "host",
        },
        headers=headers,
    )

    assert blank_response.status_code == 400
    assert blank_response.json()["detail"] == "git_url is required for git workspace"
    assert non_https_response.status_code == 400
    assert (
        non_https_response.json()["detail"]
        == "git_url must be an HTTPS or git@... SSH URL"
    )
    assert embedded_creds_response.status_code == 400
    assert (
        embedded_creds_response.json()["detail"]
        == "git_url must not contain embedded credentials"
    )


async def test_delete_workspace_soft_deletes_its_chats_and_messages(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    headers, workspace = await create_authenticated_workspace(
        client,
        create_user,
        login,
        email="delete-with-chats@example.com",
        username="deletewithchats",
    )
    user = await get_user_by_email(db_session, "delete-with-chats@example.com")
    assert user is not None
    workspace_id = workspace["id"]

    chat = Chat(title="Doomed Chat", user_id=user.id, workspace_id=UUID(workspace_id))
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
    await db_session.refresh(chat)
    await db_session.refresh(message)

    response = await client.delete(
        f"/api/v1/workspaces/{workspace_id}", headers=headers
    )

    assert response.status_code == 204
    await db_session.refresh(chat)
    await db_session.refresh(message)
    assert chat.deleted_at is not None
    assert message.deleted_at is not None


async def test_update_workspace_rejects_missing_or_foreign_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    owner_headers, workspace = await create_authenticated_workspace(
        client,
        create_user,
        login,
        email="update-owner@example.com",
        username="updateowner",
    )
    await create_user(email="update-other@example.com", username="updateother")
    other_tokens = await login(email="update-other@example.com")
    other_headers = {"Authorization": f"Bearer {other_tokens['access_token']}"}
    missing_id = UUID("00000000-0000-0000-0000-000000000002")

    missing_response = await client.patch(
        f"/api/v1/workspaces/{missing_id}",
        json={"name": "New Name"},
        headers=owner_headers,
    )
    foreign_response = await client.patch(
        f"/api/v1/workspaces/{workspace['id']}",
        json={"name": "New Name"},
        headers=other_headers,
    )

    assert missing_response.status_code == 404
    assert foreign_response.status_code == 404


async def test_delete_workspace_rejects_missing_or_foreign_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    owner_headers, workspace = await create_authenticated_workspace(
        client,
        create_user,
        login,
        email="delete-owner@example.com",
        username="deleteowner",
    )
    await create_user(email="delete-other@example.com", username="deleteother")
    other_tokens = await login(email="delete-other@example.com")
    other_headers = {"Authorization": f"Bearer {other_tokens['access_token']}"}
    missing_id = UUID("00000000-0000-0000-0000-000000000003")

    missing_response = await client.delete(
        f"/api/v1/workspaces/{missing_id}", headers=owner_headers
    )
    foreign_response = await client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=other_headers
    )

    assert missing_response.status_code == 404
    assert foreign_response.status_code == 404
