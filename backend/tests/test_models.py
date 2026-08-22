import pytest
from httpx import AsyncClient

from app.constants import MODELS
from app.services.acp.adapters import AgentKind

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


async def test_list_models_returns_registered_models(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get("/api/v1/models/", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert len(body) == len(MODELS)
    model_ids = {item["model_id"] for item in body}
    assert model_ids == set(MODELS)
    assert {
        "model_id": "haiku",
        "name": MODELS["haiku"].display_name,
        "agent_kind": MODELS["haiku"].agent_kind.value,
        "context_window": MODELS["haiku"].context_window,
        # Haiku has no effort dial in claude-agent-acp (supportsEffort false).
        "thinking_modes": [],
    } in body
    by_id = {item["model_id"]: item for item in body}
    assert by_id["sonnet"]["thinking_modes"] == ["low", "medium", "high", "max"]
    assert by_id["claude-fable-5"]["thinking_modes"] == [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    ]
    assert by_id["claude-opus-5"]["thinking_modes"] == [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    ]
    assert by_id["copilot:gpt-5.4"]["thinking_modes"] == [
        "low",
        "medium",
        "high",
        "xhigh",
    ]
    assert by_id["copilot:kimi-k3"]["thinking_modes"] == ["low", "high", "max"]
    assert by_id["copilot:claude-haiku-4.5"]["thinking_modes"] == []
    assert by_id["grok:grok-4.5"]["thinking_modes"] == ["low", "medium", "high"]
    assert by_id["grok:grok-4.6"]["thinking_modes"] == [
        "low",
        "medium",
        "high",
        "xhigh",
    ]
    assert by_id["antigravity:gemini-3.7-flash"]["thinking_modes"] == [
        "low",
        "medium",
        "high",
    ]
    assert by_id["antigravity:gemini-3.6-flash"]["thinking_modes"] == [
        "low",
        "medium",
        "high",
    ]
    assert by_id["antigravity:gemini-3.5-flash"]["thinking_modes"] == [
        "low",
        "medium",
        "high",
    ]
    assert by_id["antigravity:gemini-3.1-pro"]["thinking_modes"] == ["low", "high"]
    assert by_id["cursor:auto"]["thinking_modes"] == []


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
    assert {item["agent_kind"] for item in body} == {AgentKind.CODEX.value}
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


async def test_models_reject_missing_token(client: AsyncClient) -> None:
    response = await client.get("/api/v1/models/")

    assert response.status_code == 401
