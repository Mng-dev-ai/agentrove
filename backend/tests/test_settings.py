import pytest
from httpx import AsyncClient
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints import settings as settings_endpoint
from app.models.db_models.user import UserSettings

from tests.conftest import LoginClient, UserFactory
from tests.helpers import EndpointCache


pytestmark = pytest.mark.anyio


@pytest.fixture
def settings_cache(monkeypatch: pytest.MonkeyPatch) -> EndpointCache:
    cache = EndpointCache()
    monkeypatch.setattr(settings_endpoint, "cache_connection", cache.connect)
    return cache


async def test_get_settings_returns_current_user_settings(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    settings_cache: EndpointCache,
) -> None:
    user = await create_user(email="settings@example.com", username="settingsuser")
    tokens = await login(email="settings@example.com")

    response = await client.get(
        "/api/v1/settings/",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

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
    create_user: UserFactory,
    login: LoginClient,
    settings_cache: EndpointCache,
) -> None:
    await create_user(email="update-settings@example.com", username="updatesettings")
    tokens = await login(email="update-settings@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    payload = {
        "github_personal_access_token": "ghp_testtoken",
        "custom_instructions": "Prefer concise answers.",
        "custom_env_vars": [{"key": "API_MODE", "value": "test"}],
        "personas": [{"name": "Reviewer", "content": "Review carefully."}],
        "notifications_enabled": False,
    }

    cached_response = await client.get("/api/v1/settings/", headers=headers)
    assert cached_response.status_code == 200

    response = await client.patch(
        "/api/v1/settings/",
        json=payload,
        headers=headers,
    )

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


async def test_patch_settings_normalizes_string_json_lists(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    settings_cache: EndpointCache,
) -> None:
    await create_user(email="normalize-settings@example.com", username="normalize")
    tokens = await login(email="normalize-settings@example.com")

    response = await client.patch(
        "/api/v1/settings/",
        json={"custom_env_vars": "[]", "personas": "[]"},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["custom_env_vars"] == []
    assert body["personas"] == []


async def test_settings_rejects_missing_token(client: AsyncClient) -> None:
    get_response = await client.get("/api/v1/settings/")
    patch_response = await client.patch(
        "/api/v1/settings/",
        json={"custom_instructions": "No auth"},
    )

    assert get_response.status_code == 401
    assert patch_response.status_code == 401


async def test_patch_settings_rejects_non_list_non_string_json_field(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="bad-json-field@example.com", username="badjsonfield")
    tokens = await login(email="bad-json-field@example.com")

    response = await client.patch(
        "/api/v1/settings/",
        json={"custom_env_vars": 123},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 422


async def test_get_settings_returns_404_when_settings_row_missing(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
    settings_cache: EndpointCache,
) -> None:
    user = await create_user(
        email="missing-settings@example.com", username="missingsettings"
    )
    tokens = await login(email="missing-settings@example.com")
    await db_session.execute(
        delete(UserSettings).where(UserSettings.user_id == user.id)
    )
    await db_session.commit()

    response = await client.get(
        "/api/v1/settings/",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 404


async def test_patch_settings_returns_404_when_settings_row_missing(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
    settings_cache: EndpointCache,
) -> None:
    user = await create_user(
        email="missing-settings-patch@example.com", username="missingpatch"
    )
    tokens = await login(email="missing-settings-patch@example.com")
    await db_session.execute(
        delete(UserSettings).where(UserSettings.user_id == user.id)
    )
    await db_session.commit()

    response = await client.patch(
        "/api/v1/settings/",
        json={"custom_instructions": "test"},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 404


async def test_get_settings_returns_legacy_plaintext_github_token(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
    settings_cache: EndpointCache,
) -> None:
    user = await create_user(email="legacy-token@example.com", username="legacytoken")
    tokens = await login(email="legacy-token@example.com")
    # Raw SQL bypasses the EncryptedString bind, simulating a pre-encryption
    # legacy row so decrypt_value raises InvalidToken and the type falls
    # back to returning the stored value as-is.
    await db_session.execute(
        text(
            "UPDATE user_settings SET github_personal_access_token = :token "
            "WHERE user_id = :user_id"
        ),
        {"token": "legacy-plaintext-token", "user_id": user.id.hex},
    )
    await db_session.commit()

    response = await client.get(
        "/api/v1/settings/",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["github_personal_access_token"] == "legacy-plaintext-token"
