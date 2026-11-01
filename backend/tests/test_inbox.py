from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.push import PushDelivery, PushDevice
from app.models.db_models.user import UserSettings
from app.services import push as push_module
from app.services.push import PushService

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace, create_chat_row


pytestmark = pytest.mark.anyio

DEVICE_TOKEN = "abc123"


class FakeApns:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status_code = 200
        self.reason = ""
        self.network_error = False

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.network_error:
            raise httpx.ConnectError("unreachable", request=request)
        if self.status_code == 200:
            return httpx.Response(200)
        return httpx.Response(self.status_code, json={"reason": self.reason})

    def client(self, **_kwargs: Any) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handle))


@pytest.fixture
def apns(monkeypatch: pytest.MonkeyPatch) -> FakeApns:
    key = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    monkeypatch.setattr(push_module.settings, "APNS_KEY", key.decode())
    monkeypatch.setattr(push_module.settings, "APNS_KEY_ID", "KEYID")
    monkeypatch.setattr(push_module.settings, "APNS_TEAM_ID", "TEAMID")
    monkeypatch.setattr(PushService, "_provider_token", None)
    fake = FakeApns()
    monkeypatch.setattr(
        push_module,
        "httpx",
        SimpleNamespace(AsyncClient=fake.client, HTTPError=httpx.HTTPError),
    )
    return fake


async def post_message(
    client: AsyncClient, headers: dict[str, str], chat_id: UUID, title: str = "Hi"
) -> Response:
    return await client.post(
        "/api/v1/inbox/messages",
        json={"chat_id": str(chat_id), "title": title, "body": "Body"},
        headers=headers,
    )


async def register_device(
    client: AsyncClient,
    headers: dict[str, str],
    token: str = DEVICE_TOKEN,
    sandbox: bool = True,
) -> None:
    response = await client.post(
        "/api/v1/push/devices",
        json={"token": token, "sandbox": sandbox},
        headers=headers,
    )
    assert response.status_code == 204


async def deliveries(db_session: AsyncSession) -> list[PushDelivery]:
    result = await db_session.scalars(
        select(PushDelivery).execution_options(populate_existing=True)
    )
    return list(result.all())


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


async def test_push_device_follows_the_latest_account_and_unregister_is_scoped(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    apns: FakeApns,
) -> None:
    first_headers, first, first_ws = await create_authenticated_workspace(
        db_session, create_user, login
    )
    second_headers, second, _ws = await create_authenticated_workspace(
        db_session, create_user, login, email="s@example.com", username="second"
    )
    chat = await create_chat_row(db_session, first, first_ws)
    await register_device(client, first_headers)
    await post_message(client, first_headers, chat.id)
    assert len(await deliveries(db_session)) == 1

    await register_device(client, second_headers, sandbox=False)

    assert await deliveries(db_session) == []
    device = await db_session.scalar(
        select(PushDevice).execution_options(populate_existing=True)
    )
    assert device is not None
    assert (device.user_id, device.sandbox) == (second.id, False)
    stale = await client.delete(
        f"/api/v1/push/devices/{DEVICE_TOKEN}", headers=first_headers
    )
    assert stale.status_code == 204
    assert await db_session.scalar(select(PushDevice.user_id)) == second.id
    removed = await client.delete(
        f"/api/v1/push/devices/{DEVICE_TOKEN}", headers=second_headers
    )
    assert removed.status_code == 204
    assert await db_session.scalar(select(PushDevice.id)) is None


async def test_disabled_notifications_suppress_queued_and_new_pushes(
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
    await post_message(client, headers, chat.id, "Queued")
    await db_session.execute(
        update(UserSettings)
        .where(UserSettings.user_id == user.id)
        .values(notifications_enabled=False)
    )
    await db_session.commit()

    assert await PushService().send_due() == {"sent": 0}
    await post_message(client, headers, chat.id, "Suppressed")

    assert apns.requests == []
    [delivery] = await deliveries(db_session)
    assert delivery.title == "Queued"
    assert delivery.finished_at is not None


@pytest.mark.parametrize(
    ("status_code", "reason", "network_error", "outcome"),
    [
        (410, "Unregistered", False, "device-removed"),
        (400, "BadDeviceToken", False, "device-removed"),
        (503, "", False, "retry"),
        (0, "", True, "retry"),
        (400, "PayloadTooLarge", False, "dropped"),
    ],
    ids=["gone", "bad-token", "server-error", "network-error", "rejected"],
)
async def test_apns_failures_remove_dead_tokens_or_retry_transient_errors(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    apns: FakeApns,
    status_code: int,
    reason: str,
    network_error: bool,
    outcome: str,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    await register_device(client, headers)
    await post_message(client, headers, chat.id)
    apns.status_code, apns.reason = status_code, reason
    apns.network_error = network_error

    assert await PushService().send_due() == {"sent": 0}

    assert len(apns.requests) == 1
    device = await db_session.scalar(select(PushDevice.id))
    rows = await deliveries(db_session)
    if outcome == "device-removed":
        assert device is None
        assert rows == []
        return
    assert device is not None
    [delivery] = rows
    assert delivery.attempts == 1
    if outcome == "retry":
        assert delivery.finished_at is None
        assert delivery.next_attempt_at > datetime.now(timezone.utc)
    else:
        assert delivery.finished_at is not None
    assert await PushService().send_due() == {}
    assert len(apns.requests) == 1
