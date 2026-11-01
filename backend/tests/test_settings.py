import pytest
from httpx import AsyncClient
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import settings as settings_endpoint
from app.models.db_models.user import User, UserSettings
from app.utils.cache import MemoryStore

from tests.conftest import LoginClient, UserFactory
from tests.helpers import EndpointCache


pytestmark = pytest.mark.anyio


@pytest.fixture
def settings_cache(monkeypatch: pytest.MonkeyPatch) -> EndpointCache:
    cache = EndpointCache()
    monkeypatch.setattr(settings_endpoint, "cache_connection", cache.connect)
    return cache


@pytest.fixture
async def user(create_user: UserFactory) -> User:
    return await create_user(email="settings@example.com", username="settingsuser")


@pytest.fixture
async def headers(user: User, login: LoginClient) -> dict[str, str]:
    tokens = await login(email="settings@example.com")
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def read_stored_github_token(db_session: AsyncSession, user: User) -> str:
    result = await db_session.execute(
        text(
            "SELECT github_personal_access_token FROM user_settings "
            "WHERE user_id = :user_id"
        ),
        {"user_id": user.id.hex},
    )
    return str(result.scalar_one())


async def test_get_settings_returns_current_user_settings(
    client: AsyncClient,
    user: User,
    headers: dict[str, str],
    settings_cache: EndpointCache,
) -> None:
    response = await client.get("/api/v1/settings/", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == str(user.id)
    assert body["github_personal_access_token"] is None
    assert body["custom_instructions"] is None
    assert body["custom_env_vars"] is None
    assert body["personas"] is None
    assert body["notifications_enabled"] is True


async def test_patch_settings_updates_persistence_and_invalidates_cache(
    client: AsyncClient,
    headers: dict[str, str],
    settings_cache: EndpointCache,
) -> None:
    payload = {
        "github_personal_access_token": "ghp_testtoken",
        "custom_instructions": "Prefer concise answers.",
        "custom_env_vars": [{"key": "API_MODE", "value": "test"}],
        "personas": [{"name": "Reviewer", "content": "Review carefully."}],
        "notifications_enabled": False,
    }
    cached_response = await client.get("/api/v1/settings/", headers=headers)
    assert cached_response.status_code == 200

    response = await client.patch("/api/v1/settings/", json=payload, headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["github_personal_access_token"] == "ghp_testtoken"
    assert body["custom_instructions"] == "Prefer concise answers."
    assert body["custom_env_vars"] == [{"key": "API_MODE", "value": "test"}]
    assert body["personas"] == [{"name": "Reviewer", "content": "Review carefully."}]
    assert body["notifications_enabled"] is False

    get_response = await client.get("/api/v1/settings/", headers=headers)
    assert get_response.status_code == 200
    assert get_response.json()["custom_instructions"] == "Prefer concise answers."


async def test_github_token_is_encrypted_at_rest(
    client: AsyncClient,
    user: User,
    headers: dict[str, str],
    db_session: AsyncSession,
    settings_cache: EndpointCache,
) -> None:
    response = await client.patch(
        "/api/v1/settings/",
        json={"github_personal_access_token": "ghp_secret_value"},
        headers=headers,
    )

    assert response.status_code == 200
    stored = await read_stored_github_token(db_session, user)
    assert "ghp_secret_value" not in stored
    settings_cache.store = MemoryStore()
    get_response = await client.get("/api/v1/settings/", headers=headers)
    assert get_response.json()["github_personal_access_token"] == "ghp_secret_value"


async def test_patch_settings_leaves_omitted_fields_untouched(
    client: AsyncClient,
    headers: dict[str, str],
    settings_cache: EndpointCache,
) -> None:
    # Fields with schema defaults (notifications_enabled=True) must not be
    # reset when a client PATCHes an unrelated field.
    await client.patch(
        "/api/v1/settings/",
        json={
            "github_personal_access_token": "ghp_keep",
            "notifications_enabled": False,
        },
        headers=headers,
    )

    response = await client.patch(
        "/api/v1/settings/",
        json={"custom_instructions": "Only this changes."},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["custom_instructions"] == "Only this changes."
    assert body["github_personal_access_token"] == "ghp_keep"
    assert body["notifications_enabled"] is False


async def test_patch_settings_normalizes_string_json_lists(
    client: AsyncClient,
    headers: dict[str, str],
    settings_cache: EndpointCache,
) -> None:
    response = await client.patch(
        "/api/v1/settings/",
        json={"custom_env_vars": "[]", "personas": "[]"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["custom_env_vars"] == []
    assert body["personas"] == []


@pytest.mark.parametrize(
    "payload",
    [
        {"custom_env_vars": 123},
        {"title_model_id": "not-a-registered-model"},
    ],
)
async def test_patch_settings_rejects_invalid_values(
    client: AsyncClient,
    headers: dict[str, str],
    payload: dict[str, object],
) -> None:
    response = await client.patch("/api/v1/settings/", json=payload, headers=headers)

    assert response.status_code == 422


async def test_settings_rejects_missing_token(client: AsyncClient) -> None:
    get_response = await client.get("/api/v1/settings/")
    patch_response = await client.patch(
        "/api/v1/settings/",
        json={"custom_instructions": "No auth"},
    )

    assert get_response.status_code == 401
    assert patch_response.status_code == 401


async def test_settings_return_404_when_settings_row_missing(
    client: AsyncClient,
    user: User,
    headers: dict[str, str],
    db_session: AsyncSession,
    settings_cache: EndpointCache,
) -> None:
    await db_session.execute(
        delete(UserSettings).where(UserSettings.user_id == user.id)
    )
    await db_session.commit()

    get_response = await client.get("/api/v1/settings/", headers=headers)
    patch_response = await client.patch(
        "/api/v1/settings/",
        json={"custom_instructions": "test"},
        headers=headers,
    )

    assert get_response.status_code == 404
    assert patch_response.status_code == 404


async def test_get_settings_returns_legacy_plaintext_github_token(
    client: AsyncClient,
    user: User,
    headers: dict[str, str],
    db_session: AsyncSession,
    settings_cache: EndpointCache,
) -> None:
    # Rows written before encryption hold plaintext; they must stay readable.
    await db_session.execute(
        text(
            "UPDATE user_settings SET github_personal_access_token = :token "
            "WHERE user_id = :user_id"
        ),
        {"token": "legacy-plaintext-token", "user_id": user.id.hex},
    )
    await db_session.commit()

    response = await client.get("/api/v1/settings/", headers=headers)

    assert response.status_code == 200
    assert response.json()["github_personal_access_token"] == "legacy-plaintext-token"
