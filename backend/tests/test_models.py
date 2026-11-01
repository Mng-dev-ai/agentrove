import pytest
from httpx import AsyncClient

from app.constants import MODELS
from app.models.types import AgentKind
from app.services.acp.adapters import THINKING_MODE_ORDER

from tests.conftest import LoginClient, UserFactory


pytestmark = pytest.mark.anyio


@pytest.fixture
async def auth_headers(
    create_user: UserFactory,
    login: LoginClient,
) -> dict[str, str]:
    await create_user(email="models-user@example.com", username="modelsuser")
    tokens = await login(email="models-user@example.com")
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def test_list_models_exposes_registry_with_ordered_thinking_modes(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get("/api/v1/models/", headers=auth_headers)

    assert response.status_code == 200
    by_id = {item["model_id"]: item for item in response.json()}
    assert by_id.keys() == MODELS.keys()
    for model_id, item in by_id.items():
        info = MODELS[model_id]
        assert item["agent_kind"] == info.agent_kind.value
        assert item["legacy"] is info.legacy
        # The picker renders effort tiers in list order, so they must come
        # back low-to-high regardless of how the registry declares them.
        assert set(item["thinking_modes"]) == set(info.effort_levels)
        assert item["thinking_modes"] == sorted(
            item["thinking_modes"], key=THINKING_MODE_ORDER.index
        )


async def test_list_models_filters_by_agent_kind(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get(
        f"/api/v1/models/?agent_kind={AgentKind.CODEX.value}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body
    assert {item["model_id"] for item in body} == {
        model_id
        for model_id, info in MODELS.items()
        if info.agent_kind == AgentKind.CODEX
    }


async def test_list_models_rejects_invalid_agent_kind(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get(
        "/api/v1/models/?agent_kind=invalid",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid agent_kind: invalid"
