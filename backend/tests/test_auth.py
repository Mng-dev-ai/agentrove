from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart

import aiosmtplib
import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_refresh_token
from app.models.db_models.refresh_token import RefreshToken
from app.models.db_models.user import User
from app.services.email import EmailService, email_service

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


async def test_register_rejects_duplicate_email(
    client: AsyncClient,
    create_user: UserFactory,
    email_capture: EmailCapture,
) -> None:
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
    email_capture: EmailCapture,
) -> None:
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


async def test_register_rejects_invalid_username(
    client: AsyncClient,
    email_capture: EmailCapture,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "invalid@example.com",
            "username": "_bad",
            "password": "password123",
        },
    )

    assert response.status_code == 422


async def test_register_rejects_disabled_registration(
    client: AsyncClient,
    settings_override: SettingsOverride,
    email_capture: EmailCapture,
) -> None:
    settings_override(REGISTRATION_DISABLED=True)

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "blocked@example.com",
            "username": "blocked",
            "password": "password123",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Registration is disabled"


async def test_register_rejects_disposable_email(
    client: AsyncClient,
    settings_override: SettingsOverride,
    email_capture: EmailCapture,
) -> None:
    settings_override(BLOCK_DISPOSABLE_EMAILS=True)
    email_capture.disposable = True

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "user@example.com",
            "username": "newuser",
            "password": "password123",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Disposable email addresses are not allowed. Please use a permanent email address."
    )


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


async def test_login_rejects_wrong_password(
    client: AsyncClient,
    create_user: UserFactory,
) -> None:
    await create_user(email="login@example.com", username="loginuser")

    response = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": "login@example.com", "password": "wrongpassword"},
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


async def test_login_rejects_unverified_user_when_verification_required(
    client: AsyncClient,
    create_user: UserFactory,
    settings_override: SettingsOverride,
) -> None:
    settings_override(REQUIRE_EMAIL_VERIFICATION=True)
    await create_user(
        email="unverified@example.com",
        username="unverified",
        is_verified=False,
    )

    response = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": "unverified@example.com", "password": "password123"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Please verify your email before logging in"


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


async def test_me_rejects_missing_token(client: AsyncClient) -> None:
    response = await client.get("/api/v1/auth/me")

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


async def test_refresh_rejects_rotated_token(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    await create_user(email="refresh@example.com", username="refreshuser")
    tokens = await login(email="refresh@example.com")
    await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )

    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token"


async def test_refresh_rejects_invalid_token(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/jwt/refresh",
        json={"refresh_token": "not-a-real-refresh-token"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token"


async def test_logout_revokes_refresh_token(
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


async def test_forgot_password_sends_reset_email(
    client: AsyncClient,
    create_user: UserFactory,
    email_capture: EmailCapture,
) -> None:
    await create_user(email="reset@example.com", username="resetuser")

    response = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "reset@example.com"},
    )

    assert response.status_code == 202
    assert len(email_capture.password_reset) == 1
    assert email_capture.password_reset[0]["email"] == "reset@example.com"
    assert email_capture.password_reset[0]["token"]


async def test_reset_password_accepts_valid_token(
    client: AsyncClient,
    create_user: UserFactory,
    email_capture: EmailCapture,
) -> None:
    await create_user(email="reset@example.com", username="resetuser")
    await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "reset@example.com"},
    )
    token = email_capture.password_reset[0]["token"]

    response = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "password": "newpassword123"},
    )

    assert response.status_code == 200
    login_response = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": "reset@example.com", "password": "newpassword123"},
    )
    assert login_response.status_code == 200


async def test_reset_password_rejects_invalid_token(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": "invalid-token", "password": "newpassword123"},
    )

    assert response.status_code == 400


async def test_request_verify_token_sends_verification_email(
    client: AsyncClient,
    create_user: UserFactory,
    email_capture: EmailCapture,
) -> None:
    await create_user(
        email="verify@example.com",
        username="verifyuser",
        is_verified=False,
    )

    response = await client.post(
        "/api/v1/auth/request-verify-token",
        json={"email": "verify@example.com"},
    )

    assert response.status_code == 202
    assert len(email_capture.verification) == 1
    assert email_capture.verification[0]["email"] == "verify@example.com"
    assert email_capture.verification[0]["token"]


async def test_verify_accepts_valid_token(
    client: AsyncClient,
    create_user: UserFactory,
    db_session: AsyncSession,
    email_capture: EmailCapture,
) -> None:
    user: User = await create_user(
        email="verify@example.com",
        username="verifyuser",
        is_verified=False,
    )
    await client.post(
        "/api/v1/auth/request-verify-token",
        json={"email": "verify@example.com"},
    )
    token = email_capture.verification[0]["token"]

    response = await client.post("/api/v1/auth/verify", json={"token": token})

    assert response.status_code == 200
    await db_session.refresh(user)
    assert user.is_verified is True


async def test_verify_rejects_invalid_token(client: AsyncClient) -> None:
    response = await client.post("/api/v1/auth/verify", json={"token": "bad-token"})

    assert response.status_code == 400


@pytest.mark.parametrize(
    ("username", "expected_message"),
    [
        ("", "Username is required"),
        ("ab", "Username must be at least 3 characters long"),
        ("a" * 31, "Username must be less than 30 characters long"),
        ("bad!name", "Username can only contain letters, numbers, and underscores"),
    ],
)
async def test_register_rejects_invalid_username_variants(
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


async def test_logout_with_unknown_token_still_succeeds(client: AsyncClient) -> None:
    # Exercises RefreshTokenService.revoke_token's "not found" branch — the
    # endpoint doesn't surface the boolean result either way.
    response = await client.post(
        "/api/v1/auth/jwt/logout",
        json={"refresh_token": "token-that-was-never-issued"},
    )

    assert response.status_code == 204


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
    # Pre-populate the cache but with a timestamp older than the TTL, so a
    # refetch is attempted; when it fails, the stale (still non-empty) cache
    # is served instead of an empty set.
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


async def test_forgot_password_returns_false_without_smtp_configured(
    client: AsyncClient,
    create_user: UserFactory,
) -> None:
    # No email_capture fixture and no smtp_password configured (bootstrap
    # sets MAIL_PASSWORD="") — exercises _send_email's early-return branch.
    await create_user(email="no-smtp@example.com", username="nosmtp")

    response = await client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "no-smtp@example.com"},
    )

    assert response.status_code == 202
