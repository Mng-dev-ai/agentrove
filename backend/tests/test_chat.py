from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import chat as chat_endpoint
from app.constants import MODELS, REDIS_KEY_CHAT_CONTEXT_USAGE
from app.core.deps import get_agent_service, get_chat_service, get_queue_service
from app.models.db_models.chat import Chat, ChatCheckpoint, Message, MessageEvent
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.chat import ChatRequest
from app.services.db import SessionFactoryType
from app.services.exceptions import AgentException, ChatException
from app.services.queue import QueueService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.streaming.runtime import ChatStreamRuntime
from app.utils.cache import MemoryStore

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    EndpointCache,
    FakeProviderFactory,
    FakeSandboxProvider,
    create_authenticated_workspace,
)


TEST_MODEL_ID = "opencode:google-vertex-anthropic/claude-sonnet-4-5@20250929"

pytestmark = pytest.mark.anyio


class QueueServiceOverride:
    def __init__(self) -> None:
        self.store = MemoryStore()

    async def __call__(self) -> AsyncIterator[QueueService]:
        yield QueueService(self.store)


class SendNowCapture:
    def __init__(self) -> None:
        self.chat_ids: list[str] = []

    async def process_send_now_idle(
        self, chat_id: str, _session_factory: SessionFactoryType
    ) -> bool:
        self.chat_ids.append(chat_id)
        return True


class PermissionResolver:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def __call__(
        self,
        chat_id: str,
        request_id: str,
        *,
        option_id: str,
    ) -> bool:
        self.calls.append((chat_id, request_id, option_id))
        return request_id == "request-1"


class ChatCompletionServiceOverride:
    def __init__(self) -> None:
        self.requests: list[ChatRequest] = []
        self.users: list[User] = []
        self.fail = False

    async def __call__(self) -> AsyncIterator["ChatCompletionServiceOverride"]:
        yield self

    async def initiate_chat_completion(
        self, request: ChatRequest, user: User
    ) -> dict[str, UUID | int | str | None]:
        self.requests.append(request)
        self.users.append(user)
        if self.fail:
            raise ChatException("Cannot start chat")
        return {
            "chat_id": request.chat_id,
            "message_id": UUID("00000000-0000-0000-0000-000000000123"),
            "last_seq": 4,
            "checkpoint_id": None,
            "worktree_cwd": None,
        }


class AgentServiceOverride:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, User]] = []
        self.ask_code_calls: list[tuple[str, str, str, str, User, Chat]] = []
        self.fail = False

    def __call__(self) -> "AgentServiceOverride":
        return self

    async def enhance_prompt(self, prompt: str, model_id: str, user: User) -> str:
        self.calls.append((prompt, model_id, user))
        if self.fail:
            raise AgentException("Enhance failed", status_code=503)
        return "Enhanced: " + prompt

    async def answer_code_question(
        self,
        question: str,
        code: str,
        file_path: str,
        language: str,
        start_line: int,
        end_line: int,
        model_id: str,
        user: User,
        chat: Chat,
    ) -> str:
        self.ask_code_calls.append((question, code, file_path, model_id, user, chat))
        if self.fail:
            raise AgentException("Ask failed", status_code=503)
        return "Answer: " + question


@pytest.fixture
def chat_cache(monkeypatch: pytest.MonkeyPatch) -> EndpointCache:
    cache = EndpointCache()
    monkeypatch.setattr(chat_endpoint, "cache_connection", cache.connect)
    return cache


async def create_chat_row(
    db_session: AsyncSession,
    user: User,
    workspace: Workspace,
    *,
    title: str = "Existing Chat",
) -> Chat:
    chat = Chat(
        title=title,
        user_id=user.id,
        workspace_id=workspace.id,
    )
    db_session.add(chat)
    await db_session.commit()
    await db_session.refresh(chat)
    return chat


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
) -> ChatCheckpoint:
    checkpoint = ChatCheckpoint(
        chat_id=chat.id,
        assistant_message_id=assistant_message.id,
        cwd=cwd,
        base_head="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        pre_run_diff=pre_run_diff,
    )
    db_session.add(checkpoint)
    await db_session.commit()
    await db_session.refresh(checkpoint)
    return checkpoint


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


async def test_send_message_endpoint_passes_form_fields_to_chat_service(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    chat_service = ChatCompletionServiceOverride()
    app.dependency_overrides[get_chat_service] = chat_service
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
            "permission_mode": "default",
            "thinking_mode": "high",
            "worktree": "true",
            "plan_mode": "true",
            "selected_persona_name": "Builder",
        },
        files={"attached_files": ("note.txt", b"hello", "text/plain")},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "chat_id": str(chat.id),
        "message_id": "00000000-0000-0000-0000-000000000123",
        "last_seq": 4,
        "checkpoint_id": None,
        "worktree_cwd": None,
    }
    request = chat_service.requests[0]
    assert request.prompt == "Ship this"
    assert request.chat_id == chat.id
    assert request.model_id == TEST_MODEL_ID
    assert request.permission_mode == "default"
    assert request.thinking_mode == "high"
    assert request.worktree is True
    assert request.plan_mode is True
    assert request.selected_persona_name == "Builder"
    assert request.attached_files is not None
    assert request.attached_files[0].filename == "note.txt"
    assert [stored_user.id for stored_user in chat_service.users] == [user.id]


async def test_send_message_endpoint_translates_chat_errors(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    chat_service = ChatCompletionServiceOverride()
    chat_service.fail = True
    app.dependency_overrides[get_chat_service] = chat_service
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    response = await client.post(
        "/api/v1/chat/chat",
        data={
            "prompt": "Fail this",
            "chat_id": str(chat.id),
            "model_id": TEST_MODEL_ID,
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot start chat"


async def test_enhance_prompt_endpoint_uses_agent_service(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    agent_service = AgentServiceOverride()
    app.dependency_overrides[get_agent_service] = agent_service
    headers, user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/chat/enhance-prompt",
        data={"prompt": "make it concise", "model_id": TEST_MODEL_ID},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {"enhanced_prompt": "Enhanced: make it concise"}
    assert [
        (prompt, model_id, stored_user.id)
        for prompt, model_id, stored_user in agent_service.calls
    ] == [("make it concise", TEST_MODEL_ID, user.id)]

    agent_service.fail = True
    failure_response = await client.post(
        "/api/v1/chat/enhance-prompt",
        data={"prompt": "make it fail", "model_id": TEST_MODEL_ID},
        headers=headers,
    )

    assert failure_response.status_code == 503
    assert failure_response.json()["detail"] == "Enhance failed"


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
        db_session,
        create_user,
        login,
        email="ask-code-owner@example.com",
        username="askcodeowner",
    )
    chat = await create_chat_row(db_session, user, workspace)

    payload = {
        "question": "What does this do?",
        "code": "def add(a, b):\n    return a + b",
        "file_path": "src/math.py",
        "language": "python",
        "start_line": 1,
        "end_line": 2,
        "model_id": TEST_MODEL_ID,
    }
    response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/ask-code", json=payload, headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {"answer": "Answer: What does this do?"}
    [(question, code, file_path, model_id, stored_user, stored_chat)] = (
        agent_service.ask_code_calls
    )
    assert (question, code, file_path, model_id) == (
        payload["question"],
        payload["code"],
        payload["file_path"],
        TEST_MODEL_ID,
    )
    assert stored_user.id == user.id
    assert stored_chat.id == chat.id

    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="ask-code-other@example.com",
        username="askcodeother",
    )
    other_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/ask-code", json=payload, headers=other_headers
    )
    assert other_response.status_code == 404

    agent_service.fail = True
    failure_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/ask-code", json=payload, headers=headers
    )
    assert failure_response.status_code == 503
    assert failure_response.json()["detail"] == "Ask failed"


async def test_chat_access_is_limited_to_owner(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    owner_headers, owner, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="owner-chat@example.com",
        username="ownerchat",
    )
    chat = await create_chat_row(db_session, owner, workspace)
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="other-chat@example.com",
        username="otherchat",
    )

    other_list = await client.get("/api/v1/chat/chats", headers=other_headers)
    other_get = await client.get(f"/api/v1/chat/chats/{chat.id}", headers=other_headers)
    owner_get = await client.get(f"/api/v1/chat/chats/{chat.id}", headers=owner_headers)

    assert other_list.status_code == 200
    assert other_list.json()["items"] == []
    assert other_get.status_code == 404
    assert owner_get.status_code == 200


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


async def test_delete_chat_excludes_it_from_list_and_detail(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace, title="Delete Me")
    remaining = await create_chat_row(db_session, user, workspace, title="Keep Me")

    delete_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}", headers=headers
    )
    list_response = await client.get("/api/v1/chat/chats", headers=headers)
    detail_response = await client.get(f"/api/v1/chat/chats/{chat.id}", headers=headers)

    assert delete_response.status_code == 204
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [str(remaining.id)]
    assert detail_response.status_code == 404


async def test_delete_all_chats_only_deletes_current_user_chats(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())
    owner_headers, owner, owner_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="delete-all-owner@example.com",
        username="deleteallowner",
    )
    owner_chat = await create_chat_row(db_session, owner, owner_workspace)
    await create_message_row(db_session, owner_chat, content="Remove me")
    other_headers, other_user, other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="delete-all-other@example.com",
        username="deleteallother",
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
    assert nested_response.status_code == 400
    assert nested_response.json()["detail"] == (
        "Cannot create a sub-thread of a sub-thread"
    )


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
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="messages-other@example.com",
        username="messagesother",
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
    assert patch_path.startswith("packages/api/.agentrove-checkpoint-")
    assert patch_path.endswith(".patch")
    assert patch_content == "diff --git a/app.py b/app.py\n"
    commands = [command for _sandbox_id, command, _envs in provider.commands]
    assert commands[-1].startswith("cd 'packages/api' && ")
    assert "git reset --hard 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'" in commands[-1]
    assert "git apply --whitespace=nowarn" in commands[-1]


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
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="checkpoint-other@example.com",
        username="checkpointother",
    )

    response = await client.post(
        f"/api/v1/chat/messages/{assistant_message.id}/checkpoint/restore-all",
        headers=other_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Checkpoint not found"
    assert provider.commands == []


async def test_chat_status_reports_active_stream_only_when_runtime_is_active(
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

    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", lambda _chat_id: False)
    inactive_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=headers
    )

    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", lambda _chat_id: True)
    active_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=headers
    )

    assert inactive_response.status_code == 200
    assert inactive_response.json() == {
        "has_active_task": False,
        "message_id": None,
        "stream_id": None,
        "last_seq": 0,
    }
    assert active_response.status_code == 200
    active_body = active_response.json()
    assert active_body["has_active_task"] is True
    assert active_body["message_id"] == str(message.id)
    assert active_body["stream_id"] == str(stream_id)
    assert active_body["last_seq"] == 7


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
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="events-other@example.com",
        username="eventsother",
    )

    response = await client.get(
        f"/api/v1/chat/messages/{message.id}/events?after_seq=1",
        headers=headers,
    )
    other_response = await client.get(
        f"/api/v1/chat/messages/{message.id}/events",
        headers=other_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == str(second_event.id)
    assert body[0]["seq"] == 2
    assert body[0]["render_payload"] == {"text": "event-2"}
    assert body[0]["audit_payload"] == {"seq": 2}
    assert other_response.status_code == 404


async def test_permission_response_uses_session_registry_after_chat_access(
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
    resolver = PermissionResolver()

    monkeypatch.setattr(
        chat_endpoint.session_registry,
        "resolve_permission",
        resolver,
    )

    success_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/permissions/request-1/respond",
        data={"option_id": "allow"},
        headers=headers,
    )
    missing_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/permissions/missing/respond",
        data={"option_id": "allow"},
        headers=headers,
    )

    assert success_response.status_code == 200
    assert success_response.json() == {"success": True}
    assert missing_response.status_code == 404
    assert resolver.calls == [
        (str(chat.id), "request-1", "allow"),
        (str(chat.id), "missing", "allow"),
    ]


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


async def test_queue_message_lifecycle(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue_override = QueueServiceOverride()
    send_now_capture = SendNowCapture()

    app.dependency_overrides[get_queue_service] = queue_override
    monkeypatch.setattr(
        ChatStreamRuntime,
        "process_send_now_idle",
        staticmethod(send_now_capture.process_send_now_idle),
    )
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={
            "content": "First queued prompt",
            "model_id": TEST_MODEL_ID,
            "permission_mode": "bypassPermissions",
            "thinking_mode": "high",
            "worktree": "true",
            "plan_mode": "true",
            "selected_persona_name": "Default",
        },
        headers=headers,
    )

    assert create_response.status_code == 201
    queued_id = create_response.json()["id"]

    list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )
    assert list_response.status_code == 200
    queued = list_response.json()
    assert len(queued) == 1
    assert queued[0]["id"] == queued_id
    assert queued[0]["content"] == "First queued prompt"
    assert queued[0]["model_id"] == TEST_MODEL_ID
    assert queued[0]["permission_mode"] == "bypassPermissions"
    assert queued[0]["thinking_mode"] == "high"
    assert queued[0]["worktree"] is True
    assert queued[0]["plan_mode"] is True
    assert queued[0]["selected_persona_name"] == "Default"
    assert queued[0]["attachments"] is None

    update_response = await client.patch(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}",
        json={"content": "Edited queued prompt"},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["content"] == "Edited queued prompt"

    missing_id = UUID("00000000-0000-0000-0000-000000000001")
    missing_update_response = await client.patch(
        f"/api/v1/chat/chats/{chat.id}/queue/{missing_id}",
        json={"content": "Missing prompt"},
        headers=headers,
    )
    missing_delete_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/queue/{missing_id}", headers=headers
    )
    missing_send_now_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{missing_id}/send-now", headers=headers
    )
    send_now_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now", headers=headers
    )

    assert missing_update_response.status_code == 404
    assert missing_delete_response.status_code == 404
    assert missing_send_now_response.status_code == 404
    assert send_now_response.status_code == 204
    assert send_now_capture.chat_ids == [str(chat.id)]

    delete_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}", headers=headers
    )
    final_list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )
    assert delete_response.status_code == 204
    assert final_list_response.status_code == 200
    assert final_list_response.json() == []

    second_create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Second queued prompt", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    clear_response = await client.delete(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )
    cleared_list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )

    assert second_create_response.status_code == 201
    assert clear_response.status_code == 204
    assert cleared_list_response.status_code == 200
    assert cleared_list_response.json() == []


async def test_queue_access_is_limited_to_chat_owner(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    owner_headers, owner, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="queue-owner@example.com",
        username="queueowner",
    )
    chat = await create_chat_row(db_session, owner, workspace)
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="queue-other@example.com",
        username="queueother",
    )

    create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Owner queued prompt", "model_id": TEST_MODEL_ID},
        headers=owner_headers,
    )
    assert create_response.status_code == 201
    queued_id = create_response.json()["id"]

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

    assert other_list_response.status_code == 404
    assert other_update_response.status_code == 404
    assert other_delete_response.status_code == 404
    assert other_send_now_response.status_code == 404
    assert other_clear_response.status_code == 404
    assert owner_list_response.status_code == 200
    assert owner_list_response.json()[0]["content"] == "Owner queued prompt"


async def test_search_chats_returns_matches_and_rejects_blank_query(
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
