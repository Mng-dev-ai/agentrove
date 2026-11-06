import asyncio
from collections.abc import AsyncIterator, Callable
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import chat as chat_endpoint
from app.constants import MODELS, REDIS_KEY_CHAT_CONTEXT_USAGE
from app.core.deps import get_agent_service, get_queue_service
from app.models.db_models.chat import Chat, ChatCheckpoint, Message, MessageEvent
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.services import chat as chat_service_module
from app.services.exceptions import AgentException, SandboxException
from app.services.queue import QueueService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.session_registry import session_registry
from app.services.streaming import runtime as runtime_module
from app.services.streaming.runtime import ChatStreamRuntime
from app.utils.cache import CacheError, MemoryStore

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    EndpointCache,
    FakeProviderFactory,
    FakeSandboxProvider,
    create_authenticated_workspace,
    create_chat_row,
    register_chat_turn,
)


TEST_MODEL_ID = "opencode:google-vertex/claude-sonnet-4-6@default"

INACTIVE_STATUS = {
    "has_active_task": False,
    "message_id": None,
    "stream_id": None,
    "last_seq": 0,
    "pending_elicitations": [],
}

pytestmark = pytest.mark.anyio


class QueueServiceOverride:
    def __init__(self) -> None:
        self.store = MemoryStore()

    async def __call__(self) -> AsyncIterator[QueueService]:
        yield QueueService(self.store)


class AgentServiceOverride:
    # AgentService drives an ACP agent subprocess; this stands in for it.
    def __init__(self) -> None:
        self.title_prompts: list[str] = []
        self.fail = False
        self.next_title: str | None = "Generated Title"

    def __call__(self) -> "AgentServiceOverride":
        return self

    async def answer_code_question(
        self,
        question: str,
        code: str,
        file_path: str | None,
        language: str | None,
        start_line: int | None,
        end_line: int | None,
        model_id: str,
        user: User,
        chat: Chat,
    ) -> str:
        if self.fail:
            raise AgentException("Ask failed", status_code=503)
        return "Answer: " + question

    async def generate_title(
        self, prompt: str, user: User, chat: Chat | None = None
    ) -> str | None:
        self.title_prompts.append(prompt)
        return self.next_title


class WriteFailingSandboxProvider(FakeSandboxProvider):
    async def write_file(
        self, sandbox_id: str, path: str, content: str | bytes
    ) -> None:
        raise SandboxException("disk full", status_code=400)


class RaisingCacheConnection:
    # Stands in for a module's cache_connection when Redis is unreachable.
    def __call__(self) -> "RaisingCacheConnection":
        return self

    async def __aenter__(self) -> None:
        raise CacheError("cache unavailable")

    async def __aexit__(self, *exc_info: object) -> None:
        return None


@pytest.fixture
def chat_cache(monkeypatch: pytest.MonkeyPatch) -> EndpointCache:
    cache = EndpointCache()
    monkeypatch.setattr(chat_endpoint, "cache_connection", cache.connect)
    return cache


@pytest.fixture
async def live_turns(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[Callable[[UUID], None]]:
    # Registers a running task the way start_background_chat does, so the
    # runtime's real liveness checks see a turn in flight without an agent.
    finished = asyncio.Event()
    tasks: list[asyncio.Task[str]] = []

    async def turn(chat_id: str) -> str:
        await finished.wait()
        return chat_id

    def start(chat_id: UUID) -> None:
        task = asyncio.create_task(turn(str(chat_id)))
        register_chat_turn(monkeypatch, chat_id, task)
        tasks.append(task)

    yield start
    finished.set()
    await asyncio.gather(*tasks)


async def create_message_row(
    db_session: AsyncSession,
    chat: Chat,
    *,
    content: str,
    role: MessageRole = MessageRole.USER,
    stream_status: MessageStreamStatus = MessageStreamStatus.COMPLETED,
    active_stream_id: UUID | None = None,
    last_seq: int = 0,
    model_id: str | None = None,
) -> Message:
    message = Message(
        chat_id=chat.id,
        content_text=content,
        content_render={"events": [{"type": "user_text", "text": content}]},
        role=role,
        stream_status=stream_status,
        active_stream_id=active_stream_id,
        last_seq=last_seq,
        model_id=model_id,
    )
    db_session.add(message)
    await db_session.commit()
    await db_session.refresh(message)
    return message


async def create_message_event_row(
    db_session: AsyncSession,
    message: Message,
    *,
    stream_id: UUID,
    seq: int,
    event_type: str = "content",
) -> MessageEvent:
    event = MessageEvent(
        chat_id=message.chat_id,
        message_id=message.id,
        stream_id=stream_id,
        seq=seq,
        event_type=event_type,
        render_payload={"text": f"event-{seq}"},
        audit_payload={"seq": seq},
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


async def create_checkpoint_row(
    db_session: AsyncSession,
    chat: Chat,
    assistant_message: Message,
    *,
    cwd: str | None = None,
    pre_run_diff: str = "",
    base_head: str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
) -> ChatCheckpoint:
    checkpoint = ChatCheckpoint(
        chat_id=chat.id,
        assistant_message_id=assistant_message.id,
        cwd=cwd,
        base_head=base_head,
        pre_run_diff=pre_run_diff,
    )
    db_session.add(checkpoint)
    await db_session.commit()
    await db_session.refresh(checkpoint)
    return checkpoint


async def create_other_user(
    db_session: AsyncSession, create_user: UserFactory, login: LoginClient
) -> tuple[dict[str, str], User, Workspace]:
    return await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="other-user@example.com",
        username="otheruser",
    )


async def test_create_list_and_get_chat(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    create_response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "New Chat",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
        },
        headers=headers,
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["title"] == "New Chat"
    assert created["user_id"] == str(user.id)
    assert created["workspace_id"] == str(workspace.id)
    assert created["sandbox_id"] == workspace.sandbox_id
    assert created["sub_thread_count"] == 0

    list_response = await client.get("/api/v1/chat/chats", headers=headers)
    detail_response = await client.get(
        f"/api/v1/chat/chats/{created['id']}", headers=headers
    )

    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == created["id"]
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == created["id"]


async def test_chats_reject_missing_token(client: AsyncClient) -> None:
    chat_id = UUID("00000000-0000-0000-0000-000000000001")

    list_response = await client.get("/api/v1/chat/chats")
    create_response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "No Auth",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(chat_id),
        },
    )
    detail_response = await client.get(f"/api/v1/chat/chats/{chat_id}")

    assert list_response.status_code == 401
    assert create_response.status_code == 401
    assert detail_response.status_code == 401


async def test_chat_access_is_limited_to_owner(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())
    owner_headers, owner, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, owner, workspace, title="Private")
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )
    chat_url = f"/api/v1/chat/chats/{chat.id}"

    other_list = await client.get("/api/v1/chat/chats", headers=other_headers)
    other_get = await client.get(chat_url, headers=other_headers)
    other_patch = await client.patch(
        chat_url, json={"title": "Hijacked"}, headers=other_headers
    )
    other_delete = await client.delete(chat_url, headers=other_headers)
    other_viewed = await client.post(f"{chat_url}/viewed", headers=other_headers)
    other_sub_threads = await client.get(
        f"{chat_url}/sub-threads", headers=other_headers
    )
    other_context = await client.get(f"{chat_url}/context-usage", headers=other_headers)
    owner_get = await client.get(chat_url, headers=owner_headers)

    assert other_list.status_code == 200
    assert other_list.json()["items"] == []
    assert other_get.status_code == 404
    assert other_patch.status_code == 404
    assert other_delete.status_code == 404
    assert other_viewed.status_code == 404
    assert other_sub_threads.status_code == 404
    assert other_context.status_code == 404
    assert owner_get.status_code == 200
    assert owner_get.json()["title"] == "Private"


async def test_create_chat_rejects_workspace_or_parent_owned_by_another_user(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    _other_headers, other_user, other_workspace = await create_other_user(
        db_session, create_user, login
    )
    other_parent = await create_chat_row(db_session, other_user, other_workspace)

    missing_workspace = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "No Workspace",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(uuid4()),
        },
        headers=headers,
    )
    foreign_workspace = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Foreign Workspace",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(other_workspace.id),
        },
        headers=headers,
    )
    foreign_parent = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Foreign Parent",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
            "parent_chat_id": str(other_parent.id),
        },
        headers=headers,
    )
    owner_list = await client.get("/api/v1/chat/chats", headers=headers)

    assert missing_workspace.status_code == 404
    assert missing_workspace.json()["detail"] == "Workspace not found"
    assert foreign_workspace.status_code == 404
    assert foreign_workspace.json()["detail"] == "Workspace not found"
    assert foreign_parent.status_code == 404
    assert foreign_parent.json()["detail"] == "Parent chat not found"
    assert owner_list.json()["total"] == 0


async def test_create_chat_publishes_best_effort_and_swallows_cache_errors(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    monkeypatch.setattr(
        chat_service_module, "cache_connection", RaisingCacheConnection()
    )

    response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Best Effort",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
        },
        headers=headers,
    )

    assert response.status_code == 201
    assert response.json()["title"] == "Best Effort"


async def test_send_message_rejects_invalid_base_branch_before_starting_turn(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    response = await client.post(
        "/api/v1/chat/chat",
        data={
            "prompt": "Ship this",
            "chat_id": str(chat.id),
            "model_id": TEST_MODEL_ID,
            "worktree": "true",
            "base_branch": "a b",
        },
        headers=headers,
    )
    messages = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )

    assert response.status_code == 422
    assert messages.json()["items"] == []


async def test_send_message_to_another_users_chat_is_rejected(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    owner_headers, owner, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, owner, workspace)
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/chat/chat",
        data={
            "prompt": "Run this in someone else's workspace",
            "chat_id": str(chat.id),
            "model_id": TEST_MODEL_ID,
        },
        headers=other_headers,
    )
    messages = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=owner_headers
    )

    assert response.status_code == 404
    assert messages.json()["items"] == []
    assert not ChatStreamRuntime.has_active_chat(str(chat.id))


async def test_ask_code_endpoint_answers_and_enforces_chat_access(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    agent_service = AgentServiceOverride()
    app.dependency_overrides[get_agent_service] = agent_service
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )
    url = f"/api/v1/chat/chats/{chat.id}/ask-code"
    payload = {
        "question": "What does this do?",
        "code": "def add(a, b):\n    return a + b",
        "file_path": "src/math.py",
        "language": "python",
        "start_line": 1,
        "end_line": 2,
        "model_id": TEST_MODEL_ID,
    }

    response = await client.post(url, json=payload, headers=headers)
    other_response = await client.post(url, json=payload, headers=other_headers)
    agent_service.fail = True
    failure_response = await client.post(url, json=payload, headers=headers)

    assert response.status_code == 200
    assert response.json() == {"answer": "Answer: What does this do?"}
    assert other_response.status_code == 404
    assert failure_response.status_code == 503
    assert failure_response.json()["detail"] == "Ask failed"


async def test_generate_chat_title_uses_first_user_message(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    agent_service = AgentServiceOverride()
    app.dependency_overrides[get_agent_service] = agent_service
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    empty_chat = await create_chat_row(db_session, user, workspace, title="Empty")

    no_messages_response = await client.post(
        f"/api/v1/chat/chats/{empty_chat.id}/generate-title", headers=headers
    )

    chat = await create_chat_row(db_session, user, workspace, title="With Messages")
    await create_message_row(db_session, chat, content="   ")
    await create_message_row(db_session, chat, content="Ship the release notes")
    await create_message_row(
        db_session,
        chat,
        content="Sure, drafting them now",
        role=MessageRole.ASSISTANT,
        model_id=TEST_MODEL_ID,
    )
    await create_message_row(db_session, chat, content="Also tag the build")

    success_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/generate-title", headers=headers
    )

    agent_service.next_title = None
    failure_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/generate-title", headers=headers
    )

    assert no_messages_response.status_code == 400
    assert (
        no_messages_response.json()["detail"]
        == "Chat has no messages to generate a title from"
    )
    assert success_response.status_code == 200
    assert success_response.json() == {"title": "Generated Title"}
    assert agent_service.title_prompts[0] == "Ship the release notes"
    assert failure_response.status_code == 503
    assert failure_response.json()["detail"] == "Title generation failed"


async def test_update_chat_title_and_pin_filters(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, title="Original")
    await create_chat_row(db_session, user, workspace, title="Unpinned")

    update_response = await client.patch(
        f"/api/v1/chat/chats/{chat.id}",
        json={"title": "Renamed", "pinned": True},
        headers=headers,
    )
    pinned_response = await client.get(
        "/api/v1/chat/chats?pinned=true", headers=headers
    )
    unpinned_response = await client.get(
        "/api/v1/chat/chats?pinned=false", headers=headers
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "Renamed"
    assert updated["pinned_at"] is not None
    assert pinned_response.status_code == 200
    assert [item["id"] for item in pinned_response.json()["items"]] == [str(chat.id)]
    assert unpinned_response.status_code == 200
    assert unpinned_response.json()["total"] == 1


async def test_list_chats_pages_pinned_first_then_newest_and_hides_sub_threads(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    with_sub_thread = await create_chat_row(db_session, user, workspace, title="B")
    pinned = await create_chat_row(db_session, user, workspace, title="A")
    sub_thread_response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Sub-thread",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
            "parent_chat_id": str(with_sub_thread.id),
        },
        headers=headers,
    )
    await client.patch(
        f"/api/v1/chat/chats/{pinned.id}", json={"pinned": True}, headers=headers
    )
    newest = await create_chat_row(db_session, user, workspace, title="C")

    first_page = await client.get(
        "/api/v1/chat/chats?page=1&per_page=2", headers=headers
    )
    second_page = await client.get(
        "/api/v1/chat/chats?page=2&per_page=2", headers=headers
    )
    with_sub_threads = await client.get(
        "/api/v1/chat/chats?include_sub_threads=true", headers=headers
    )

    assert sub_thread_response.status_code == 201
    first_body = first_page.json()
    assert [item["id"] for item in first_body["items"]] == [
        str(pinned.id),
        str(newest.id),
    ]
    assert first_body["total"] == 3
    assert first_body["pages"] == 2
    [last_item] = second_page.json()["items"]
    assert last_item["id"] == str(with_sub_thread.id)
    assert last_item["sub_thread_count"] == 1
    assert with_sub_threads.json()["total"] == 4


async def test_get_chats_filters_by_workspace_id(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_workspace = Workspace(
        name="Second Workspace",
        user_id=user.id,
        sandbox_id="sandbox-second",
        sandbox_provider="host",
        workspace_path="/tmp/agentrove-test-second",
        source_type="empty",
        source_url=None,
    )
    db_session.add(other_workspace)
    await db_session.commit()
    await db_session.refresh(other_workspace)

    chat_in_workspace = await create_chat_row(
        db_session, user, workspace, title="In Workspace"
    )
    await create_chat_row(db_session, user, other_workspace, title="Other Workspace")

    response = await client.get(
        f"/api/v1/chat/chats?workspace_id={workspace.id}", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["items"]] == [str(chat_in_workspace.id)]


async def test_mark_chat_viewed_and_update_preserve_read_state_across_bumps(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    viewed_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/viewed", headers=headers
    )
    updated_response = await client.patch(
        f"/api/v1/chat/chats/{chat.id}",
        json={"title": "Renamed after viewing"},
        headers=headers,
    )

    assert viewed_response.status_code == 204
    assert updated_response.status_code == 200
    updated = updated_response.json()
    assert updated["title"] == "Renamed after viewing"
    assert updated["unread"] is False


async def test_delete_chat_cascades_sub_threads_and_last_chat_deletes_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    parent = await create_chat_row(db_session, user, workspace, title="Delete Me")
    remaining = await create_chat_row(db_session, user, workspace, title="Keep Me")
    sub_create = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Sub-thread",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
            "parent_chat_id": str(parent.id),
        },
        headers=headers,
    )
    sub_thread_id = sub_create.json()["id"]

    missing_response = await client.delete(
        f"/api/v1/chat/chats/{uuid4()}", headers=headers
    )
    delete_response = await client.delete(
        f"/api/v1/chat/chats/{parent.id}", headers=headers
    )
    list_response = await client.get(
        "/api/v1/chat/chats?include_sub_threads=true", headers=headers
    )
    parent_detail = await client.get(f"/api/v1/chat/chats/{parent.id}", headers=headers)
    sub_thread_detail = await client.get(
        f"/api/v1/chat/chats/{sub_thread_id}", headers=headers
    )
    workspace_after_first = await client.get(
        f"/api/v1/workspaces/{workspace.id}", headers=headers
    )

    assert sub_create.status_code == 201
    assert missing_response.status_code == 404
    assert delete_response.status_code == 204
    assert [item["id"] for item in list_response.json()["items"]] == [str(remaining.id)]
    assert parent_detail.status_code == 404
    assert sub_thread_detail.status_code == 404
    assert workspace_after_first.status_code == 200

    last_delete = await client.delete(
        f"/api/v1/chat/chats/{remaining.id}", headers=headers
    )
    workspace_after_last = await client.get(
        f"/api/v1/workspaces/{workspace.id}", headers=headers
    )

    assert last_delete.status_code == 204
    assert workspace_after_last.status_code == 404


async def test_delete_all_chats_only_deletes_current_user_chats(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())
    owner_headers, owner, owner_workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    owner_chat = await create_chat_row(db_session, owner, owner_workspace)
    await create_message_row(db_session, owner_chat, content="Remove me")
    other_headers, other_user, other_workspace = await create_other_user(
        db_session, create_user, login
    )
    other_chat = await create_chat_row(db_session, other_user, other_workspace)

    response = await client.delete("/api/v1/chat/chats/all", headers=owner_headers)
    owner_list = await client.get("/api/v1/chat/chats", headers=owner_headers)
    owner_detail = await client.get(
        f"/api/v1/chat/chats/{owner_chat.id}", headers=owner_headers
    )
    other_list = await client.get("/api/v1/chat/chats", headers=other_headers)

    assert response.status_code == 204
    assert owner_list.status_code == 200
    assert owner_list.json()["items"] == []
    assert owner_detail.status_code == 404
    assert other_list.status_code == 200
    assert [item["id"] for item in other_list.json()["items"]] == [str(other_chat.id)]


async def test_sub_threads_are_listed_and_nested_sub_threads_are_rejected(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    parent = await create_chat_row(db_session, user, workspace, title="Parent")

    create_sub_response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Sub-thread",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
            "parent_chat_id": str(parent.id),
        },
        headers=headers,
    )
    sub_thread = create_sub_response.json()
    list_response = await client.get(
        f"/api/v1/chat/chats/{parent.id}/sub-threads", headers=headers
    )
    missing_list_response = await client.get(
        f"/api/v1/chat/chats/{uuid4()}/sub-threads", headers=headers
    )
    nested_response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Nested",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
            "parent_chat_id": sub_thread["id"],
        },
        headers=headers,
    )

    assert create_sub_response.status_code == 201
    assert sub_thread["workspace_id"] == str(workspace.id)
    assert sub_thread["parent_chat_id"] == str(parent.id)
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [sub_thread["id"]]
    assert missing_list_response.status_code == 404
    assert nested_response.status_code == 400
    assert nested_response.json()["detail"] == (
        "Cannot create a sub-thread of a sub-thread"
    )


async def test_create_sub_thread_rejects_missing_parent_and_preserves_read_state(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    parent = await create_chat_row(db_session, user, workspace, title="Parent")

    missing_parent_response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Orphan",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
            "parent_chat_id": str(uuid4()),
        },
        headers=headers,
    )

    await client.post(f"/api/v1/chat/chats/{parent.id}/viewed", headers=headers)

    sub_thread_response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "Sub-thread",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(workspace.id),
            "parent_chat_id": str(parent.id),
        },
        headers=headers,
    )
    parent_detail = await client.get(f"/api/v1/chat/chats/{parent.id}", headers=headers)

    assert missing_parent_response.status_code == 404
    assert missing_parent_response.json()["detail"] == "Parent chat not found"
    assert sub_thread_response.status_code == 201
    assert parent_detail.status_code == 200
    # Sub-thread creation bumps the parent's ordering timestamp but should
    # carry the already-read state across it rather than flipping unread.
    assert parent_detail.json()["unread"] is False


async def test_chat_messages_returns_only_owned_chat_messages(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    message = await create_message_row(db_session, chat, content="Visible message")
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )
    other_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=other_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["has_more"] is False
    assert body["next_cursor"] is None
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == str(message.id)
    assert body["items"][0]["content_text"] == "Visible message"
    assert other_response.status_code == 403


async def test_chat_messages_pagination_cursor_round_trip_and_rejects_invalid_cursor(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    older = await create_message_row(db_session, chat, content="Older message")
    newer = await create_message_row(db_session, chat, content="Newer message")

    first_page = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages?limit=1", headers=headers
    )
    first_body = first_page.json()
    next_cursor = first_body["next_cursor"]

    second_page = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages?limit=1&cursor={next_cursor}",
        headers=headers,
    )

    invalid_cursor_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages?cursor=not-valid-base64!!",
        headers=headers,
    )

    assert first_page.status_code == 200
    assert first_body["has_more"] is True
    assert next_cursor is not None
    assert first_body["items"][0]["id"] == str(newer.id)
    assert second_page.status_code == 200
    second_body = second_page.json()
    assert second_body["has_more"] is False
    assert second_body["items"][0]["id"] == str(older.id)
    assert invalid_cursor_response.status_code == 400
    assert invalid_cursor_response.json()["detail"] == "Invalid pagination cursor"


async def test_chat_messages_include_assistant_checkpoint_id(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    assistant_message = await create_message_row(
        db_session,
        chat,
        content="Changed files",
        role=MessageRole.ASSISTANT,
    )
    checkpoint = await create_checkpoint_row(db_session, chat, assistant_message)

    response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == str(assistant_message.id)
    assert body["items"][0]["checkpoint_id"] == str(checkpoint.id)


async def test_message_events_respect_owner_and_after_seq(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    message = await create_message_row(
        db_session,
        chat,
        content="Assistant response",
        role=MessageRole.ASSISTANT,
    )
    stream_id = uuid4()
    await create_message_event_row(db_session, message, stream_id=stream_id, seq=1)
    second_event = await create_message_event_row(
        db_session, message, stream_id=stream_id, seq=2
    )
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/chat/messages/{message.id}/events?after_seq=1",
        headers=headers,
    )
    other_response = await client.get(
        f"/api/v1/chat/messages/{message.id}/events",
        headers=other_headers,
    )
    missing_response = await client.get(
        f"/api/v1/chat/messages/{uuid4()}/events", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == str(second_event.id)
    assert body[0]["seq"] == 2
    assert body[0]["render_payload"] == {"text": "event-2"}
    assert body[0]["audit_payload"] == {"seq": 2}
    assert other_response.status_code == 404
    assert missing_response.status_code == 404
    assert missing_response.json()["detail"] == "Message not found"


async def test_restore_message_checkpoint_resets_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = FakeSandboxProvider()
    monkeypatch.setattr(
        SandboxProvider,
        "create_provider",
        FakeProviderFactory(provider=provider),
    )
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    assistant_message = await create_message_row(
        db_session,
        chat,
        content="Changed files",
        role=MessageRole.ASSISTANT,
    )
    await create_checkpoint_row(
        db_session,
        chat,
        assistant_message,
        cwd="packages/api",
        pre_run_diff="diff --git a/app.py b/app.py\n",
    )

    response = await client.post(
        f"/api/v1/chat/messages/{assistant_message.id}/checkpoint/restore-all",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "output": "", "error": None}
    assert len(provider.writes) == 1
    sandbox_id, patch_path, patch_content = provider.writes[0]
    assert sandbox_id == workspace.sandbox_id
    assert patch_path.startswith("packages/api/")
    assert patch_content == "diff --git a/app.py b/app.py\n"


async def test_restore_message_checkpoint_rejects_other_users(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = FakeSandboxProvider()
    monkeypatch.setattr(
        SandboxProvider,
        "create_provider",
        FakeProviderFactory(provider=provider),
    )
    _headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    assistant_message = await create_message_row(
        db_session,
        chat,
        content="Changed files",
        role=MessageRole.ASSISTANT,
    )
    await create_checkpoint_row(db_session, chat, assistant_message)
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )

    response = await client.post(
        f"/api/v1/chat/messages/{assistant_message.id}/checkpoint/restore-all",
        headers=other_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Checkpoint not found"
    assert provider.commands == []


async def test_restore_message_checkpoint_translates_sandbox_and_value_errors(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    invalid_message = await create_message_row(
        db_session, chat, content="Invalid checkpoint", role=MessageRole.ASSISTANT
    )
    await create_checkpoint_row(
        db_session, chat, invalid_message, base_head="not-a-valid-hash"
    )
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())
    value_error_response = await client.post(
        f"/api/v1/chat/messages/{invalid_message.id}/checkpoint/restore-all",
        headers=headers,
    )

    write_failing_message = await create_message_row(
        db_session, chat, content="Write failure", role=MessageRole.ASSISTANT
    )
    await create_checkpoint_row(
        db_session,
        chat,
        write_failing_message,
        pre_run_diff="diff --git a/app.py b/app.py\n",
    )
    monkeypatch.setattr(
        SandboxProvider,
        "create_provider",
        FakeProviderFactory(provider=WriteFailingSandboxProvider()),
    )
    sandbox_error_response = await client.post(
        f"/api/v1/chat/messages/{write_failing_message.id}/checkpoint/restore-all",
        headers=headers,
    )

    assert value_error_response.status_code == 400
    assert value_error_response.json()["detail"] == "Invalid checkpoint commit"
    assert sandbox_error_response.status_code == 400
    assert sandbox_error_response.json()["detail"] == "disk full"


async def test_chat_status_reports_live_turn_only_to_owner(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    live_turns: Callable[[UUID], None],
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    starting_chat = await create_chat_row(db_session, user, workspace)
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )
    stream_id = uuid4()
    message = await create_message_row(
        db_session,
        chat,
        content="Streaming response",
        role=MessageRole.ASSISTANT,
        stream_status=MessageStreamStatus.IN_PROGRESS,
        active_stream_id=stream_id,
        last_seq=7,
    )

    # An IN_PROGRESS row left behind with no live turn (e.g. after a restart)
    # must not make the client resume a stream that will never finish.
    stale_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=headers
    )

    live_turns(chat.id)
    live_turns(starting_chat.id)
    active_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=headers
    )
    other_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=other_headers
    )
    no_message_response = await client.get(
        f"/api/v1/chat/chats/{starting_chat.id}/status", headers=headers
    )

    assert stale_response.status_code == 200
    assert stale_response.json() == INACTIVE_STATUS
    assert active_response.status_code == 200
    assert active_response.json() == {
        "has_active_task": True,
        "message_id": str(message.id),
        "stream_id": str(stream_id),
        "last_seq": 7,
        "pending_elicitations": [],
    }
    assert other_response.status_code == 404
    assert no_message_response.json() == INACTIVE_STATUS


async def test_active_streams_lists_only_current_users_live_turns(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    live_turns: Callable[[UUID], None],
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_headers, other_user, other_workspace = await create_other_user(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    other_chat = await create_chat_row(db_session, other_user, other_workspace)
    stream_id = uuid4()
    message = await create_message_row(
        db_session,
        chat,
        content="Streaming",
        role=MessageRole.ASSISTANT,
        stream_status=MessageStreamStatus.IN_PROGRESS,
        active_stream_id=stream_id,
        last_seq=3,
    )
    other_message = await create_message_row(
        db_session,
        other_chat,
        content="Other streaming",
        role=MessageRole.ASSISTANT,
        stream_status=MessageStreamStatus.IN_PROGRESS,
        active_stream_id=uuid4(),
    )

    idle_response = await client.get(
        "/api/v1/chat/chats/active-streams", headers=headers
    )
    live_turns(chat.id)
    live_turns(other_chat.id)
    owner_response = await client.get(
        "/api/v1/chat/chats/active-streams", headers=headers
    )
    other_response = await client.get(
        "/api/v1/chat/chats/active-streams", headers=other_headers
    )

    assert idle_response.status_code == 200
    assert idle_response.json() == []
    assert owner_response.status_code == 200
    assert owner_response.json() == [
        {
            "chat_id": str(chat.id),
            "message_id": str(message.id),
            "stream_id": str(stream_id),
            "last_seq": 3,
        }
    ]
    assert [entry["message_id"] for entry in other_response.json()] == [
        str(other_message.id)
    ]


async def test_cancel_stream_only_flags_live_or_starting_turns_of_own_chat(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )
    idle_chat = await create_chat_row(db_session, user, workspace, title="Idle")
    starting_chat = await create_chat_row(db_session, user, workspace, title="Start")
    # Already-released reservation: cancel_chat_turn waits on it, so a set
    # event keeps the request from holding for the unwind timeout.
    released_reservation = asyncio.Event()
    released_reservation.set()
    register_chat_turn(monkeypatch, starting_chat.id, released_reservation)

    other_response = await client.delete(
        f"/api/v1/chat/chats/{starting_chat.id}/stream", headers=other_headers
    )
    other_flagged = session_registry.consume_pending_cancel(str(starting_chat.id))
    idle_response = await client.delete(
        f"/api/v1/chat/chats/{idle_chat.id}/stream", headers=headers
    )
    starting_response = await client.delete(
        f"/api/v1/chat/chats/{starting_chat.id}/stream", headers=headers
    )

    assert other_response.status_code == 404
    assert other_flagged is False
    assert idle_response.status_code == 204
    # A stray pending-cancel flag on an idle chat would kill its next turn.
    assert session_registry.consume_pending_cancel(str(idle_chat.id)) is False
    assert starting_response.status_code == 204
    assert session_registry.consume_pending_cancel(str(starting_chat.id)) is True


async def test_context_usage_falls_back_to_database_when_cache_is_malformed(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    chat_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    chat.context_token_usage = 1000
    await create_message_row(
        db_session,
        chat,
        content="Assistant response",
        role=MessageRole.ASSISTANT,
        model_id=TEST_MODEL_ID,
    )

    cache_key = REDIS_KEY_CHAT_CONTEXT_USAGE.format(chat_id=str(chat.id))
    await chat_cache.store.set(cache_key, '{"tokens_used": "broken"}')

    response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/context-usage", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    context_window = MODELS[TEST_MODEL_ID].context_window
    assert context_window is not None
    assert body == {
        "tokens_used": 1000,
        "context_window": context_window,
        "percentage": (1000 / context_window) * 100,
    }


async def test_context_usage_for_chat_without_assistant_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    chat_cache: EndpointCache,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/context-usage", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {
        "tokens_used": 0,
        "context_window": 0,
        "percentage": 0.0,
    }


async def test_queue_message_lifecycle(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    queue_url = f"/api/v1/chat/chats/{chat.id}/queue"

    create_response = await client.post(
        queue_url,
        data={
            "content": "First queued prompt",
            "model_id": TEST_MODEL_ID,
            "permission_mode": "bypassPermissions",
            "thinking_mode": "high",
            "worktree": "true",
            "base_branch": " main ",
            "selected_persona_name": "Default",
        },
        headers=headers,
    )

    assert create_response.status_code == 201
    queued_id = create_response.json()["id"]

    list_response = await client.get(queue_url, headers=headers)
    assert list_response.status_code == 200
    queued = list_response.json()
    assert len(queued) == 1
    assert queued[0]["id"] == queued_id
    assert queued[0]["content"] == "First queued prompt"
    assert queued[0]["model_id"] == TEST_MODEL_ID
    assert queued[0]["permission_mode"] == "bypassPermissions"
    assert queued[0]["thinking_mode"] == "high"
    assert queued[0]["worktree"] is True
    assert queued[0]["base_branch"] == "main"
    assert queued[0]["selected_persona_name"] == "Default"
    assert queued[0]["attachments"] is None

    update_response = await client.patch(
        f"{queue_url}/{queued_id}",
        json={"content": "Edited queued prompt"},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["content"] == "Edited queued prompt"

    missing_id = UUID("00000000-0000-0000-0000-000000000001")
    missing_update_response = await client.patch(
        f"{queue_url}/{missing_id}",
        json={"content": "Missing prompt"},
        headers=headers,
    )
    missing_delete_response = await client.delete(
        f"{queue_url}/{missing_id}", headers=headers
    )
    missing_send_now_response = await client.post(
        f"{queue_url}/{missing_id}/send-now", headers=headers
    )
    assert missing_update_response.status_code == 404
    assert missing_delete_response.status_code == 404
    assert missing_send_now_response.status_code == 404

    delete_response = await client.delete(f"{queue_url}/{queued_id}", headers=headers)
    final_list_response = await client.get(queue_url, headers=headers)
    assert delete_response.status_code == 204
    assert final_list_response.json() == []

    await client.post(
        queue_url,
        data={"content": "Second queued prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    await client.post(
        queue_url,
        data={"content": "Third queued prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    clear_response = await client.delete(queue_url, headers=headers)
    cleared_list_response = await client.get(queue_url, headers=headers)

    assert clear_response.status_code == 204
    assert cleared_list_response.json() == []


async def test_queue_message_endpoint_validates_base_branch_before_queueing(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    queue_override = QueueServiceOverride()
    app.dependency_overrides[get_queue_service] = queue_override
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    endpoint = f"/api/v1/chat/chats/{chat.id}/queue"
    request_data = {
        "content": "Queued prompt",
        "model_id": TEST_MODEL_ID,
        "worktree": "true",
    }

    invalid_response = await client.post(
        endpoint,
        data={**request_data, "base_branch": "a b"},
        headers=headers,
    )

    assert invalid_response.status_code == 422
    assert await QueueService(queue_override.store).get_queue(str(chat.id)) == []

    blank_response = await client.post(
        endpoint,
        data={**request_data, "base_branch": ""},
        headers=headers,
    )

    assert blank_response.status_code == 201
    queued = await QueueService(queue_override.store).get_queue(str(chat.id))
    assert queued[0].base_branch is None


async def test_queue_access_is_limited_to_chat_owner(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    owner_headers, owner, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, owner, workspace)
    other_headers, _other_user, _other_workspace = await create_other_user(
        db_session, create_user, login
    )

    create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Owner queued prompt", "model_id": TEST_MODEL_ID},
        headers=owner_headers,
    )
    assert create_response.status_code == 201
    queued_id = create_response.json()["id"]

    other_create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Injected prompt", "model_id": TEST_MODEL_ID},
        headers=other_headers,
    )
    other_list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=other_headers
    )
    other_update_response = await client.patch(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}",
        json={"content": "Stolen prompt"},
        headers=other_headers,
    )
    other_delete_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}", headers=other_headers
    )
    other_send_now_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now",
        headers=other_headers,
    )
    other_clear_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=other_headers
    )
    owner_list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=owner_headers
    )

    assert other_create_response.status_code == 404
    assert other_list_response.status_code == 404
    assert other_update_response.status_code == 404
    assert other_delete_response.status_code == 404
    assert other_send_now_response.status_code == 404
    assert other_clear_response.status_code == 404
    assert owner_list_response.status_code == 200
    assert [item["content"] for item in owner_list_response.json()] == [
        "Owner queued prompt"
    ]


async def test_send_now_during_reserved_start_cancels_current_turn(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Queued during reserved start", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    queued_id = create_response.json()["id"]

    async with ChatStreamRuntime.chat_start_slot(str(chat.id)) as reserved:
        assert reserved
        send_now_response = await client.post(
            f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now",
            headers=headers,
        )

    queue_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )

    assert send_now_response.status_code == 204
    # The starting turn consumes the cancel flag at bootstrap and its
    # INTERRUPTED path picks the message up; the idle path would lose the
    # reservation race and strand the send-now marker.
    assert session_registry.consume_pending_cancel(str(chat.id)) is True
    assert [item["id"] for item in queue_response.json()] == [queued_id]


async def test_idle_send_now_start_failure_keeps_message_queued(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    monkeypatch.setattr(runtime_module, "cache_connection", RaisingCacheConnection())
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    queue_url = f"/api/v1/chat/chats/{chat.id}/queue"

    queued_response = await client.post(
        queue_url,
        data={"content": "Queued first", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    send_now_response = await client.post(
        f"{queue_url}/{queued_response.json()['id']}/send-now", headers=headers
    )
    queue_and_send_response = await client.post(
        queue_url,
        data={
            "content": "Queued with send-now",
            "model_id": TEST_MODEL_ID,
            "send_now": "true",
        },
        headers=headers,
    )
    queue_response = await client.get(queue_url, headers=headers)

    assert send_now_response.status_code == 503
    assert send_now_response.json()["detail"] == "Failed to start send-now execution"
    assert queue_and_send_response.status_code == 201
    assert queue_and_send_response.json()["send_now_failed"] is True
    assert [item["content"] for item in queue_response.json()] == [
        "Queued first",
        "Queued with send-now",
    ]
    assert not ChatStreamRuntime.has_pending_start(str(chat.id))


async def test_search_chats_returns_only_own_matches_and_rejects_blank_query(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, title="Searchable Chat")
    message = await create_message_row(
        db_session,
        chat,
        content="The agent found a durable needle in the transcript.",
    )
    await create_message_row(db_session, chat, content="Unrelated message")
    _other_headers, other_user, other_workspace = await create_other_user(
        db_session, create_user, login
    )
    other_chat = await create_chat_row(db_session, other_user, other_workspace)
    await create_message_row(db_session, other_chat, content="Another needle here")

    response = await client.get("/api/v1/chat/chats/search?q=needle", headers=headers)
    blank_response = await client.get(
        "/api/v1/chat/chats/search?q=%20%20", headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["truncated"] is False
    assert len(body["results"]) == 1
    result = body["results"][0]
    assert result["chat_id"] == str(chat.id)
    assert result["chat_title"] == "Searchable Chat"
    assert result["workspace_id"] == str(workspace.id)
    assert result["workspace_name"] == workspace.name
    assert result["match_count"] == 1
    assert result["matches"][0]["message_id"] == str(message.id)
    assert result["matches"][0]["snippet_match"] == "needle"
    assert blank_response.status_code == 422


async def test_search_messages_reports_truncation_from_chat_cap_and_per_chat_limits(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    # chat_cap truncation: 3 distinct matching chats but limit=1 caps the
    # lookahead at chat_cap=2, so the loop breaks mid-iteration.
    for index in range(3):
        cap_chat = await create_chat_row(
            db_session, user, workspace, title=f"Cap Chat {index}"
        )
        await create_message_row(
            db_session, cap_chat, content=f"contains cap-needle-{index}"
        )
    cap_response = await client.get(
        "/api/v1/chat/chats/search?q=cap-needle&limit=1&per_chat_limit=5",
        headers=headers,
    )

    per_chat = await create_chat_row(
        db_session, user, workspace, title="Per Chat Limit"
    )
    await create_message_row(
        db_session, per_chat, content="first perchat-needle mention"
    )
    await create_message_row(
        db_session, per_chat, content="second perchat-needle mention"
    )
    per_chat_response = await client.get(
        "/api/v1/chat/chats/search?q=perchat-needle&limit=5&per_chat_limit=1",
        headers=headers,
    )

    # post-loop truncation: exactly limit+1 distinct chats so the loop
    # exhausts all rows without ever hitting the mid-loop break.
    for index in range(2):
        tail_chat = await create_chat_row(
            db_session, user, workspace, title=f"Tail Chat {index}"
        )
        await create_message_row(
            db_session, tail_chat, content=f"contains tail-needle-{index}"
        )
    tail_response = await client.get(
        "/api/v1/chat/chats/search?q=tail-needle&limit=1&per_chat_limit=5",
        headers=headers,
    )

    assert cap_response.status_code == 200
    cap_body = cap_response.json()
    assert cap_body["truncated"] is True
    assert len(cap_body["results"]) == 1

    assert per_chat_response.status_code == 200
    per_chat_body = per_chat_response.json()
    assert per_chat_body["truncated"] is True
    assert per_chat_body["results"][0]["match_count"] == 2
    assert len(per_chat_body["results"][0]["matches"]) == 1

    assert tail_response.status_code == 200
    tail_body = tail_response.json()
    assert tail_body["truncated"] is True
    assert len(tail_body["results"]) == 1
