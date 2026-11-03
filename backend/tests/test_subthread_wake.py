import asyncio
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import MODELS
from app.models.db_models.chat import Chat
from app.services.chat import ChatService
from app.services.exceptions import ChatException
from app.services.streaming.runtime import ChatStreamRuntime
from app.services import subthread_wake as wake_module
from app.services.subthread_wake import SubThreadWake

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace, create_chat_row

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
        wake.on_chain_end(str(child.id), str(parent.id))
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

    wake.on_chain_end(busy_id, parent_id)
    wake.on_chain_end(str(finished.id), parent_id)
    await asyncio.wait_for(asyncio.gather(*wake._tasks), timeout=2)

    initiate.assert_awaited_once()
    assert initiate.call_args.kwargs["user_app_notice"] == (
        f"Finished sub-threads:\n- **[{finished.title}](/chat/{finished.id})** (unknown)"
    )
    assert busy_id not in initiate.call_args.args[0].prompt
    assert wake._pending == {parent_id: {busy_id}}
    assert wake._scheduled == set()

    active.clear()
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 3600)
    wake.on_chain_end(busy_id, None)
    assert wake._scheduled == {parent_id}


async def test_failed_steer_and_conflicting_wake_requeue(
    chats: tuple[Chat, list[Chat]],
    wake: SubThreadWake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent, children = chats
    parent_id = str(parent.id)
    child_ids = {str(child.id) for child in children}
    active = {parent_id}
    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", active.__contains__)
    steer = AsyncMock(return_value=False)
    monkeypatch.setattr(ChatStreamRuntime, "steer_app_notice", steer)
    initiate = AsyncMock(side_effect=ChatException("Already active", status_code=409))
    monkeypatch.setattr(ChatService, "initiate_chat_completion", initiate)
    wake._pending[parent_id] = child_ids.copy()

    await wake._flush(parent_id)

    steer.assert_awaited_once()
    assert steer.call_args.args[0] == parent_id
    initiate.assert_not_awaited()
    assert wake._pending == {parent_id: child_ids}
    assert wake._scheduled == set()

    active.clear()
    monkeypatch.setattr(wake_module, "WAKE_DEBOUNCE_SECONDS", 3600)
    await wake._flush(parent_id)

    initiate.assert_awaited_once()
    assert wake._pending == {parent_id: child_ids}
    assert wake._scheduled == {parent_id}
