import asyncio
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import MODELS
from app.db.session import SessionLocal
from app.models.db_models.chat import Chat
from app.services.chat import ChatService
from app.services.exceptions import ChatException
from app.services.session_registry import session_registry
from app.services.streaming.runtime import ChatStreamRuntime
from app.services import subthread_wake as wake_module
from app.services.subthread_wake import SubThreadWake

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    RACE_WINDOW_SECONDS,
    CommitGate,
    create_authenticated_workspace,
    create_chat_row,
)

pytestmark = pytest.mark.anyio


@pytest.fixture
async def chats(
    db_session: AsyncSession, create_user: UserFactory, login: LoginClient
) -> tuple[Chat, list[Chat]]:
    _, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    parent = await create_chat_row(db_session, user, workspace, title="Parent")
    children = [
        await create_chat_row(db_session, user, workspace, title=f"Child {index}")
        for index in range(3)
    ]
    for chat in [parent, *children]:
        chat.last_model_id = next(iter(MODELS))
    for child in children:
        child.parent_chat_id = parent.id
    await db_session.commit()
    return parent, children


async def owe_report_in_own_session(chat_id: UUID, device_ids: frozenset[UUID]) -> None:
    async with SessionLocal() as db:
        await SubThreadWake.owe_report(db, chat_id, device_ids)
        await db.commit()


@pytest.fixture
async def wake(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[SubThreadWake]:
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 0)
    instance = SubThreadWake()
    try:
        yield instance
    finally:
        tasks = list(instance._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def test_fan_out_batches_into_one_wake(
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    initiate = AsyncMock()
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)

    for child in children:
        wake.on_chain_end(str(child.id), str(parent.id), frozenset())
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=2)

    initiate.assert_awaited_once()
    request, user = initiate.call_args.args
    assert request.chat_id == parent.id
    assert user.id == parent.user_id
    notice = initiate.call_args.kwargs["user_app_notice"]
    assert notice == "Finished sub-threads:\n" + "\n".join(
        f"- **[{child.title}](/chat/{child.id})** (unknown)" for child in children
    )
    assert wake._pending == {}
    assert wake._scheduled == set()


async def test_busy_child_is_held_and_chain_end_schedules_again(
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    busy, finished = children[:2]
    parent_id = str(parent.id)
    busy_id = str(busy.id)
    active = {busy_id}
    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", active.__contains__)
    initiate = AsyncMock()
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)

    wake.on_chain_end(busy_id, parent_id, frozenset())
    wake.on_chain_end(str(finished.id), parent_id, frozenset())
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=2)

    initiate.assert_awaited_once()
    assert initiate.call_args.kwargs["user_app_notice"] == (
        f"Finished sub-threads:\n- **[{finished.title}](/chat/{finished.id})** (unknown)"
    )
    assert busy_id not in initiate.call_args.args[0].prompt
    assert wake._pending == {parent_id: {busy_id: frozenset()}}
    assert wake._scheduled == set()

    active.clear()
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 3600)
    wake.on_chain_end(busy_id, None, frozenset())
    assert wake._scheduled == {parent_id}


async def test_failed_steer_and_conflicting_wake_requeue(
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    parent_id = str(parent.id)
    reports = {str(child.id): frozenset[UUID]() for child in children}
    active = {parent_id}
    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", active.__contains__)
    steer = AsyncMock(return_value=False)
    monkeypatch.setattr(ChatStreamRuntime, "steer_app_notice", steer)
    initiate = AsyncMock(side_effect=ChatException("Already active", status_code=409))
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)
    wake._pending[parent_id] = reports.copy()

    await wake._flush(parent_id)

    steer.assert_awaited_once()
    assert steer.call_args.args[0] == parent_id
    initiate.assert_not_awaited()
    assert wake._pending == {parent_id: reports}
    assert wake._scheduled == set()

    active.clear()
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 3600)
    await wake._flush(parent_id)

    initiate.assert_awaited_once()
    assert wake._pending == {parent_id: reports}
    assert wake._scheduled == {parent_id}


async def test_waiting_child_notifies_once_while_running(
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    child = children[0]
    child_id = str(child.id)
    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", {child_id}.__contains__)
    monkeypatch.setattr(
        session_registry, "pending_permission_ids", lambda chat_id: ["perm-1"]
    )
    monkeypatch.setattr(session_registry, "pending_elicitations", lambda chat_id: [])
    initiate = AsyncMock()
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)

    wake.on_input_request(child_id, str(parent.id), "perm-1", "Bash", frozenset())
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=2)
    await wake._flush(str(parent.id))

    initiate.assert_awaited_once()
    assert initiate.call_args.kwargs["user_app_notice"] == (
        f"Sub-threads waiting for input:\n- **[{child.title}](/chat/{child.id})**"
    )
    prompt = initiate.call_args.args[0].prompt
    assert f"(chat_id: {child.id}, waiting on: permission for Bash)" in prompt
    assert "have finished" not in prompt
    assert wake._waiting == {}


async def test_answered_request_is_not_reported(
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    child_id = str(children[0].id)
    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", {child_id}.__contains__)
    monkeypatch.setattr(session_registry, "pending_permission_ids", lambda chat_id: [])
    monkeypatch.setattr(session_registry, "pending_elicitations", lambda chat_id: [])
    initiate = AsyncMock()
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)

    wake.on_input_request(child_id, str(parent.id), "elicit-1", None, frozenset())
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=2)

    initiate.assert_not_awaited()
    assert wake._waiting == {}


async def test_finished_child_drops_its_waiting_entry(
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    child = children[0]
    child_id = str(child.id)
    parent_id = str(parent.id)
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 3600)
    monkeypatch.setattr(session_registry, "pending_permission_ids", lambda chat_id: [])
    monkeypatch.setattr(session_registry, "pending_elicitations", lambda chat_id: [])
    initiate = AsyncMock()
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)

    wake.on_input_request(child_id, parent_id, "perm-1", "Bash", frozenset())
    wake.on_chain_end(child_id, parent_id, frozenset())
    await wake._flush(parent_id)

    initiate.assert_awaited_once()
    assert initiate.call_args.kwargs["user_app_notice"] == (
        f"Finished sub-threads:\n- **[{child.title}](/chat/{child.id})** (unknown)"
    )
    assert "waiting on" not in initiate.call_args.args[0].prompt


async def test_recover_wakes_parent_for_owed_report_after_restart(
    db_session: AsyncSession,
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    owed = children[0]
    await SubThreadWake.owe_report(db_session, owed.id, frozenset())
    await db_session.commit()
    initiate = AsyncMock()
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)

    await wake.recover()
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=2)

    initiate.assert_awaited_once()
    assert initiate.call_args.args[0].chat_id == parent.id
    assert initiate.call_args.kwargs["user_app_notice"] == (
        f"Finished sub-threads:\n- **[{owed.title}](/chat/{owed.id})** (unknown)"
    )


async def test_owed_report_cleared_only_once_delivered(
    db_session: AsyncSession,
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    child = children[0]
    parent_id = str(parent.id)
    updated_at = select(Chat.updated_at).where(Chat.id == child.id)
    before = await db_session.scalar(updated_at)
    await SubThreadWake.owe_report(db_session, child.id, frozenset())
    await db_session.commit()
    initiate = AsyncMock(side_effect=ChatException("Already active", status_code=409))
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 3600)
    owed = select(Chat.owed_report_device_ids).where(Chat.id == child.id)

    wake.on_chain_end(str(child.id), parent_id, frozenset())
    await wake._flush(parent_id)

    assert await db_session.scalar(owed) == frozenset()

    initiate.side_effect = None
    await wake._flush(parent_id)

    assert initiate.await_count == 2
    assert await db_session.scalar(owed) is None
    assert await db_session.scalar(updated_at) == before


async def test_report_owed_during_a_clear_keeps_only_its_own_devices(
    db_session: AsyncSession,
    chats: tuple[Chat, list[Chat]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    child = chats[1][0]
    delivered, late = uuid4(), uuid4()
    await owe_report_in_own_session(child.id, frozenset({delivered}))
    gate = CommitGate()
    monkeypatch.setattr(wake_module, "SessionLocal", gate)
    clearing = asyncio.create_task(SubThreadWake._clear_owed([str(child.id)]))
    await gate.reached.wait()

    owing = asyncio.create_task(owe_report_in_own_session(child.id, frozenset({late})))
    await asyncio.sleep(RACE_WINDOW_SECONDS)
    gate.release.set()
    await asyncio.gather(clearing, owing)

    assert await db_session.scalar(
        select(Chat.owed_report_device_ids).where(Chat.id == child.id)
    ) == {late}
