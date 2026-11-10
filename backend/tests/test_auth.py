from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from uuid import UUID

import aiosmtplib
import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as main_module
from app.core.security import create_mcp_access_token
from app.core.user_manager import AccessTokenStrategy
from app.models.db_models.paired_device import PairedDevice, PairingSecret
from app.models.db_models.refresh_token import RefreshToken
from app.services.email import EmailService, email_service
from app.services.refresh_token import RefreshTokenService, hash_refresh_token

from tests.conftest import EmailCapture, LoginClient, SettingsOverride, UserFactory
from tests.helpers import count_refresh_tokens, get_user_by_email, get_user_settings


pytestmark = pytest.mark.anyio


def extract_html_body(message: MIMEMultipart) -> str:
    # The service attaches a single "html" MIMEText part — decode it to
    # assert on the rendered template output (link, token).
    payload = message.get_payload()[0].get_payload(decode=True)
    assert isinstance(payload, bytes)
    return payload.decode()


@dataclass
class FakeHttpxResponse:
    status_code: int
    text: str


@dataclass
class FakeDisposableDomainsClient:
    fetch: "DisposableDomainsFetch"

    async def __aenter__(self) -> "FakeDisposableDomainsClient":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    async def get(self, _url: str) -> FakeHttpxResponse:
        self.fetch.call_count += 1
        if self.fetch.raises is not None:
            raise self.fetch.raises("simulated network failure")
        return FakeHttpxResponse(self.fetch.status_code, self.fetch.text)


@dataclass
class DisposableDomainsFetch:
    # Stands in for `httpx.AsyncClient` itself (the real code does
    # `httpx.AsyncClient(timeout=10.0)`), so this must be callable.
    status_code: int = 200
    text: str = "mailinator.com\n"
    raises: type[Exception] | None = None
    call_count: int = 0

    def __call__(self, *, timeout: float | None = None) -> FakeDisposableDomainsClient:
        return FakeDisposableDomainsClient(self)


@dataclass
class SmtpSendCapture:
    calls: list[MIMEMultipart] = field(default_factory=list)
    raises: type[Exception] | None = None

    async def send(
        self, message: MIMEMultipart, **_kwargs: object
    ) -> tuple[dict[str, str], str]:
        self.calls.append(message)
        if self.raises is not None:
            raise self.raises("simulated smtp failure")
        return {}, "OK"


async def test_register_creates_user_and_settings(
    client: AsyncClient,
    db_session: AsyncSession,
    email_capture: EmailCapture,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "new@example.com",
            "username": "newuser",
            "password": "password123",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new@example.com"
    assert body["username"] == "newuser"
    assert body["email_verification_required"] is False

    user = await get_user_by_email(db_session, "new@example.com")
    assert user is not None
    assert await get_user_settings(db_session, user.id) is not None


async def test_register_ignores_privilege_fields(
    client: AsyncClient,
    db_session: AsyncSession,
    email_capture: EmailCapture,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "escalate@example.com",
            "username": "escalate",
            "password": "password123",
            "is_superuser": True,
            "is_verified": True,
        },
    )

    assert response.status_code == 201
    user = await get_user_by_email(db_session, "escalate@example.com")
    assert user is not None
    assert user.is_superuser is False
    assert user.is_verified is False


async def test_register_rejects_duplicate_email(
    client: AsyncClient,
    create_user: UserFactory,
    settings_override: SettingsOverride,
    email_capture: EmailCapture,
) -> None:
    settings_override(REGISTRATION_OPEN=True)
    await create_user(email="taken@example.com", username="existing")

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "taken@example.com",
            "username": "newuser",
            "password": "password123",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Email already registered"


async def test_register_rejects_duplicate_username(
    client: AsyncClient,
    create_user: UserFactory,
    settings_override: SettingsOverride,
    email_capture: EmailCapture,
) -> None:
    settings_override(REGISTRATION_OPEN=True)
    await create_user(email="first@example.com", username="takenname")

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "second@example.com",
            "username": "takenname",
            "password": "password123",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Username already registered"


@pytest.mark.parametrize(
    ("username", "expected_message"),
    [
        ("", "Username is required"),
        ("ab", "Username must be at least 3 characters long"),
        ("a" * 31, "Username must be less than 30 characters long"),
        ("bad!name", "Username can only contain letters, numbers, and underscores"),
        ("_bad", "Username cannot start or end with underscore"),
    ],
)
async def test_register_rejects_invalid_username(
    client: AsyncClient,
    email_capture: EmailCapture,
    username: str,
    expected_message: str,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "invalid-variant@example.com",
            "username": username,
            "password": "password123",
        },
    )

    assert response.status_code == 422
    errors = response.json()["detail"]
    assert any(expected_message in str(err.get("msg", "")) for err in errors)


async def test_register_rejects_once_a_user_exists(
    client: AsyncClient,
    db_session: AsyncSession,
    email_capture: EmailCapture,
) -> None:
    first = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "owner@example.com",
            "username": "owner",
            "password": "password123",
        },
    )
    second = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "intruder@example.com",
            "username": "intruder",
            "password": "password123",
        },
    )

    assert first.status_code == 201
    assert second.status_code == 403
    assert second.json()["detail"] == "Registration is closed"
    assert await get_user_by_email(db_session, "intruder@example.com") is None


async def test_register_allows_additional_users_when_open(
    client: AsyncClient,
    create_user: UserFactory,
    settings_override: SettingsOverride,
    email_capture: EmailCapture,
) -> None:
    settings_override(REGISTRATION_OPEN=True)
    await create_user(email="owner@example.com", username="owner")

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "teammate@example.com",
            "username": "teammate",
            "password": "password123",
        },
    )

    assert response.status_code == 201


async def test_login_returns_access_and_refresh_tokens(
    client: AsyncClient,
    create_user: UserFactory,
    db_session: AsyncSession,
) -> None:
    user = await create_user(email="login@example.com", username="loginuser")

    response = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": "login@example.com", "password": "password123"},
        headers={"user-agent": "pytest"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"
    assert await count_refresh_tokens(db_session, user.id) == 1


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("login@example.com", "wrongpassword"),
        ("nobody@example.com", "password123"),
    ],
)
async def test_login_rejects_bad_credentials_with_same_message(
    client: AsyncClient,
    create_user: UserFactory,
    email: str,
    password: str,
) -> None:
    # Unknown email and wrong password must be indistinguishable to callers.
    await create_user(email="login@example.com", username="loginuser")

    response = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": email, "password": password},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid email or password"


async def test_login_rejects_inactive_user(
    client: AsyncClient,
    create_user: UserFactory,
) -> None:
    await create_user(
        email="inactive@example.com",
        username="inactive",
        is_active=False,
    )

    response = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": "inactive@example.com", "password": "password123"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Account is inactive"


async def test_registration_with_required_verification_gates_login_until_verified(
    client: AsyncClient,
    settings_override: SettingsOverride,
    email_capture: EmailCapture,
) -> None:
    settings_override(REQUIRE_EMAIL_VERIFICATION=True)
    credentials = {"username": "verify@example.com", "password": "password123"}

    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "verify@example.com",
            "username": "verifyuser",
            "password": "password123",
        },
    )

    assert register.status_code == 201
    assert register.json()["email_verification_required"] is True
    assert [sent["email"] for sent in email_capture.verification] == [
        "verify@example.com"
    ]
    blocked = await client.post("/api/v1/auth/jwt/login", data=credentials)
    assert blocked.status_code == 400
    assert blocked.json()["detail"] == "Please verify your email before logging in"

    verify = await client.post(
        "/api/v1/auth/verify",
        json={"token": email_capture.verification[0]["token"]},
    )
    assert verify.status_code == 200
    allowed = await client.post("/api/v1/auth/jwt/login", data=credentials)
    assert allowed.status_code == 200


async def test_me_returns_current_user(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="me@example.com", username="meuser")
    tokens = await login(email="me@example.com")

    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "me@example.com"
    assert body["username"] == "meuser"
    assert body["is_verified"] is True


async def test_mcp_access_token_authenticates_bearer_requests(
    client: AsyncClient,
    create_user: UserFactory,
) -> None:
    user = await create_user(email="mcp-token@example.com", username="mcptoken")
    token = create_mcp_access_token(str(user.id), user.hashed_password, frozenset())

    response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["email"] == "mcp-token@example.com"


async def test_mcp_endpoint_requires_a_valid_token_and_lists_tools(
    client: AsyncClient,
    create_user: UserFactory,
) -> None:
    user = await create_user(email="mcp-http@example.com", username="mcphttp")
    token = create_mcp_access_token(str(user.id), user.hashed_password, frozenset())
    stale = create_mcp_access_token(str(user.id), "old-password-hash", frozenset())
    list_tools = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    headers = {"Host": "api:8080", "Accept": "application/json, text/event-stream"}

    for authorization in (
        {},
        {"Authorization": "Bearer junk"},
        {"Authorization": f"Bearer {stale}"},
    ):
        response = await client.post(
            "/api/v1/mcp", json=list_tools, headers=headers | authorization
        )
        assert response.status_code == 401

    async with main_module.mcp_endpoint.run():
        response = await client.post(
            "/api/v1/mcp",
            json=list_tools,
            headers=headers | {"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 200, response.text
    tools = {tool["name"] for tool in response.json()["result"]["tools"]}
    assert {"get_current_chat", "list_workspaces", "attach_file"} <= tools


async def test_query_token_is_not_accepted(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="query-token@example.com", username="querytoken")
    tokens = await login(email="query-token@example.com")

    response = await client.get(
        "/api/v1/models/", params={"token": tokens["access_token"]}
    )

    assert response.status_code == 401


async def test_refresh_rotates_refresh_token(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="refresh@example.com", username="refreshuser")
    tokens = await login(email="refresh@example.com")

    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["refresh_token"] != tokens["refresh_token"]
    assert body["token_type"] == "bearer"


async def test_refresh_replay_after_lost_response_replaces_unused_successor(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
) -> None:
    user = await create_user(email="refresh@example.com", username="refreshuser")
    tokens = await login(email="refresh@example.com")
    lost = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert lost.status_code == 200

    replay = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert replay.status_code == 200
    assert replay.json()["refresh_token"] not in (
        tokens["refresh_token"],
        lost.json()["refresh_token"],
    )
    discarded = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": lost.json()["refresh_token"]},
    )
    assert discarded.status_code == 401
    assert discarded.json()["detail"] == "Invalid or expired refresh token"
    live = await db_session.scalars(
        select(RefreshToken.token_hash).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    )
    assert live.all() == [hash_refresh_token(replay.json()["refresh_token"])]


async def test_refresh_rejects_rotated_token_after_successor_used(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="refresh@example.com", username="refreshuser")
    tokens = await login(email="refresh@example.com")
    rotated = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    successor = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": rotated.json()["refresh_token"]},
    )
    assert successor.status_code == 200

    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token"


async def test_refresh_reuse_after_successor_used_does_not_revoke_other_sessions(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    # One device replaying a stale token must not log out the user's other
    # devices — reuse is rejected per-token, never via revoke-all.
    await create_user(email="multi@example.com", username="multiuser")
    device_a = await login(email="multi@example.com")
    device_b = await login(email="multi@example.com")
    rotated = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": device_a["refresh_token"]},
    )
    await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": rotated.json()["refresh_token"]},
    )
    stale_replay = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": device_a["refresh_token"]},
    )
    assert stale_replay.status_code == 401

    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": device_b["refresh_token"]},
    )

    assert response.status_code == 200


async def test_refresh_rejects_invalid_token(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": "not-a-real-refresh-token"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token"


async def test_logout_revokes_refresh_token_and_is_idempotent(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="logout@example.com", username="logoutuser")
    tokens = await login(email="logout@example.com")

    response = await client.post(
        "/api/v1/auth/jwt/logout",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert response.status_code == 204
    refresh_response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert refresh_response.status_code == 401
    repeat_logout = await client.post(
        "/api/v1/auth/jwt/logout",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert repeat_logout.status_code == 204


async def test_logout_invalidates_rotated_predecessor(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    # Rotate then log out with the unused successor — the rotated-away
    # predecessor must not be able to re-mint credentials.
    await create_user(email="logout@example.com", username="logoutuser")
    tokens = await login(email="logout@example.com")
    rotated = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert rotated.status_code == 200

    response = await client.post(
        "/api/v1/auth/jwt/logout",
        json={"refresh_token": rotated.json()["refresh_token"]},
    )

    assert response.status_code == 204
    replay = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert replay.status_code == 401


async def test_logout_revokes_chain_but_not_other_devices(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
) -> None:
    await create_user(email="logout@example.com", username="logoutuser")
    device_a = await login(email="logout@example.com")
    rotated = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": device_a["refresh_token"]},
    )
    assert rotated.status_code == 200
    parent = await db_session.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == hash_refresh_token(device_a["refresh_token"])
        )
    )
    assert parent is not None
    sibling = "legacy-sibling-token"
    db_session.add(
        RefreshToken(
            token_hash=hash_refresh_token(sibling),
            user_id=parent.user_id,
            expires_at=parent.expires_at,
            parent_id=parent.id,
        )
    )
    await db_session.commit()
    device_b = await login(email="logout@example.com")

    response = await client.post(
        "/api/v1/auth/jwt/logout",
        json={"refresh_token": rotated.json()["refresh_token"]},
    )

    assert response.status_code == 204
    for refresh_token in (
        rotated.json()["refresh_token"],
        device_a["refresh_token"],
        sibling,
    ):
        refresh_response = await client.post(
            "/api/v1/auth/jwt/refresh", json={"refresh_token": refresh_token}
        )
        assert refresh_response.status_code == 401
    device_b_response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": device_b["refresh_token"]},
    )
    assert device_b_response.status_code == 200


async def test_reset_password_replaces_password_and_revokes_sessions(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    email_capture: EmailCapture,
) -> None:
    # Sessions issued under the old password must not survive a reset.
    await create_user(email="reset@example.com", username="resetuser")
    tokens = await login(email="reset@example.com")
    forgot = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "reset@example.com"},
    )
    assert forgot.status_code == 202
    [sent] = email_capture.password_reset

    response = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": sent["token"], "password": "newpassword123"},
    )

    assert response.status_code == 200
    refresh_response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert refresh_response.status_code == 401
    old_password = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": "reset@example.com", "password": "password123"},
    )
    assert old_password.status_code == 400
    await login(email="reset@example.com", password="newpassword123")


async def test_refresh_rejects_expired_token(
    client: AsyncClient,
    create_user: UserFactory,
    db_session: AsyncSession,
) -> None:
    user = await create_user(email="expired@example.com", username="expireduser")
    raw_token = "already-expired-raw-token"
    # Naive datetime on purpose — exercises UTCDateTime's naive-bind branch
    # in addition to the service's expiry check.
    db_session.add(
        RefreshToken(
            token_hash=hash_refresh_token(raw_token),
            user_id=user.id,
            expires_at=datetime(2000, 1, 1),
        )
    )
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": raw_token},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token"


async def test_refresh_rejects_token_for_deactivated_user(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
) -> None:
    user = await create_user(
        email="deactivated@example.com", username="deactivateduser"
    )
    tokens = await login(email="deactivated@example.com")
    user.is_active = False
    db_session.add(user)
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token"


async def test_refresh_token_cleanup_prunes_dead_tokens_and_keeps_live_sessions(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
) -> None:
    user = await create_user(email="cleanup@example.com", username="cleanupuser")
    live = await login(email="cleanup@example.com")
    rotated_away = await login(email="cleanup@example.com")
    rotation = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": rotated_away["refresh_token"]},
    )
    assert rotation.status_code == 200
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            RefreshToken(
                token_hash=hash_refresh_token("expired"),
                user_id=user.id,
                expires_at=now - timedelta(days=1),
            ),
            RefreshToken(
                token_hash=hash_refresh_token("revoked-long-ago"),
                user_id=user.id,
                expires_at=now + timedelta(days=1),
                revoked_at=now - timedelta(days=8),
            ),
        ]
    )
    await db_session.commit()

    result = await RefreshTokenService.cleanup_expired_tokens_job()

    assert result == {"deleted_count": 2}
    # live + recently rotated predecessor + its successor survive
    assert await count_refresh_tokens(db_session, user.id) == 3
    for refresh_token in (live["refresh_token"], rotation.json()["refresh_token"]):
        response = await client.post(
            "/api/v1/auth/jwt/refresh", json={"refresh_token": refresh_token}
        )
        assert response.status_code == 200


async def test_register_blocks_disposable_email_via_live_domain_fetch(
    client: AsyncClient,
    settings_override: SettingsOverride,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(EmailService, "_disposable_domains_cache", set())
    monkeypatch.setattr(EmailService, "_disposable_domains_cache_time", None)
    fetch = DisposableDomainsFetch(text="mailinator.com\n")
    monkeypatch.setattr("app.services.email.httpx.AsyncClient", fetch)
    settings_override(BLOCK_DISPOSABLE_EMAILS=True)

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "spammer@mailinator.com",
            "username": "spammer",
            "password": "password123",
        },
    )

    assert response.status_code == 400
    assert "Disposable email" in response.json()["detail"]
    assert fetch.call_count == 1

    second = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "spammer2@mailinator.com",
            "username": "spammertwo",
            "password": "password123",
        },
    )

    assert second.status_code == 400
    # Within the cache TTL, the domain list isn't re-fetched.
    assert fetch.call_count == 1


async def test_register_blocks_disposable_email_using_stale_cache_when_refetch_fails(
    client: AsyncClient,
    settings_override: SettingsOverride,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Stale non-empty cache past TTL: refetch fails → serve stale, not empty.
    monkeypatch.setattr(EmailService, "_disposable_domains_cache", {"mailinator.com"})
    monkeypatch.setattr(
        EmailService,
        "_disposable_domains_cache_time",
        datetime(2000, 1, 1, tzinfo=timezone.utc),
    )
    fetch = DisposableDomainsFetch(raises=httpx.ConnectError)
    monkeypatch.setattr("app.services.email.httpx.AsyncClient", fetch)
    settings_override(BLOCK_DISPOSABLE_EMAILS=True)

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "stale@mailinator.com",
            "username": "staleuser",
            "password": "password123",
        },
    )

    assert response.status_code == 400
    assert fetch.call_count == 1


async def test_register_allows_email_when_domain_fetch_fails(
    client: AsyncClient,
    settings_override: SettingsOverride,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(EmailService, "_disposable_domains_cache", set())
    monkeypatch.setattr(EmailService, "_disposable_domains_cache_time", None)
    fetch = DisposableDomainsFetch(raises=httpx.ConnectError)
    monkeypatch.setattr("app.services.email.httpx.AsyncClient", fetch)
    settings_override(BLOCK_DISPOSABLE_EMAILS=True)

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "user@example.com",
            "username": "networkfail",
            "password": "password123",
        },
    )

    assert response.status_code == 201
    assert fetch.call_count == 1


async def test_forgot_password_sends_real_smtp_message(
    client: AsyncClient,
    create_user: UserFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await create_user(email="smtp-reset@example.com", username="smtpreset")
    monkeypatch.setattr(email_service, "smtp_password", "app-password")
    capture = SmtpSendCapture()
    monkeypatch.setattr("app.services.email.aiosmtplib.send", capture.send)

    response = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "smtp-reset@example.com"},
    )

    assert response.status_code == 202
    assert len(capture.calls) == 1
    message = capture.calls[0]
    assert message["Subject"] == "Reset your Agentrove password"
    assert message["To"] == "smtp-reset@example.com"
    assert "reset-password?token=" in extract_html_body(message)


async def test_request_verify_token_sends_real_smtp_message(
    client: AsyncClient,
    create_user: UserFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await create_user(
        email="smtp-verify@example.com", username="smtpverify", is_verified=False
    )
    monkeypatch.setattr(email_service, "smtp_password", "app-password")
    capture = SmtpSendCapture()
    monkeypatch.setattr("app.services.email.aiosmtplib.send", capture.send)

    response = await client.post(
        "/api/v1/auth/request-verify-token",
        json={"email": "smtp-verify@example.com"},
    )

    assert response.status_code == 202
    assert len(capture.calls) == 1
    message = capture.calls[0]
    assert message["Subject"] == "Verify your Agentrove account"
    assert "verify-email?token=" in extract_html_body(message)


async def test_forgot_password_swallows_smtp_send_failure(
    client: AsyncClient,
    create_user: UserFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await create_user(email="smtp-fail@example.com", username="smtpfail")
    monkeypatch.setattr(email_service, "smtp_password", "app-password")
    capture = SmtpSendCapture(raises=aiosmtplib.SMTPException)
    monkeypatch.setattr("app.services.email.aiosmtplib.send", capture.send)

    response = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "smtp-fail@example.com"},
    )

    assert response.status_code == 202
    assert len(capture.calls) == 1


async def test_forgot_password_succeeds_without_smtp_configured(
    client: AsyncClient,
    create_user: UserFactory,
) -> None:
    # Self-hosted installs often run without SMTP (bootstrap sets
    # MAIL_PASSWORD=""); the request must still succeed, not 500.
    await create_user(email="no-smtp@example.com", username="nosmtp")

    response = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "no-smtp@example.com"},
    )

    assert response.status_code == 202


async def pair_device(
    client: AsyncClient, access_token: str, device_name: str = "Laptop"
) -> httpx.Response:
    pairing = await client.post(
        "/api/v1/auth/pairing",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert pairing.status_code == 200, pairing.text
    return await client.post(
        "/api/v1/auth/pair",
        json={"secret": pairing.json()["secret"], "device_name": device_name},
    )


async def test_pairing_secret_is_single_use(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="pair@example.com", username="pairuser")
    tokens = await login(email="pair@example.com")
    pairing = await client.post(
        "/api/v1/auth/pairing",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    secret = pairing.json()["secret"]

    first = await client.post(
        "/api/v1/auth/pair", json={"secret": secret, "device_name": "  Laptop  "}
    )
    second = await client.post(
        "/api/v1/auth/pair", json={"secret": secret, "device_name": "Laptop"}
    )

    assert first.status_code == 200, first.text
    instance = await client.get("/api/v1/instance")
    assert first.json()["instance_id"] == instance.json()["instance_id"]
    devices = await client.get(
        "/api/v1/auth/devices",
        headers={"Authorization": f"Bearer {first.json()['access_token']}"},
    )
    assert [(d["name"], d["current"]) for d in devices.json()] == [("Laptop", True)]
    assert second.status_code == 400
    assert second.json()["detail"] == "Invalid or expired pairing link"


async def test_pairing_rejects_expired_secret(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
) -> None:
    await create_user(email="pair-expired@example.com", username="pairexpired")
    tokens = await login(email="pair-expired@example.com")
    pairing = await client.post(
        "/api/v1/auth/pairing",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    await db_session.execute(
        update(PairingSecret).values(
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)
        )
    )
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/pair",
        json={"secret": pairing.json()["secret"], "device_name": "Laptop"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired pairing link"


async def test_revoked_device_tokens_are_rejected_immediately(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="revoke@example.com", username="revokeuser")
    tokens = await login(email="revoke@example.com")
    paired = (await pair_device(client, tokens["access_token"])).json()
    device_headers = {"Authorization": f"Bearer {paired['access_token']}"}
    assert (
        await client.get("/api/v1/auth/me", headers=device_headers)
    ).status_code == 200
    refreshed = await client.post(
        "/api/v1/auth/jwt/refresh", json={"refresh_token": paired["refresh_token"]}
    )
    assert refreshed.status_code == 200
    refreshed_headers = {"Authorization": f"Bearer {refreshed.json()['access_token']}"}

    response = await client.delete(
        f"/api/v1/auth/devices/{paired['device_id']}", headers=device_headers
    )

    assert response.status_code == 204
    for headers in (device_headers, refreshed_headers):
        assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
    for refresh_token in (paired["refresh_token"], refreshed.json()["refresh_token"]):
        refresh = await client.post(
            "/api/v1/auth/jwt/refresh", json={"refresh_token": refresh_token}
        )
        assert refresh.status_code == 401
    password_session = await client.get(
        "/api/v1/auth/devices",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert password_session.json() == []


async def test_cannot_revoke_another_users_device(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="owner@example.com", username="owneruser")
    await create_user(email="other@example.com", username="otheruser")
    owner = await login(email="owner@example.com")
    other = await login(email="other@example.com")
    paired = (await pair_device(client, owner["access_token"])).json()

    response = await client.delete(
        f"/api/v1/auth/devices/{paired['device_id']}",
        headers={"Authorization": f"Bearer {other['access_token']}"},
    )

    assert response.status_code == 404
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    assert me.status_code == 200


async def test_device_token_bound_to_another_users_device_is_rejected(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
) -> None:
    await create_user(email="device-owner@example.com", username="deviceowner")
    intruder = await create_user(email="intruder@example.com", username="intruder")
    owner = await login(email="device-owner@example.com")
    paired = (await pair_device(client, owner["access_token"])).json()
    device = await db_session.get(PairedDevice, UUID(paired["device_id"]))
    assert device is not None
    token = await AccessTokenStrategy(db_session).write_session_token(
        intruder, frozenset({device.id})
    )

    response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401


async def test_dangling_device_id_fails_closed(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    db_session: AsyncSession,
) -> None:
    await create_user(email="dangling@example.com", username="dangling")
    tokens = await login(email="dangling@example.com")
    paired = (await pair_device(client, tokens["access_token"])).json()
    await db_session.execute(
        delete(PairedDevice).where(PairedDevice.id == UUID(paired["device_id"]))
    )
    await db_session.commit()

    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )
    refreshed = await client.post(
        "/api/v1/auth/jwt/refresh", json={"refresh_token": paired["refresh_token"]}
    )

    assert me.status_code == 401
    assert refreshed.status_code == 401


async def test_device_session_can_revoke_only_itself(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="revoke-self@example.com", username="revokeself")
    tokens = await login(email="revoke-self@example.com")
    laptop = (await pair_device(client, tokens["access_token"], "Laptop")).json()
    phone = (await pair_device(client, tokens["access_token"], "Phone")).json()
    laptop_headers = {"Authorization": f"Bearer {laptop['access_token']}"}
    phone_headers = {"Authorization": f"Bearer {phone['access_token']}"}

    other = await client.delete(
        f"/api/v1/auth/devices/{phone['device_id']}", headers=laptop_headers
    )
    assert other.status_code == 403
    assert (
        other.json()["detail"]
        == "Other devices can only be revoked from a password sign-in"
    )
    assert (
        await client.get("/api/v1/auth/me", headers=phone_headers)
    ).status_code == 200

    own = await client.delete(
        f"/api/v1/auth/devices/{laptop['device_id']}", headers=laptop_headers
    )
    assert own.status_code == 204
    assert (
        await client.get("/api/v1/auth/me", headers=laptop_headers)
    ).status_code == 401


async def test_device_session_cannot_create_pairing_links(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="pair-chain@example.com", username="pairchain")
    tokens = await login(email="pair-chain@example.com")
    paired = (await pair_device(client, tokens["access_token"])).json()

    response = await client.post(
        "/api/v1/auth/pairing",
        headers={"Authorization": f"Bearer {paired['access_token']}"},
    )

    assert response.status_code == 403
    assert (
        response.json()["detail"]
        == "Pairing links can only be created from a password sign-in"
    )


async def test_reset_password_revokes_paired_devices(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    email_capture: EmailCapture,
) -> None:
    await create_user(email="reset-device@example.com", username="resetdevice")
    tokens = await login(email="reset-device@example.com")
    paired = (await pair_device(client, tokens["access_token"])).json()
    device_headers = {"Authorization": f"Bearer {paired['access_token']}"}
    assert (
        await client.get("/api/v1/auth/me", headers=device_headers)
    ).status_code == 200
    pending = await client.post(
        "/api/v1/auth/pairing",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    await client.post(
        "/api/v1/auth/forgot-password", json={"email": "reset-device@example.com"}
    )
    [sent] = email_capture.password_reset

    reset = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": sent["token"], "password": "newpassword123"},
    )

    assert reset.status_code == 200
    assert (
        await client.get("/api/v1/auth/me", headers=device_headers)
    ).status_code == 401
    redeemed = await client.post(
        "/api/v1/auth/pair",
        json={"secret": pending.json()["secret"], "device_name": "Laptop"},
    )
    assert redeemed.status_code == 400
    fresh = await login(email="reset-device@example.com", password="newpassword123")
    devices = await client.get(
        "/api/v1/auth/devices",
        headers={"Authorization": f"Bearer {fresh['access_token']}"},
    )
    assert devices.json() == []


async def test_mcp_token_bound_to_device_dies_with_device(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    user = await create_user(email="mcp-device@example.com", username="mcpdevice")
    tokens = await login(email="mcp-device@example.com")
    paired = (await pair_device(client, tokens["access_token"])).json()
    mcp_headers = {
        "Authorization": "Bearer "
        + create_mcp_access_token(
            str(user.id), user.hashed_password, frozenset({UUID(paired["device_id"])})
        )
    }
    assert (await client.get("/api/v1/auth/me", headers=mcp_headers)).status_code == 200

    await client.delete(
        f"/api/v1/auth/devices/{paired['device_id']}",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert (await client.get("/api/v1/auth/me", headers=mcp_headers)).status_code == 401


async def test_agent_token_cannot_create_pairing_links_or_manage_devices(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    user = await create_user(email="mcp-pair@example.com", username="mcppair")
    tokens = await login(email="mcp-pair@example.com")
    paired = (await pair_device(client, tokens["access_token"])).json()
    mcp_headers = {
        "Authorization": f"Bearer {create_mcp_access_token(str(user.id), user.hashed_password, frozenset())}"
    }

    responses = [
        await client.post("/api/v1/auth/pairing", headers=mcp_headers),
        await client.get("/api/v1/auth/devices", headers=mcp_headers),
        await client.delete(
            f"/api/v1/auth/devices/{paired['device_id']}", headers=mcp_headers
        ),
    ]

    for response in responses:
        assert response.status_code == 403
        assert (
            response.json()["detail"] == "Agent tokens cannot manage pairing or devices"
        )
