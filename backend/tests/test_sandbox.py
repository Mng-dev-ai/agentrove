import io
import zipfile

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.sandbox_providers.base import SandboxProvider

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    FakeProviderFactory,
    FakeSandboxProvider,
    create_authenticated_workspace,
)


pytestmark = pytest.mark.anyio


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


async def test_secret_endpoints_update_user_settings(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    initial_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/secrets",
        headers=headers,
    )
    add_response = await client.post(
        f"/api/v1/sandbox/{workspace.sandbox_id}/secrets",
        json={"key": "API_TOKEN", "value": "one"},
        headers=headers,
    )
    update_response = await client.put(
        f"/api/v1/sandbox/{workspace.sandbox_id}/secrets/API_TOKEN",
        json={"value": "two"},
        headers=headers,
    )
    append_response = await client.put(
        f"/api/v1/sandbox/{workspace.sandbox_id}/secrets/SECOND_TOKEN",
        json={"value": "three"},
        headers=headers,
    )
    list_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/secrets",
        headers=headers,
    )
    delete_response = await client.delete(
        f"/api/v1/sandbox/{workspace.sandbox_id}/secrets/API_TOKEN",
        headers=headers,
    )
    final_response = await client.get(
        f"/api/v1/sandbox/{workspace.sandbox_id}/secrets",
        headers=headers,
    )

    assert initial_response.status_code == 200
    assert initial_response.json() == {"secrets": []}
    assert add_response.status_code == 200
    assert add_response.json()["message"] == "Secret API_TOKEN added successfully"
    assert update_response.status_code == 200
    assert update_response.json()["message"] == "Secret API_TOKEN updated successfully"
    assert append_response.status_code == 200
    assert list_response.status_code == 200
    assert list_response.json() == {
        "secrets": [
            {"key": "API_TOKEN", "value": "two"},
            {"key": "SECOND_TOKEN", "value": "three"},
        ]
    }
    assert delete_response.status_code == 200
    assert delete_response.json()["message"] == "Secret API_TOKEN deleted successfully"
    assert final_response.status_code == 200
    assert final_response.json() == {
        "secrets": [{"key": "SECOND_TOKEN", "value": "three"}]
    }


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
        f"/api/v1/sandbox/{sandbox_id}/git/diff"
        "?mode=staged&full_context=true&cwd=packages/api",
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
    assert any("git diff -U99999 --cached" in command for command in commands)
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
