from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.chat import Chat
from app.models.db_models.workspace import Workspace
from app.services.memory import MemoryService

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


async def add_workspace(
    db_session: AsyncSession, user_id: UUID, tmp_path: Path
) -> Workspace:
    workspace = Workspace(
        name="Other",
        user_id=user_id,
        sandbox_id="sandbox-other",
        sandbox_provider="host",
        workspace_path=str(tmp_path / "other"),
        source_type="empty",
    )
    db_session.add(workspace)
    await db_session.commit()
    return workspace


async def test_scope_filtering_search_and_scope_updates(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    tmp_path: Path,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_workspace = await add_workspace(db_session, user.id, tmp_path)

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
    for body in (
        {"workspace_id": str(other_workspace.id)},
        {"chat_id": str(other_chat.id)},
    ):
        response = await client.patch(
            f"/api/v1/memories/{memory_id}", json=body, headers=headers
        )
        assert response.status_code == 404
    patched = await client.patch(
        f"/api/v1/memories/{memory_id}", json={"pinned": True}, headers=other_headers
    )
    deleted = await client.delete(
        f"/api/v1/memories/{memory_id}", headers=other_headers
    )
    assert patched.status_code == 404
    assert deleted.status_code == 404
    assert await list_titles(client, headers) == ["Mine"]


async def test_memory_tracks_source_chat_and_owner_can_delete_it(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    first_chat = Chat(
        title="First", user_id=user.id, workspace_id=workspace.id, last_model_id="m1"
    )
    second_chat = Chat(
        title="Second", user_id=user.id, workspace_id=workspace.id, last_model_id="m2"
    )
    db_session.add_all([first_chat, second_chat])
    await db_session.commit()

    created = await create_memory(
        client, headers, title="Learned", chat_id=str(first_chat.id)
    )
    assert (created["source_chat_id"], created["source_model_id"]) == (
        str(first_chat.id),
        "m1",
    )
    updated = await client.patch(
        f"/api/v1/memories/{created['id']}",
        json={"content": "Revised", "chat_id": str(second_chat.id)},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["content"] == "Revised"
    assert (updated.json()["source_chat_id"], updated.json()["source_model_id"]) == (
        str(second_chat.id),
        "m2",
    )

    deleted = await client.delete(f"/api/v1/memories/{created['id']}", headers=headers)
    assert deleted.status_code == 204
    assert await list_titles(client, headers) == []


async def test_prompt_block_lists_pinned_workspace_then_global_memories(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    tmp_path: Path,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_workspace = await add_workspace(db_session, user.id, tmp_path)
    service = MemoryService()
    assert await service.build_prompt_block(user.id, workspace.id) is None

    global_memory = await create_memory(
        client, headers, title="Global", content="Use pnpm", pinned=True
    )
    scoped = await create_memory(
        client,
        headers,
        title="Scoped",
        content="Tabs",
        pinned=True,
        workspace_id=str(workspace.id),
    )
    await create_memory(client, headers, title="Unpinned")
    await create_memory(
        client,
        headers,
        title="Elsewhere",
        pinned=True,
        workspace_id=str(other_workspace.id),
    )

    assert await service.build_prompt_block(user.id, workspace.id) == (
        "<memory>\n"
        f"- {scoped['id']} [workspace] Scoped: Tabs\n"
        f"- {global_memory['id']} [global] Global: Use pnpm\n"
        "</memory>"
    )
