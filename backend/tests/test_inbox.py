from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_mcp_access_token
from app.models.db_models.channel import Channel
from app.services.push import PushService

from tests.conftest import FakeApns, LoginClient, UserFactory
from tests.helpers import (
    DEVICE_TOKEN,
    create_authenticated_workspace,
    create_chat_row,
    deliveries,
    post_message,
    register_device,
)

pytestmark = pytest.mark.anyio


async def test_inbox_message_is_pushed_to_registered_device(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    apns: FakeApns,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    await register_device(client, headers)

    response = await post_message(client, headers, chat.id)

    assert response.status_code == 201
    assert response.json()["chat_id"] == str(chat.id)
    assert await PushService().send_due() == {"sent": 1}
    [request] = apns.requests
    assert str(request.url) == (
        f"https://api.sandbox.push.apple.com/3/device/{DEVICE_TOKEN}"
    )
    assert request.headers["apns-collapse-id"] == f"inbox:{response.json()['id']}"
    payload = request.read()
    assert b'"title":"Hi"' in payload
    assert f'"path":"/chat/{chat.id}"'.encode() in payload
    [delivery] = await deliveries(db_session)
    assert delivery.finished_at is not None
    assert await PushService().send_due() == {}
    assert len(apns.requests) == 1


async def test_create_message_rejects_foreign_chat(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    apns: FakeApns,
) -> None:
    _owner_headers, owner, owner_workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="o@example.com", username="owner"
    )
    intruder_headers, _intruder, _ws = await create_authenticated_workspace(
        db_session, create_user, login, email="i@example.com", username="intruder"
    )
    chat = await create_chat_row(db_session, owner, owner_workspace)
    await register_device(client, intruder_headers)

    response = await post_message(client, intruder_headers, chat.id)

    assert response.status_code == 404
    assert await deliveries(db_session) == []


async def test_list_mark_read_read_all_and_clear_read(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_headers, _other, _ws = await create_authenticated_workspace(
        db_session, create_user, login, email="o@example.com", username="other"
    )
    chat = await create_chat_row(db_session, user, workspace)
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

    assert (
        await client.delete("/api/v1/inbox/read", headers=other_headers)
    ).status_code == 204
    cleared = await client.delete("/api/v1/inbox/read", headers=headers)
    assert cleared.status_code == 204
    listed = (await client.get("/api/v1/inbox", headers=headers)).json()
    assert [i["title"] for i in listed["items"]] == ["Third", "Second"]

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


async def test_inbox_pagination_walks_all_items_and_rejects_bad_cursor(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    for title in ("One", "Two", "Three"):
        await post_message(client, headers, chat.id, title)

    first = (await client.get("/api/v1/inbox?limit=2", headers=headers)).json()
    assert [i["title"] for i in first["items"]] == ["Three", "Two"]
    assert first["has_more"] is True
    second = (
        await client.get(
            "/api/v1/inbox",
            params={"limit": 2, "cursor": first["next_cursor"]},
            headers=headers,
        )
    ).json()
    assert [i["title"] for i in second["items"]] == ["One"]
    assert second["has_more"] is False
    assert second["next_cursor"] is None
    assert second["unread_count"] == 3

    bad = await client.get("/api/v1/inbox?cursor=garbage", headers=headers)
    assert bad.status_code == 400


async def test_create_message_rejects_channel_member_chat(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    apns: FakeApns,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    channel = Channel(user_id=user.id, workspace_id=workspace.id, name="Review")
    db_session.add(channel)
    await db_session.flush()
    member_chat = await create_chat_row(db_session, user, workspace)
    member_chat.channel_id = channel.id
    await db_session.commit()
    await register_device(client, headers)
    agent_headers = {
        "Authorization": "Bearer "
        + create_mcp_access_token(str(user.id), user.hashed_password, frozenset())
    }

    response = await post_message(client, agent_headers, member_chat.id)

    assert response.status_code == 404
    assert (await client.get("/api/v1/inbox", headers=headers)).json()["items"] == []
    assert await deliveries(db_session) == []


async def test_mark_unread_and_delete_item(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_headers, _other, _ws = await create_authenticated_workspace(
        db_session, create_user, login, email="o@example.com", username="other"
    )
    chat = await create_chat_row(db_session, user, workspace, title="Deploy chat")
    created = (await post_message(client, headers, chat.id, "First")).json()
    second = (await post_message(client, headers, chat.id, "Second")).json()
    assert created["chat_title"] == "Deploy chat"
    assert created["workspace_name"] == "Test Workspace"

    listed = (await client.get("/api/v1/inbox", headers=headers)).json()
    assert [(i["chat_title"], i["workspace_name"]) for i in listed["items"]] == [
        ("Deploy chat", "Test Workspace"),
        ("Deploy chat", "Test Workspace"),
    ]

    await client.post(f"/api/v1/inbox/{created['id']}/read", headers=headers)
    foreign_unread = await client.post(
        f"/api/v1/inbox/{created['id']}/unread", headers=other_headers
    )
    assert foreign_unread.status_code == 404
    unread = await client.post(f"/api/v1/inbox/{created['id']}/unread", headers=headers)
    assert unread.status_code == 200
    assert unread.json()["read_at"] is None
    assert unread.json()["chat_title"] == "Deploy chat"
    assert unread.json()["workspace_name"] == "Test Workspace"

    foreign_delete = await client.delete(
        f"/api/v1/inbox/{second['id']}", headers=other_headers
    )
    assert foreign_delete.status_code == 404
    deleted = await client.delete(f"/api/v1/inbox/{second['id']}", headers=headers)
    assert deleted.status_code == 204
    listed = (await client.get("/api/v1/inbox", headers=headers)).json()
    assert [i["title"] for i in listed["items"]] == ["First"]
    assert listed["unread_count"] == 1
    missing = await client.delete(f"/api/v1/inbox/{second['id']}", headers=headers)
    assert missing.status_code == 404
