import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.automation import Automation
from app.models.db_models.workspace import Workspace
from app.services.sandbox_providers.base import SandboxProvider

from tests.conftest import LoginClient, UserFactory
from tests.helpers import FakeProviderFactory, create_authenticated_workspace
from tests.test_automations import TEST_MODEL_ID, automation_payload


pytestmark = pytest.mark.anyio


@pytest.fixture
def workspace_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())


@pytest.mark.parametrize("cron_expression", ["0 0 30 2 *", "0 0 * * * 0 2020"])
async def test_create_automation_rejects_cron_without_future_occurrence(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    cron_expression: str,
) -> None:
    headers, _user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.post(
        "/api/v1/automations",
        json=automation_payload(workspace.id, cron_expression=cron_expression),
        headers=headers,
    )

    # 400 from the service, not 422 from the schema: "has a future occurrence"
    # is timezone-dependent, so it is checked where the zone is known.
    assert response.status_code == 400


@pytest.mark.parametrize("cron_expression", ["0 0 30 2 *", "0 0 * * * 0 2020"])
async def test_update_automation_rejects_cron_without_future_occurrence(
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
        json=automation_payload(workspace.id),
        headers=headers,
    )
    automation_id = created.json()["id"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"cron_expression": cron_expression},
        headers=headers,
    )

    assert response.status_code == 400
    unchanged = await client.get("/api/v1/automations", headers=headers)
    assert unchanged.json()[0]["cron_expression"] == "0 9 * * *"


async def test_create_automation_accepts_ordinary_cron(
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
        json=automation_payload(workspace.id, cron_expression="0 9 * * *"),
        headers=headers,
    )

    assert response.status_code == 201
    assert response.json()["cron_expression"] == "0 9 * * *"


@pytest.mark.parametrize("field", ["cron_expression", "timezone", "enabled"])
async def test_update_automation_rejects_explicit_null(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    field: str,
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
        json={field: None},
        headers=headers,
    )

    assert response.status_code == 422


async def test_update_automation_accepts_null_thinking_mode(
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
        json=automation_payload(workspace.id, thinking_mode="think"),
        headers=headers,
    )
    automation_id = created.json()["id"]

    response = await client.patch(
        f"/api/v1/automations/{automation_id}",
        json={"thinking_mode": None},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["thinking_mode"] is None


async def test_update_automation_accepts_empty_payload(
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
        json={},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["cron_expression"] == "0 9 * * *"
    assert response.json()["next_run_at"] == created.json()["next_run_at"]


async def test_delete_workspace_removes_its_automations_only(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    workspace_sandbox: None,
) -> None:
    headers, user, first_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="automation-delete@example.com",
        username="automationdelete",
    )
    second_workspace = Workspace(
        name="Second Workspace",
        user_id=user.id,
        sandbox_id="sandbox-automationdelete-2",
        sandbox_provider="host",
        workspace_path="/tmp/agentrove-test-automationdelete-2",
        source_type="empty",
        source_url=None,
    )
    db_session.add(second_workspace)
    await db_session.commit()
    await db_session.refresh(second_workspace)

    enabled = await client.post(
        "/api/v1/automations",
        json=automation_payload(first_workspace.id, name="Enabled"),
        headers=headers,
    )
    disabled = await client.post(
        "/api/v1/automations",
        json=automation_payload(first_workspace.id, name="Disabled"),
        headers=headers,
    )
    survivor = await client.post(
        "/api/v1/automations",
        json=automation_payload(
            second_workspace.id, name="Survivor", model_id=TEST_MODEL_ID
        ),
        headers=headers,
    )
    assert enabled.status_code == 201
    assert survivor.status_code == 201
    disable_response = await client.patch(
        f"/api/v1/automations/{disabled.json()['id']}",
        json={"enabled": False},
        headers=headers,
    )
    assert disable_response.status_code == 200

    response = await client.delete(
        f"/api/v1/workspaces/{first_workspace.id}", headers=headers
    )

    assert response.status_code == 204
    listed = await client.get("/api/v1/automations", headers=headers)
    assert [item["name"] for item in listed.json()] == ["Survivor"]
    remaining = await db_session.execute(select(Automation.workspace_id))
    assert remaining.scalars().all() == [second_workspace.id]
