from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.services.sandbox_providers.base import SandboxProvider

from tests.conftest import LoginClient, SettingsOverride, UserFactory
from tests.helpers import FakeProviderFactory


pytestmark = pytest.mark.anyio


@pytest.fixture
def workspace_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())


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


async def test_desktop_local_session_workspace_access_is_user_scoped(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    settings_override: SettingsOverride,
    workspace_sandbox: None,
) -> None:
    settings_override(DESKTOP_MODE=True)
    desktop_session = await client.post("/api/v1/auth/desktop/local-session")
    assert desktop_session.status_code == 200
    desktop_session_body = desktop_session.json()
    desktop_headers = {"Authorization": f"Bearer {desktop_session_body['access_token']}"}

    create_response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Desktop Local Workspace",
            "source_type": "empty",
            "sandbox_provider": "host",
        },
        headers=desktop_headers,
    )
    assert create_response.status_code == 201

    await create_user(email="desktop-other@example.com", username="desktopother")
    other_tokens = await login(email="desktop-other@example.com")
    other_headers = {"Authorization": f"Bearer {other_tokens['access_token']}"}

    desktop_list = await client.get("/api/v1/workspaces", headers=desktop_headers)
    other_list = await client.get("/api/v1/workspaces", headers=other_headers)
    other_get = await client.get(
        f"/api/v1/workspaces/{create_response.json()['id']}",
        headers=other_headers,
    )

    assert desktop_list.status_code == 200
    assert desktop_list.json()["total"] == 1
    assert (
        desktop_list.json()["items"][0]["user_id"]
        == desktop_session_body["user"]["id"]
    )
    assert other_list.status_code == 200
    assert other_list.json()["items"] == []
    assert other_get.status_code == 404


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
