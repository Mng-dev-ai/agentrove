from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_mcp_access_token
from app.models.db_models.channel import Channel
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
    client: AsyncClient, headers: dict[str, str], **params: str | list[str]
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
    assert await list_titles(client, headers, query="pnpm tabs") == [
        "Tabs here",
        "Prefers pnpm",
    ]
    assert await list_titles(client, headers, query="pnpm 100% TABS") == [
        "Prefers pnpm",
        "Tabs here",
    ]
    assert await list_titles(
        client, headers, workspace_id=str(workspace.id), query="tabs elsewhere"
    ) == ["Tabs here"]
    assert len(await list_titles(client, headers, query="tabs elsewhere")) == 2
    assert await list_titles(client, headers, query="pn_m") == []

    pinned = await client.patch(
        f"/api/v1/memories/{scoped['id']}", json={"pinned": True}, headers=headers
    )
    assert pinned.status_code == 200
    assert pinned.json()["workspace_id"] == str(workspace.id)
    assert await list_titles(client, headers, query="pnpm 100% tabs") == [
        "Prefers pnpm",
        "Tabs here",
    ]

    made_global = await client.patch(
        f"/api/v1/memories/{scoped['id']}", json={"workspace_id": None}, headers=headers
    )
    assert made_global.status_code == 200
    assert made_global.json()["workspace_id"] is None
    assert made_global.json()["pinned"] is True


async def test_search_ranks_rare_whole_words_and_reads_by_id(
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
    pinned = await create_memory(
        client,
        headers,
        title="Pinned note",
        content="agentrove runs format checks",
        pinned=True,
    )
    vite = await create_memory(
        client, headers, title="Vite config", content="agentrove vite-config for CI"
    )
    elsewhere = await create_memory(
        client, headers, title="Vite fixture", workspace_id=str(other_workspace.id)
    )
    in_workspace = {"workspace_id": str(workspace.id)}

    assert await list_titles(
        client, headers, **in_workspace, query="agentrove: vite-config"
    ) == ["Vite config"]
    assert await list_titles(client, headers, **in_workspace, query="agentrove") == [
        "Pinned note",
        "Vite config",
    ]
    assert await list_titles(client, headers, **in_workspace, query="for") == [
        "Vite config"
    ]
    assert await list_titles(client, headers, **in_workspace, query="CI") == [
        "Vite config"
    ]
    assert await list_titles(client, headers, **in_workspace, query="ci, format") == [
        "Pinned note",
        "Vite config",
    ]
    assert await list_titles(client, headers, **in_workspace, query="?!") == [
        "Pinned note",
        "Vite config",
    ]
    assert await list_titles(
        client,
        headers,
        **in_workspace,
        ids=[vite["id"], elsewhere["id"], pinned["id"]],
    ) == ["Pinned note", "Vite config"]
    assert await list_titles(client, headers, ids=[elsewhere["id"]]) == ["Vite fixture"]

    for title, content in (
        ("Sub-thread rules", "Children inherit the parent workspace"),
        ("Effort tiers", "Pick thinking_mode from list_models"),
        ("Seed data", "Seeded channels for demos"),
        ("Release notes", "Check the changelog"),
        ("Playwright setup", "Install chromium"),
        ("UI review", "Run browser checks with Playwright"),
    ):
        await create_memory(
            client, headers, title=title, content=content, **in_workspace
        )
    for query, titles in (
        ("sub thread", ["Sub-thread rules"]),
        ("thinking mode", ["Effort tiers"]),
        ("seeding channel", ["Seed data"]),
        (
            "browser check procedure",
            ["UI review", "Pinned note", "Release notes"],
        ),
        ("playwright", ["Playwright setup", "UI review"]),
    ):
        assert (
            await list_titles(client, headers, **in_workspace, query=query) == titles
        ), query


async def test_memory_content_is_limited_to_1200_characters(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    memory = await create_memory(client, headers, title="Long", content="x" * 1200)
    too_long = await client.post(
        "/api/v1/memories",
        json={"title": "Too long", "content": "x" * 1201},
        headers=headers,
    )
    patched = await client.patch(
        f"/api/v1/memories/{memory['id']}",
        json={"content": "x" * 1201},
        headers=headers,
    )
    assert too_long.status_code == 422
    assert patched.status_code == 422


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


async def test_prompt_block_lists_pinned_memories_then_a_title_index(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_workspace = await add_workspace(db_session, user.id, tmp_path)
    service = MemoryService()
    assert await service.build_prompt_block(user.id, workspace.id) is None

    unpinned = await create_memory(client, headers, title="Unpinned")
    assert await service.build_prompt_block(user.id, workspace.id) == (
        "<memory>\n"
        "Other memories (titles only; read one by id with read_memories, "
        "use search_memory for topics not listed here):\n"
        f"- {unpinned['id']} [global] Unpinned\n"
        "</memory>"
    )

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
    scoped_unpinned = await create_memory(
        client, headers, title="Scoped unpinned", workspace_id=str(workspace.id)
    )
    newer_global = await create_memory(client, headers, title="Newer global")
    for pinned in (True, False):
        await create_memory(
            client,
            headers,
            title="Elsewhere",
            pinned=pinned,
            workspace_id=str(other_workspace.id),
        )

    pinned_section = (
        "<memory>\n"
        "Pinned memories (full content):\n"
        f"- {scoped['id']} [workspace] Scoped: Tabs\n"
        f"- {global_memory['id']} [global] Global: Use pnpm\n"
        "Other memories (titles only; read one by id with read_memories, "
        "use search_memory for topics not listed here):\n"
        f"- {scoped_unpinned['id']} [workspace] Scoped unpinned\n"
    )
    assert await service.build_prompt_block(user.id, workspace.id) == (
        f"{pinned_section}- {newer_global['id']} [global] Newer global\n"
        f"- {unpinned['id']} [global] Unpinned\n</memory>"
    )
    monkeypatch.setattr("app.services.memory.MEMORY_INDEX_LIMIT", 1)
    assert await service.build_prompt_block(user.id, workspace.id) == (
        f"{pinned_section}...and 2 more; use search_memory to find them.\n</memory>"
    )


async def test_member_chat_memory_is_shared_within_its_workspace_without_a_source_link(
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
    other_headers, _other, _other_workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="o@example.com", username="other"
    )
    channel = Channel(user_id=user.id, workspace_id=workspace.id, name="Review")
    db_session.add(channel)
    await db_session.flush()
    member_chat = Chat(
        title="Member",
        user_id=user.id,
        workspace_id=workspace.id,
        channel_id=channel.id,
        last_model_id="m1",
    )
    db_session.add(member_chat)
    await db_session.commit()
    agent_headers = {
        "Authorization": "Bearer "
        + create_mcp_access_token(str(user.id), user.hashed_password, frozenset(), None)
    }

    for scope in (str(workspace.id), None):
        created = await create_memory(
            client,
            agent_headers,
            title=f"Member {scope or 'global'}",
            workspace_id=scope,
            chat_id=str(member_chat.id),
        )
        assert (created["source_chat_id"], created["source_model_id"]) == (None, "m1")
    updated = await client.patch(
        f"/api/v1/memories/{created['id']}",
        json={"content": "Revised", "chat_id": str(member_chat.id)},
        headers=agent_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["source_chat_id"] is None

    assert await list_titles(
        client, agent_headers, workspace_id=str(workspace.id), query="Member"
    ) == ["Member global", f"Member {workspace.id}"]
    assert await list_titles(
        client, headers, workspace_id=str(other_workspace.id), query="Member"
    ) == ["Member global"]
    assert await list_titles(client, other_headers, query="Member") == []
