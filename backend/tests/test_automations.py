import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_automation_service
from app.db.session import SessionLocal
from app.models.db_models.automation import Automation
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.chat import ChatCreate, ChatRequest
from app.services.automation import AutomationService
from app.services.chat import ChatService
from app.services.exceptions import ChatException
from app.services.sandbox_providers.base import SandboxProvider
from app.services.user import UserService

from tests.conftest import LoginClient, UserFactory
from tests.helpers import FakeProviderFactory, create_authenticated_workspace


pytestmark = pytest.mark.anyio


TEST_MODEL_ID = "opencode:google-vertex/claude-sonnet-4-6@default"


class FakeChatService:
    # Stands in for the chat runtime: starting a completion spawns an agent.
    def __init__(self) -> None:
        self.created_chats: list[ChatCreate] = []
        self.created_chat_ids: list[UUID] = []
        self.completions: list[tuple[ChatRequest, User]] = []
        self.deleted_chats: list[UUID] = []
        self.completion_error: ChatException | None = None

    async def create_chat(self, user: User, chat_data: ChatCreate) -> Chat:
        self.created_chats.append(chat_data)
        chat_id = uuid4()
        self.created_chat_ids.append(chat_id)
        return Chat(
            id=chat_id,
            title=chat_data.title,
            user_id=user.id,
            workspace_id=chat_data.workspace_id,
        )

    async def initiate_chat_completion(self, request: ChatRequest, user: User) -> None:
        if self.completion_error:
            raise self.completion_error
        self.completions.append((request, user))

    async def delete_chat(self, chat_id: UUID, user: User) -> None:
        self.deleted_chats.append(chat_id)


@pytest.fixture
def chat_runtime(app: FastAPI) -> FakeChatService:
    fake = FakeChatService()
    app.dependency_overrides[get_automation_service] = lambda: AutomationService(fake)
    return fake


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


async def create_automation(
    client: AsyncClient, headers: dict[str, str], workspace_id: UUID, **overrides: Any
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace_id, **overrides),
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def add_due_automation(
    db_session: AsyncSession, user: User, workspace: Workspace, **overrides: Any
) -> Automation:
    values: dict[str, Any] = {
        "name": "Due",
        "prompt": "Run me",
        "model_id": TEST_MODEL_ID,
        "cron_expression": "0 9 * * *",
        "timezone": "UTC",
        "next_run_at": datetime.now(timezone.utc) - timedelta(minutes=1),
        **overrides,
    }
    automation = Automation(user_id=user.id, workspace_id=workspace.id, **values)
    db_session.add(automation)
    await db_session.commit()
    await db_session.refresh(automation)
    return automation


async def test_create_automation_persists_and_computes_next_run(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    body = await create_automation(
        client, headers, workspace.id, timezone="America/New_York"
    )

    assert body["name"] == "Nightly digest"
    assert body["workspace_id"] == str(workspace.id)
    assert body["enabled"] is True
    assert body["last_run_at"] is None
    next_run_at = datetime.fromisoformat(body["next_run_at"])
    assert next_run_at > datetime.now(timezone.utc)
    local = next_run_at.astimezone(ZoneInfo("America/New_York"))
    assert (local.hour, local.minute) == (9, 0)
    listed = await client.get("/api/v1/automations", headers=headers)
    assert [item["id"] for item in listed.json()] == [body["id"]]


@pytest.mark.parametrize(
    "overrides",
    [{"cron_expression": "not a cron"}, {"timezone": "Not/AZone"}],
    ids=["cron", "timezone"],
)
async def test_create_automation_rejects_invalid_schedule_syntax(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    overrides: dict[str, str],
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id, **overrides),
        headers=headers,
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "payload",
    [
        {"cron_expression": None},
        {"timezone": None},
        {"enabled": None},
        {"cron_expression": "not a cron"},
        {"timezone": "Not/AZone"},
    ],
    ids=["null-cron", "null-timezone", "null-enabled", "bad-cron", "bad-timezone"],
)
async def test_update_automation_rejects_invalid_fields(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    payload: dict[str, object],
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await create_automation(client, headers, workspace.id)

    response = await client.patch(
        f"/api/v1/automations/{created['id']}", json=payload, headers=headers
    )

    assert response.status_code == 422


@pytest.mark.parametrize("cron_expression", ["0 0 30 2 *", "0 0 * * * 0 2020"])
async def test_cron_without_future_occurrence_is_rejected_on_create_and_update(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    cron_expression: str,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id, cron_expression=cron_expression),
        headers=headers,
    )
    assert created.status_code == 400

    existing = await create_automation(client, headers, workspace.id)
    updated = await client.patch(
        f"/api/v1/automations/{existing['id']}",
        json={"cron_expression": cron_expression},
        headers=headers,
    )
    assert updated.status_code == 400
    listed = await client.get("/api/v1/automations", headers=headers)
    assert [item["cron_expression"] for item in listed.json()] == ["0 9 * * *"]


async def test_unknown_model_is_rejected_on_create_and_update(
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
        json=automation_payload(workspace.id, model_id="not-a-real-model"),
        headers=headers,
    )
    assert created.status_code == 400
    assert created.json()["detail"] == "Unknown model"

    existing = await create_automation(client, headers, workspace.id)
    updated = await client.patch(
        f"/api/v1/automations/{existing['id']}",
        json={"model_id": "not-a-real-model"},
        headers=headers,
    )
    assert updated.status_code == 400
    assert updated.json()["detail"] == "Unknown model"


async def test_automation_cannot_target_another_users_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    _other_headers, _other, other_workspace = await create_authenticated_workspace(
        db_session, create_user, login, email="other@example.com", username="other"
    )

    created = await client.post(
        "/api/v1/automations",
        json=automation_payload(other_workspace.id),
        headers=headers,
    )
    assert created.status_code == 404
    assert created.json()["detail"] == "Workspace not found"

    existing = await create_automation(client, headers, workspace.id)
    moved = await client.patch(
        f"/api/v1/automations/{existing['id']}",
        json={"workspace_id": str(other_workspace.id)},
        headers=headers,
    )
    assert moved.status_code == 404
    assert moved.json()["detail"] == "Workspace not found"


async def test_other_users_cannot_see_modify_run_or_delete_an_automation(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    chat_runtime: FakeChatService,
) -> None:
    owner_headers, _owner, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    intruder_headers, _intruder, _ws = await create_authenticated_workspace(
        db_session, create_user, login, email="intruder@example.com", username="intr"
    )
    created = await create_automation(client, owner_headers, workspace.id)
    path = f"/api/v1/automations/{created['id']}"

    listed = await client.get("/api/v1/automations", headers=intruder_headers)
    assert listed.json() == []
    for method, url, kwargs in [
        ("PATCH", path, {"json": {"name": "Hijacked"}}),
        ("POST", f"{path}/run", {}),
        ("DELETE", path, {}),
    ]:
        response = await client.request(method, url, headers=intruder_headers, **kwargs)
        assert response.status_code == 404, (method, url)
        assert response.json()["detail"] == "Automation not found"

    assert chat_runtime.created_chats == []
    owner_list = await client.get("/api/v1/automations", headers=owner_headers)
    assert owner_list.json()[0]["name"] == "Nightly digest"
    assert owner_list.json()[0]["last_run_at"] is None

    deleted = await client.delete(path, headers=owner_headers)
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/automations", headers=owner_headers)).json() == []


async def test_schedule_changes_recompute_next_run_in_the_new_timezone(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await create_automation(client, headers, workspace.id)

    response = await client.patch(
        f"/api/v1/automations/{created['id']}",
        json={"cron_expression": "30 4 * * *", "timezone": "Asia/Tokyo"},
        headers=headers,
    )

    assert response.status_code == 200
    next_run_at = datetime.fromisoformat(response.json()["next_run_at"])
    assert next_run_at > datetime.now(timezone.utc)
    local = next_run_at.astimezone(ZoneInfo("Asia/Tokyo"))
    assert (local.hour, local.minute) == (4, 30)


async def test_non_schedule_update_keeps_next_run_and_allows_clearing_thinking_mode(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await create_automation(
        client, headers, workspace.id, thinking_mode="think"
    )

    response = await client.patch(
        f"/api/v1/automations/{created['id']}",
        json={"name": "Renamed digest", "thinking_mode": None},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed digest"
    assert body["thinking_mode"] is None
    assert body["next_run_at"] == created["next_run_at"]


async def test_reenabling_skips_slots_missed_while_disabled(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await create_automation(client, headers, workspace.id, enabled=False)
    automation = await db_session.get_one(Automation, UUID(created["id"]))
    automation.next_run_at = datetime.now(timezone.utc) - timedelta(days=3)
    await db_session.commit()

    response = await client.patch(
        f"/api/v1/automations/{created['id']}",
        json={"enabled": True},
        headers=headers,
    )

    assert response.status_code == 200
    assert datetime.fromisoformat(response.json()["next_run_at"]) > datetime.now(
        timezone.utc
    )


async def test_run_automation_starts_chat_and_records_last_run_only(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    chat_runtime: FakeChatService,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await create_automation(client, headers, workspace.id)

    response = await client.post(
        f"/api/v1/automations/{created['id']}/run", headers=headers
    )

    assert response.status_code == 200
    assert UUID(response.json()["chat_id"]) == chat_runtime.created_chat_ids[0]
    [chat_data] = chat_runtime.created_chats
    assert chat_data.workspace_id == workspace.id
    assert chat_data.model_id == TEST_MODEL_ID
    assert chat_data.title.startswith("Nightly digest · ")
    [(request, _)] = chat_runtime.completions
    assert request.prompt == "Summarize today's changes"
    assert request.chat_id == chat_runtime.created_chat_ids[0]
    [listed] = (await client.get("/api/v1/automations", headers=headers)).json()
    assert listed["last_run_at"] is not None
    assert listed["next_run_at"] == created["next_run_at"]


async def test_run_automation_failure_returns_error_and_deletes_orphan_chat(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    chat_runtime: FakeChatService,
) -> None:
    chat_runtime.completion_error = ChatException(
        "Provider unavailable", status_code=503
    )
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    created = await create_automation(client, headers, workspace.id)

    response = await client.post(
        f"/api/v1/automations/{created['id']}/run", headers=headers
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Provider unavailable"
    assert chat_runtime.deleted_chats == chat_runtime.created_chat_ids


async def test_due_automation_fires_once_and_advances_schedule(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    automation = await add_due_automation(db_session, user, workspace)
    chat_runtime = FakeChatService()
    service = AutomationService(chat_runtime)

    await service.run_due_automations()
    await service.run_due_automations()

    assert [request.prompt for request, _ in chat_runtime.completions] == ["Run me"]
    await db_session.refresh(automation)
    assert automation.next_run_at > datetime.now(timezone.utc)
    assert automation.last_run_at is not None


async def test_concurrent_dispatchers_fire_a_due_slot_once(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    await add_due_automation(db_session, user, workspace)
    chat_runtime = FakeChatService()

    await asyncio.gather(
        AutomationService(chat_runtime).run_due_automations(),
        AutomationService(chat_runtime).run_due_automations(),
    )

    assert len(chat_runtime.completions) == 1


async def test_due_automation_with_uncomputable_schedule_is_disabled_without_blocking_others(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    poison = await add_due_automation(
        db_session,
        user,
        workspace,
        prompt="Never runs",
        cron_expression="0 0 * * * 0 2020",
        next_run_at=datetime.now(timezone.utc) - timedelta(minutes=2),
    )
    await add_due_automation(db_session, user, workspace, prompt="Runs once")
    chat_runtime = FakeChatService()

    await AutomationService(chat_runtime).run_due_automations()

    await db_session.refresh(poison)
    assert poison.enabled is False
    assert [request.prompt for request, _ in chat_runtime.completions] == ["Runs once"]


async def test_due_automation_is_disabled_when_its_workspace_was_deleted(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    automation = await add_due_automation(db_session, user, workspace)
    workspace.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()
    chats = ChatService(UserService(SessionLocal), session_factory=SessionLocal)

    await AutomationService(chats, session_factory=SessionLocal).run_due_automations()

    await db_session.refresh(automation)
    assert automation.enabled is False
    assert (await db_session.scalars(select(Chat))).all() == []


async def test_due_automation_start_failure_deletes_orphan_chat_but_stays_enabled(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    _headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    automation = await add_due_automation(db_session, user, workspace)
    chat_runtime = FakeChatService()
    chat_runtime.completion_error = ChatException(
        "Provider unavailable", status_code=503
    )

    await AutomationService(chat_runtime).run_due_automations()

    assert len(chat_runtime.created_chat_ids) == 1
    assert chat_runtime.deleted_chats == chat_runtime.created_chat_ids
    await db_session.refresh(automation)
    assert automation.enabled is True
    assert automation.next_run_at > datetime.now(timezone.utc)


@pytest.mark.parametrize(
    ("cron_expression", "base", "expected"),
    [
        (
            "30 1 * * *",
            datetime(2026, 6, 1, 0, 0, tzinfo=ZoneInfo("America/New_York")),
            datetime(2026, 6, 1, 5, 30, tzinfo=timezone.utc),
        ),
        (
            "30 1 * * *",
            datetime(2026, 11, 1, 1, 35, tzinfo=ZoneInfo("America/New_York")),
            datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc),
        ),
        (
            "* * * * *",
            datetime(2026, 11, 1, 1, 59, 30, tzinfo=ZoneInfo("America/New_York")),
            datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc),
        ),
    ],
    ids=["normal-day", "fall-back-daily", "fall-back-every-minute"],
)
def test_compute_next_run_fires_each_wall_clock_slot_once(
    cron_expression: str, base: datetime, expected: datetime
) -> None:
    assert (
        AutomationService.compute_next_run(cron_expression, "America/New_York", base)
        == expected
    )


async def test_delete_workspace_removes_its_automations_only(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())
    headers, user, first_workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    second_workspace = Workspace(
        name="Second Workspace",
        user_id=user.id,
        sandbox_id="sandbox-second",
        sandbox_provider="host",
        workspace_path=str(tmp_path / "second"),
        source_type="empty",
    )
    db_session.add(second_workspace)
    await db_session.commit()
    await create_automation(client, headers, first_workspace.id, name="Enabled")
    await create_automation(
        client, headers, first_workspace.id, name="Disabled", enabled=False
    )
    await create_automation(client, headers, second_workspace.id, name="Survivor")

    response = await client.delete(
        f"/api/v1/workspaces/{first_workspace.id}", headers=headers
    )

    assert response.status_code == 204
    listed = await client.get("/api/v1/automations", headers=headers)
    assert [item["name"] for item in listed.json()] == ["Survivor"]
    remaining = await db_session.scalars(select(Automation.workspace_id))
    assert remaining.all() == [second_workspace.id]
