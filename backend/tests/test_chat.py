import asyncio
from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import chat as chat_endpoint
from app.constants import MODELS, REDIS_KEY_CHAT_CONTEXT_USAGE
from app.core.deps import get_agent_service, get_chat_service, get_queue_service
from app.models.db_models.chat import Chat, ChatCheckpoint, Message, MessageEvent
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.chat import (
    ChatCreate,
    ChatRequest,
    ChatSearchResponse,
    ChatUpdate,
)
from app.services import chat as chat_service_module
from app.services.db import SessionFactoryType
from app.services.exceptions import AgentException, ChatException, SandboxException
from app.services.queue import QueueService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.streaming.runtime import ChatStreamRuntime
from app.utils.cache import CacheError, MemoryStore

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


class ProcessSendNowIdleFailure:
    async def process_send_now_idle(
        self, chat_id: str, _session_factory: SessionFactoryType
    ) -> bool:
        raise RuntimeError("idle send-now boom")


class CancelGenerationCapture:
    def __init__(self) -> None:
        self.chat_ids: list[str] = []

    async def __call__(self, chat_id: str) -> None:
        self.chat_ids.append(chat_id)


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
        self.ask_code_calls: list[tuple[str, str, str | None, str, User, Chat]] = []
        self.title_calls: list[tuple[str, User, Chat | None]] = []
        self.fail = False
        self.next_title: str | None = "Generated Title"

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
        file_path: str | None,
        language: str | None,
        start_line: int | None,
        end_line: int | None,
        model_id: str,
        user: User,
        chat: Chat,
    ) -> str:
        self.ask_code_calls.append((question, code, file_path, model_id, user, chat))
        if self.fail:
            raise AgentException("Ask failed", status_code=503)
        return "Answer: " + question

    async def generate_title(
        self, prompt: str, user: User, chat: Chat | None = None
    ) -> str | None:
        self.title_calls.append((prompt, user, chat))
        return self.next_title


class RaisingChatService:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    async def __call__(self) -> AsyncIterator["RaisingChatService"]:
        yield self

    async def create_chat(self, user: User, chat_data: ChatCreate) -> Chat:
        raise self.exc

    async def search_messages(
        self, user: User, query: str, *, limit: int = 50, per_chat_limit: int = 5
    ) -> ChatSearchResponse:
        raise self.exc

    async def get_sub_threads(self, chat_id: UUID, user: User) -> list[Chat]:
        raise self.exc

    async def get_chat(self, chat_id: UUID, user: User) -> Chat:
        raise self.exc

    async def update_chat(
        self, chat_id: UUID, chat_update: ChatUpdate, user: User
    ) -> Chat:
        raise self.exc


class RaisingMessageService:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    async def get_in_progress_assistant_message(self, chat_id: UUID) -> Message:
        raise self.exc


class StreamStatusServiceOverride:
    # Real Chat row + failing in-progress lookup → SQLAlchemyError branch.
    def __init__(self, chat: Chat, exc: Exception) -> None:
        self._chat = chat
        self.message_service = RaisingMessageService(exc)

    async def __call__(self) -> AsyncIterator["StreamStatusServiceOverride"]:
        yield self

    async def get_chat(self, chat_id: UUID, user: User) -> Chat:
        return self._chat


class WriteFailingSandboxProvider(FakeSandboxProvider):
    async def write_file(
        self, sandbox_id: str, path: str, content: str | bytes
    ) -> None:
        raise SandboxException("disk full", status_code=400)


class RaisingCacheConnection:
    # Stands in for app.services.chat.cache_connection so the best-effort
    # chat-event publish hits its CacheError branch without a real Redis.
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
            "base_branch": " main ",
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
    assert request.base_branch == "main"
    assert request.selected_persona_name == "Builder"
    assert request.attached_files is not None
    assert request.attached_files[0].filename == "note.txt"
    assert [stored_user.id for stored_user in chat_service.users] == [user.id]


async def test_send_message_endpoint_validates_base_branch_before_starting_turn(
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
    request_data = {
        "prompt": "Ship this",
        "chat_id": str(chat.id),
        "model_id": TEST_MODEL_ID,
        "worktree": "true",
    }

    invalid_response = await client.post(
        "/api/v1/chat/chat",
        data={**request_data, "base_branch": "a b"},
        headers=headers,
    )

    assert invalid_response.status_code == 422
    assert chat_service.requests == []

    blank_response = await client.post(
        "/api/v1/chat/chat",
        data={**request_data, "base_branch": ""},
        headers=headers,
    )

    assert blank_response.status_code == 200
    assert chat_service.requests[0].base_branch is None


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

    # Chat-page text selections omit the location fields entirely.
    text_payload = {
        "question": "Summarize this",
        "code": "The deploy failed because the token expired.",
        "model_id": TEST_MODEL_ID,
    }
    text_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/ask-code", json=text_payload, headers=headers
    )
    assert text_response.status_code == 200
    assert text_response.json() == {"answer": "Answer: Summarize this"}
    assert agent_service.ask_code_calls[-1][2] is None

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
        "pending_elicitations": [],
    }
    assert active_response.status_code == 200
    active_body = active_response.json()
    assert active_body["has_active_task"] is True
    assert active_body["message_id"] == str(message.id)
    assert active_body["stream_id"] == str(stream_id)
    assert active_body["last_seq"] == 7
    assert active_body["pending_elicitations"] == []


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
            "base_branch": " main ",
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
    assert queued[0]["base_branch"] == "main"
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

    # The chat_created broadcast is best-effort — a cache outage must not
    # block chat creation.
    assert response.status_code == 201
    assert response.json()["title"] == "Best Effort"


async def test_create_chat_endpoint_translates_database_and_cache_errors(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    payload = {
        "title": "New Chat",
        "model_id": TEST_MODEL_ID,
        "workspace_id": str(workspace.id),
    }

    app.dependency_overrides[get_chat_service] = RaisingChatService(
        SQLAlchemyError("db down")
    )
    db_error_response = await client.post(
        "/api/v1/chat/chats", json=payload, headers=headers
    )

    app.dependency_overrides[get_chat_service] = RaisingChatService(
        CacheError("redis down")
    )
    cache_error_response = await client.post(
        "/api/v1/chat/chats", json=payload, headers=headers
    )

    assert db_error_response.status_code == 500
    assert db_error_response.json()["detail"] == "Database error while creating chat"
    assert cache_error_response.status_code == 503
    assert cache_error_response.json()["detail"] == "Service temporarily unavailable"


async def test_generate_chat_title_endpoint_covers_success_and_failure_paths(
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
    await create_message_row(db_session, chat, content="Ship the release notes")
    await create_message_row(
        db_session,
        chat,
        content="",
        role=MessageRole.ASSISTANT,
        model_id=TEST_MODEL_ID,
    )

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
    assert failure_response.status_code == 503
    assert failure_response.json()["detail"] == "Title generation failed"
    [prompt, stored_user, stored_chat] = agent_service.title_calls[0]
    assert prompt == "Ship the release notes"
    assert stored_user.id == user.id
    assert stored_chat is not None
    assert stored_chat.id == chat.id


async def test_search_chats_endpoint_translates_database_error(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    app.dependency_overrides[get_chat_service] = RaisingChatService(
        SQLAlchemyError("db down")
    )

    response = await client.get("/api/v1/chat/chats/search?q=needle", headers=headers)

    assert response.status_code == 500
    assert response.json()["detail"] == "Database error while searching chats"


async def test_get_active_streams_returns_empty_and_populated_results(
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

    monkeypatch.setattr(ChatStreamRuntime, "active_chat_ids", lambda: set())
    empty_response = await client.get(
        "/api/v1/chat/chats/active-streams", headers=headers
    )

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
    monkeypatch.setattr(ChatStreamRuntime, "active_chat_ids", lambda: {str(chat.id)})
    populated_response = await client.get(
        "/api/v1/chat/chats/active-streams", headers=headers
    )

    assert empty_response.status_code == 200
    assert empty_response.json() == []
    assert populated_response.status_code == 200
    [status_entry] = populated_response.json()
    assert status_entry["chat_id"] == str(chat.id)
    assert status_entry["message_id"] == str(message.id)
    assert status_entry["stream_id"] == str(stream_id)
    assert status_entry["last_seq"] == 3


async def test_get_sub_threads_endpoint_handles_missing_chat_and_database_error(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    missing_response = await client.get(
        f"/api/v1/chat/chats/{uuid4()}/sub-threads", headers=headers
    )

    app.dependency_overrides[get_chat_service] = RaisingChatService(
        SQLAlchemyError("db down")
    )
    db_error_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/sub-threads", headers=headers
    )

    assert missing_response.status_code == 404
    assert missing_response.json()["detail"] == "Chat not found"
    assert db_error_response.status_code == 500
    assert (
        db_error_response.json()["detail"]
        == "Database error while retrieving sub-threads"
    )


async def test_get_chat_detail_endpoint_translates_database_error(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    app.dependency_overrides[get_chat_service] = RaisingChatService(
        SQLAlchemyError("db down")
    )

    response = await client.get(f"/api/v1/chat/chats/{uuid4()}", headers=headers)

    assert response.status_code == 500
    assert response.json()["detail"] == "Database error while retrieving chat"


async def test_update_chat_endpoint_rejects_missing_chat_and_translates_database_error(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    missing_response = await client.patch(
        f"/api/v1/chat/chats/{uuid4()}",
        json={"title": "Ghost"},
        headers=headers,
    )

    app.dependency_overrides[get_chat_service] = RaisingChatService(
        SQLAlchemyError("db down")
    )
    db_error_response = await client.patch(
        f"/api/v1/chat/chats/{uuid4()}",
        json={"title": "Ghost"},
        headers=headers,
    )

    assert missing_response.status_code == 404
    assert (
        missing_response.json()["detail"]
        == "Chat not found or you don't have permission to update it"
    )
    assert db_error_response.status_code == 500
    assert db_error_response.json()["detail"] == "Database error while updating chat"


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
    # Marking viewed then updating shouldn't flip the chat back to unread —
    # confirms the read-state carry-through in ChatService.update_chat.
    assert updated["unread"] is False


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

    # per-chat truncation: one chat with 2 matches but per_chat_limit=1.
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


async def test_create_chat_rejects_missing_or_foreign_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/chat/chats",
        json={
            "title": "No Workspace",
            "model_id": TEST_MODEL_ID,
            "workspace_id": str(uuid4()),
        },
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Workspace not found"


async def test_delete_chat_rejects_missing_chat_and_cascades_sub_threads_and_workspace(
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

    missing_response = await client.delete(
        f"/api/v1/chat/chats/{uuid4()}", headers=headers
    )

    parent = await create_chat_row(db_session, user, workspace, title="Parent")
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

    delete_response = await client.delete(
        f"/api/v1/chat/chats/{parent.id}", headers=headers
    )
    sub_thread_detail = await client.get(
        f"/api/v1/chat/chats/{sub_thread_id}", headers=headers
    )

    assert missing_response.status_code == 404
    assert sub_create.status_code == 201
    assert delete_response.status_code == 204
    # Deleting the parent must cascade-delete its sub-thread too.
    assert sub_thread_detail.status_code == 404


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


async def test_cancel_stream_endpoint_only_cancels_when_turn_alive(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    idle_chat = await create_chat_row(db_session, user, workspace, title="Idle")
    pending_chat = await create_chat_row(db_session, user, workspace, title="Pending")

    capture = CancelGenerationCapture()
    monkeypatch.setattr(chat_endpoint.session_registry, "cancel_generation", capture)
    released_reservation = asyncio.Event()
    released_reservation.set()
    monkeypatch.setitem(
        ChatStreamRuntime._starting_chat_ids,
        str(pending_chat.id),
        released_reservation,
    )

    idle_response = await client.delete(
        f"/api/v1/chat/chats/{idle_chat.id}/stream", headers=headers
    )
    pending_response = await client.delete(
        f"/api/v1/chat/chats/{pending_chat.id}/stream", headers=headers
    )

    assert idle_response.status_code == 204
    assert pending_response.status_code == 204
    # Idle must not cancel (a stray pending-cancel flag could kill the next
    # turn); a reserved start should, even with no task registered yet.
    assert capture.chat_ids == [str(pending_chat.id)]


async def test_queue_message_with_attachments_saves_to_sandbox(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = FakeSandboxProvider()
    monkeypatch.setattr(
        SandboxProvider, "create_provider", FakeProviderFactory(provider=provider)
    )
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Review this", "model_id": TEST_MODEL_ID},
        files={"attached_files": ("report.pdf", b"%PDF-1.4", "application/pdf")},
        headers=headers,
    )
    list_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )

    assert create_response.status_code == 201
    assert list_response.status_code == 200
    queued = list_response.json()
    assert len(queued) == 1
    [attachment] = queued[0]["attachments"]
    assert attachment["filename"] == "report.pdf"
    assert attachment["file_type"] == "pdf"
    assert attachment["file_url"].startswith("/api/v1/attachments/temp/preview?path=")
    assert len(provider.writes) == 1
    sandbox_id, path, _content = provider.writes[0]
    assert sandbox_id == workspace.sandbox_id
    assert path.endswith(".pdf")


async def test_send_now_queued_message_cancels_active_stream_and_handles_idle_failure(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    first_create = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "First", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    first_id = first_create.json()["id"]

    capture = CancelGenerationCapture()
    monkeypatch.setattr(chat_endpoint.session_registry, "cancel_generation", capture)
    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", lambda _chat_id: True)

    active_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{first_id}/send-now", headers=headers
    )

    second_create = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Second", "model_id": TEST_MODEL_ID},
        headers=headers,
    )
    second_id = second_create.json()["id"]

    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", lambda _chat_id: False)
    monkeypatch.setattr(
        ChatStreamRuntime,
        "process_send_now_idle",
        staticmethod(ProcessSendNowIdleFailure().process_send_now_idle),
    )

    idle_failure_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{second_id}/send-now", headers=headers
    )

    assert active_response.status_code == 204
    assert capture.chat_ids == [str(chat.id)]
    assert idle_failure_response.status_code == 503
    assert (
        idle_failure_response.json()["detail"] == "Failed to start send-now execution"
    )


async def test_get_message_events_returns_404_for_missing_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/chat/messages/{uuid4()}/events", headers=headers
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Message not found"


async def test_get_stream_status_handles_access_denied_and_missing_active_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_headers, owner, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="stream-status-owner@example.com",
        username="streamstatusowner",
    )
    chat = await create_chat_row(db_session, owner, workspace)
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="stream-status-other@example.com",
        username="streamstatusother",
    )

    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", lambda _chat_id: True)

    denied_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=other_headers
    )
    no_message_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/status", headers=owner_headers
    )

    assert denied_response.status_code == 404
    assert denied_response.json()["detail"] == "Chat not found or access denied"
    assert no_message_response.status_code == 200
    assert no_message_response.json() == {
        "has_active_task": False,
        "message_id": None,
        "stream_id": None,
        "last_seq": 0,
        "pending_elicitations": [],
    }


async def test_get_stream_status_translates_database_error(
    app: FastAPI,
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
    monkeypatch.setattr(ChatStreamRuntime, "has_active_chat", lambda _chat_id: True)
    app.dependency_overrides[get_chat_service] = StreamStatusServiceOverride(
        chat, SQLAlchemyError("db down")
    )

    response = await client.get(f"/api/v1/chat/chats/{chat.id}/status", headers=headers)

    assert response.status_code == 500
    assert response.json()["detail"] == "Database error while checking chat status"


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


async def test_send_now_during_reserved_start_cancels_current_turn(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue_override = QueueServiceOverride()
    send_now_capture = SendNowCapture()
    cancel_capture = CancelGenerationCapture()

    app.dependency_overrides[get_queue_service] = queue_override
    monkeypatch.setattr(
        ChatStreamRuntime,
        "process_send_now_idle",
        staticmethod(send_now_capture.process_send_now_idle),
    )
    monkeypatch.setattr(
        chat_endpoint.session_registry, "cancel_generation", cancel_capture
    )
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)
    monkeypatch.setitem(
        ChatStreamRuntime._starting_chat_ids, str(chat.id), asyncio.Event()
    )

    create_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={
            "content": "Queued during reserved start",
            "model_id": TEST_MODEL_ID,
            "permission_mode": "bypassPermissions",
            "selected_persona_name": "Default",
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    queued_id = create_response.json()["id"]

    send_now_response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue/{queued_id}/send-now", headers=headers
    )

    assert send_now_response.status_code == 204
    # A reserved start must take the cancel branch: the flag interrupts the
    # starting turn, whose INTERRUPTED path picks the message up. The idle
    # path would lose the reservation race and strand the send-now flag.
    assert cancel_capture.chat_ids == [str(chat.id)]
    assert send_now_capture.chat_ids == []
