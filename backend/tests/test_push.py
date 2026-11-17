from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.push import PushDevice
from app.models.db_models.user import UserSettings
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

CHANNEL_ID = UUID(int=1)

PERMISSIONS = {"perm:perm", "perm:plan"}

QUESTIONS = {"perm:ask", "ask:elicit", "ask:chat-elicit"}

COMPLETIONS = {"c:complete", f"{CHANNEL_ID}:complete"}

INBOX = "inbox"

EVERY_EVENT = PERMISSIONS | QUESTIONS | COMPLETIONS | {INBOX}

SUB_THREAD_EVENTS = {
    "perm:perm",
    "perm:plan",
    "perm:ask",
    "ask:chat-elicit",
    "c:complete",
}


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


async def enqueue_every_event(user_id: UUID, *, sub_thread: bool) -> None:
    push = PushService()
    for request_id, tool_name in [
        ("perm", "Bash"),
        ("plan", "ExitPlanMode"),
        ("ask", "AskUserQuestion"),
    ]:
        await push.notify_permission(
            user_id=user_id,
            path="/chat/c",
            request_id=request_id,
            tool_name=tool_name,
            sub_thread=sub_thread,
        )
    await push.notify_question(
        user_id=user_id,
        path="/channels/x",
        request_id="elicit",
        title="#x",
        body="?",
        sub_thread=False,
    )
    await push.notify_question(
        user_id=user_id,
        path="/chat/c",
        request_id="chat-elicit",
        title="Question for you",
        body="Which branch?",
        sub_thread=sub_thread,
    )
    await push.notify_completion(
        user_id=user_id,
        chat_id="c",
        message_id="m",
        failed=False,
        reply="Done",
        sub_thread=sub_thread,
    )
    await push.notify_channel_completion(
        user_id=user_id,
        channel_id=CHANNEL_ID,
        message_id=uuid4(),
        title="#x",
        body="Done",
    )


@pytest.mark.parametrize(
    ("setting", "sub_thread", "suppressed"),
    [
        (None, True, set()),
        ("notify_permission_requests", False, PERMISSIONS),
        ("notify_questions", False, QUESTIONS),
        ("notify_completions", False, COMPLETIONS),
        ("notify_inbox_messages", True, {INBOX}),
        ("notifications_enabled", True, EVERY_EVENT),
        ("notify_sub_threads", True, SUB_THREAD_EVENTS),
        ("notify_sub_threads", False, set()),
    ],
    ids=[
        "all-on",
        "permissions-off",
        "questions-off",
        "completions-off",
        "inbox-off",
        "master-off",
        "sub-threads-off",
        "sub-threads-off-top-level",
    ],
)
async def test_per_event_settings_gate_push_enqueue(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    apns: FakeApns,
    setting: str | None,
    sub_thread: bool,
    suppressed: set[str],
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    await register_device(client, headers)
    if setting is not None:
        await db_session.execute(
            update(UserSettings)
            .where(UserSettings.user_id == user.id)
            .values({setting: False})
        )
        await db_session.commit()

    await enqueue_every_event(user.id, sub_thread=sub_thread)
    inbox = (await post_message(client, headers, chat.id)).json()

    queued = {
        delivery.collapse_id: delivery for delivery in await deliveries(db_session)
    }
    assert set(queued) == {
        f"inbox:{inbox['id']}" if key == INBOX else key
        for key in EVERY_EVENT - suppressed
    }
    if "perm:ask" in queued:
        assert queued["perm:ask"].title == "Question for you"


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
