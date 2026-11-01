from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.chat import Chat
from app.models.db_models.workspace import Workspace

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace


pytestmark = pytest.mark.anyio


async def create_memory(
    client: AsyncClient, headers: dict[str, str], **body: Any
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/memories", json={"content": "Content", **body}, headers=headers
    )
    assert response.status_code == 201
    return dict(response.json())


async def list_titles(
    client: AsyncClient, headers: dict[str, str], **params: str
) -> list[str]:
    response = await client.get("/api/v1/memories", params=params, headers=headers)
    assert response.status_code == 200
    return [m["title"] for m in response.json()]


async def test_scope_filtering_search_and_scope_updates(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_workspace = Workspace(
        name="Other",
        user_id=user.id,
        sandbox_id="sandbox-other",
        sandbox_provider="host",
        workspace_path="/tmp/agentrove-test-other",
        source_type="empty",
    )
    db_session.add(other_workspace)
    await db_session.commit()

    global_memory = await create_memory(
        client, headers, title="Prefers pnpm", content="Use pnpm 100% of the time"
    )
    scoped = await create_memory(
        client,
        headers,
        title="Tabs here",
        content="Indent with tabs",
        workspace_id=str(workspace.id),
    )
    await create_memory(
        client, headers, title="Elsewhere", workspace_id=str(other_workspace.id)
    )
    assert global_memory["workspace_id"] is None
    assert scoped["workspace_id"] == str(workspace.id)

    assert await list_titles(client, headers, workspace_id=str(workspace.id)) == [
        "Tabs here",
        "Prefers pnpm",
    ]
    assert len(await list_titles(client, headers)) == 3
    assert await list_titles(client, headers, query="PNPM 100%") == ["Prefers pnpm"]
    assert await list_titles(client, headers, query="pnpm tabs") == []
    assert await list_titles(client, headers, query="10_") == []

    pinned = await client.patch(
        f"/api/v1/memories/{scoped['id']}", json={"pinned": True}, headers=headers
    )
    assert pinned.status_code == 200
    assert pinned.json()["workspace_id"] == str(workspace.id)

    made_global = await client.patch(
        f"/api/v1/memories/{scoped['id']}", json={"workspace_id": None}, headers=headers
    )
    assert made_global.status_code == 200
    assert made_global.json()["workspace_id"] is None
    assert made_global.json()["pinned"] is True


async def test_foreign_workspace_chat_and_memory_are_not_found(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_headers, other, other_workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="o@example.com", username="other"
    )
    other_chat = Chat(title="Chat", user_id=other.id, workspace_id=other_workspace.id)
    db_session.add(other_chat)
    await db_session.commit()
    mine = await create_memory(client, headers, title="Mine")

    for body in (
        {"workspace_id": str(other_workspace.id)},
        {"chat_id": str(other_chat.id)},
    ):
        response = await client.post(
            "/api/v1/memories",
            json={"title": "x", "content": "y", **body},
            headers=headers,
        )
        assert response.status_code == 404

    memory_id = mine["id"]
    patched = await client.patch(
        f"/api/v1/memories/{memory_id}", json={"pinned": True}, headers=other_headers
    )
    deleted = await client.delete(
        f"/api/v1/memories/{memory_id}", headers=other_headers
    )
    assert patched.status_code == 404
    assert deleted.status_code == 404
    assert await list_titles(client, headers) == ["Mine"]
