from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_automation_service
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.models.schemas.chat import ChatCreate, ChatRequest
from app.services.automation import AutomationService
from app.services.exceptions import ChatException

from tests.conftest import LoginClient, UserFactory
from tests.helpers import create_authenticated_workspace


pytestmark = pytest.mark.anyio


TEST_MODEL_ID = "opencode:google-vertex-anthropic/claude-sonnet-4-5@20250929"


class FakeChatService:
    def __init__(self) -> None:
        self.created_chats: list[ChatCreate] = []
        self.completions: list[tuple[ChatRequest, User]] = []
        self.completion_error: ChatException | None = None

    async def create_chat(self, user: User, chat_data: ChatCreate) -> Chat:
        self.created_chats.append(chat_data)
        return Chat(
            id=uuid4(),
            title=chat_data.title,
            user_id=user.id,
            workspace_id=chat_data.workspace_id,
        )

    async def initiate_chat_completion(self, request: ChatRequest, user: User) -> None:
        if self.completion_error:
            raise self.completion_error
        self.completions.append((request, user))


class AutomationServiceOverride:
    def __init__(self, chat_service: FakeChatService) -> None:
        self.chat_service = chat_service

    def __call__(self) -> AutomationService:
        return AutomationService(self.chat_service)


def automation_payload(workspace_id: UUID, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "Nightly digest",
        "prompt": "Summarize today's changes",
        "model_id": TEST_MODEL_ID,
        "cron_expression": "0 9 * * *",
        "timezone": "UTC",
        "workspace_id": str(workspace_id),
    }
    payload.update(overrides)
    return payload


async def test_create_automation_persists_and_computes_next_run(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Nightly digest"
    assert body["workspace_id"] == str(workspace.id)
    assert body["cron_expression"] == "0 9 * * *"
    assert body["enabled"] is True
    assert body["last_run_at"] is None
    next_run_at = datetime.fromisoformat(body["next_run_at"])
    assert next_run_at > datetime.now(timezone.utc)


async def test_create_automation_rejects_unknown_model(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id, model_id="not-a-real-model"),
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown model"


async def test_create_automation_rejects_workspace_not_owned(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _owner_headers, _owner, other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="owner-workspace@example.com",
        username="ownerworkspace",
    )
    (
        intruder_headers,
        _intruder,
        _intruder_workspace,
    ) = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="intruder@example.com",
        username="intruder",
    )

    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(other_workspace.id),
        headers=intruder_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Workspace not found"


async def test_create_automation_rejects_invalid_cron_expression(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id, cron_expression="not a cron"),
        headers=headers,
    )

    assert response.status_code == 422


async def test_create_automation_rejects_invalid_timezone(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id, timezone="Not/AZone"),
        headers=headers,
    )

    assert response.status_code == 422


async def test_automations_reject_missing_token(client: AsyncClient) -> None:
    response = await client.get("/api/v1/automations")

    assert response.status_code == 401


async def test_list_automations_scoped_to_owner(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    owner_headers, _owner, owner_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="list-owner@example.com",
        username="listowner",
    )
    other_headers, _other, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="list-other@example.com",
        username="listother",
    )
    create_response = await client.post(
        "/api/v1/automations",
        json=automation_payload(owner_workspace.id),
        headers=owner_headers,
    )
    assert create_response.status_code == 201

    owner_list = await client.get("/api/v1/automations", headers=owner_headers)
    other_list = await client.get("/api/v1/automations", headers=other_headers)

    assert owner_list.status_code == 200
    assert len(owner_list.json()) == 1
    assert owner_list.json()[0]["name"] == "Nightly digest"
    assert other_list.status_code == 200
    assert other_list.json() == []


async def test_update_automation_recomputes_next_run_on_cron_change(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]
    original_next_run = created.json()["next_run_at"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"cron_expression": "30 4 * * *"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["cron_expression"] == "30 4 * * *"
    assert body["next_run_at"] != original_next_run


async def test_update_automation_preserves_next_run_for_non_schedule_field(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]
    original_next_run = created.json()["next_run_at"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"name": "Renamed digest"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed digest"
    assert body["next_run_at"] == original_next_run


async def test_update_automation_rejects_invalid_timezone(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"timezone": "Not/AZone"},
        headers=headers,
    )

    assert response.status_code == 422


async def test_update_automation_rejects_unknown_model(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"model_id": "not-a-real-model"},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown model"


async def test_update_automation_rejects_workspace_not_owned(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="update-owner@example.com",
        username="updateowner",
    )
    _other_headers, _other, other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="update-other@example.com",
        username="updateother",
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"workspace_id": str(other_workspace.id)},
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Workspace not found"


async def test_update_automation_rejects_other_users_automation(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    owner_headers, _owner, owner_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="patch-owner@example.com",
        username="patchowner",
    )
    (
        intruder_headers,
        _intruder,
        _intruder_workspace,
    ) = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="patch-intruder@example.com",
        username="patchintruder",
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(owner_workspace.id),
        headers=owner_headers,
    )
    automation_id = created.json()["id"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"name": "Hijacked"},
        headers=intruder_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Automation not found"


async def test_delete_automation_removes_row_and_rejects_other_users(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    owner_headers, _owner, owner_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="delete-owner@example.com",
        username="deleteowner",
    )
    (
        intruder_headers,
        _intruder,
        _intruder_workspace,
    ) = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="delete-intruder@example.com",
        username="deleteintruder",
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(owner_workspace.id),
        headers=owner_headers,
    )
    automation_id = created.json()["id"]

    intruder_delete = await client.delete(
        f"/api/v1/automations/{automation_id}", headers=intruder_headers
    )
    owner_delete = await client.delete(
        f"/api/v1/automations/{automation_id}", headers=owner_headers
    )
    owner_list_after = await client.get("/api/v1/automations", headers=owner_headers)

    assert intruder_delete.status_code == 404
    assert owner_delete.status_code == 204
    assert owner_list_after.json() == []


async def test_run_automation_creates_chat_and_updates_last_run_at(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    fake_chat_service = FakeChatService()
    app.dependency_overrides[get_automation_service] = AutomationServiceOverride(
        fake_chat_service
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]
    assert created.json()["last_run_at"] is None

    response = await client.post(
        f"/api/v1/automations/{automation_id}/run", headers=headers
    )

    assert response.status_code == 200
    assert UUID(response.json()["chat_id"])
    assert len(fake_chat_service.created_chats) == 1
    assert fake_chat_service.created_chats[0].workspace_id == workspace.id
    assert fake_chat_service.created_chats[0].model_id == TEST_MODEL_ID
    assert len(fake_chat_service.completions) == 1
    assert fake_chat_service.completions[0][0].prompt == "Summarize today's changes"

    list_after = await client.get("/api/v1/automations", headers=headers)
    assert list_after.json()[0]["last_run_at"] is not None


async def test_run_automation_rejects_other_users_automation(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    fake_chat_service = FakeChatService()
    app.dependency_overrides[get_automation_service] = AutomationServiceOverride(
        fake_chat_service
    )
    owner_headers, _owner, owner_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="run-owner@example.com",
        username="runowner",
    )
    (
        intruder_headers,
        _intruder,
        _intruder_workspace,
    ) = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="run-intruder@example.com",
        username="runintruder",
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(owner_workspace.id),
        headers=owner_headers,
    )
    automation_id = created.json()["id"]

    response = await client.post(
        f"/api/v1/automations/{automation_id}/run", headers=intruder_headers
    )

    assert response.status_code == 404
    assert fake_chat_service.created_chats == []


async def test_run_automation_translates_chat_completion_error(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    fake_chat_service = FakeChatService()
    fake_chat_service.completion_error = ChatException(
        "Provider unavailable", status_code=503
    )
    app.dependency_overrides[get_automation_service] = AutomationServiceOverride(
        fake_chat_service
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]

    response = await client.post(
        f"/api/v1/automations/{automation_id}/run", headers=headers
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Provider unavailable"
