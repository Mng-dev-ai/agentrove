from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.chat import Chat
from app.services.push import PushService

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace


pytestmark = pytest.mark.anyio


@pytest.fixture
def enqueue(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    mock = AsyncMock()
    monkeypatch.setattr(PushService, "enqueue", mock)
    return mock


async def create_chat(
    db_session: AsyncSession, user_id: UUID, workspace_id: UUID
) -> Chat:
    chat = Chat(title="Chat", user_id=user_id, workspace_id=workspace_id)
    db_session.add(chat)
    await db_session.commit()
    await db_session.refresh(chat)
    return chat


async def post_message(
    client: AsyncClient, headers: dict[str, str], chat_id: UUID, title: str = "Hi"
) -> Response:
    return await client.post(
        "/api/v1/inbox/messages",
        json={"chat_id": str(chat_id), "title": title, "body": "Body"},
        headers=headers,
    )


async def test_create_message_enqueues_push(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    enqueue: AsyncMock,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat(db_session, user.id, workspace.id)

    response = await post_message(client, headers, chat.id)

    assert response.status_code == 201
    item_id = response.json()["id"]
    enqueue.assert_awaited_once_with(
        user_id=user.id,
        event_key=f"inbox:{item_id}",
        title="Hi",
        body="Body",
        path=f"/chat/{chat.id}",
        collapse_id=f"inbox:{item_id}",
        ttl_seconds=3600,
    )


async def test_create_message_rejects_foreign_chat(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    enqueue: AsyncMock,
) -> None:
    _owner_headers, owner, owner_workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="o@example.com", username="owner"
    )
    intruder_headers, _intruder, _ws = await create_authenticated_workspace(
        db_session, create_user, login, email="i@example.com", username="intruder"
    )
    chat = await create_chat(db_session, owner.id, owner_workspace.id)

    response = await post_message(client, intruder_headers, chat.id)

    assert response.status_code == 404
    enqueue.assert_not_awaited()


async def test_list_mark_read_and_read_all(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    enqueue: AsyncMock,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_headers, _other, _ws = await create_authenticated_workspace(
        db_session, create_user, login, email="o@example.com", username="other"
    )
    chat = await create_chat(db_session, user.id, workspace.id)
    first = (await post_message(client, headers, chat.id, "First")).json()
    await post_message(client, headers, chat.id, "Second")
    await post_message(client, headers, chat.id, "Third")

    listed = (await client.get("/api/v1/inbox", headers=headers)).json()
    assert [i["title"] for i in listed["items"]] == ["Third", "Second", "First"]
    assert listed["unread_count"] == 3

    foreign = await client.post(
        f"/api/v1/inbox/{first['id']}/read", headers=other_headers
    )
    missing = await client.post(f"/api/v1/inbox/{uuid4()}/read", headers=headers)
    assert foreign.status_code == 404
    assert missing.status_code == 404

    read = await client.post(f"/api/v1/inbox/{first['id']}/read", headers=headers)
    assert read.status_code == 200
    assert read.json()["read_at"] is not None
    listed = (await client.get("/api/v1/inbox", headers=headers)).json()
    assert listed["unread_count"] == 2

    all_read = await client.post("/api/v1/inbox/read-all", headers=headers)
    assert all_read.status_code == 204
    listed = (await client.get("/api/v1/inbox", headers=headers)).json()
    assert listed["unread_count"] == 0
    assert (await client.get("/api/v1/inbox", headers=other_headers)).json() == {
        "items": [],
        "next_cursor": None,
        "has_more": False,
        "unread_count": 0,
    }
