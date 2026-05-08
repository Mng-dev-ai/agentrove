# Auth

User accounts, JWT + refresh-token flow, password reset, email verification, encrypted-at-rest secrets, WebSocket auth handshake. Built on **fastapi-users 13** with Argon2 password hashing.

## Entry points

- Models: `backend/app/models/db_models/user.py` — `User`, `UserSettings`. `backend/app/models/db_models/refresh_token.py` — `RefreshToken`.
- Service: `backend/app/services/refresh_token.py` — `RefreshTokenService`.
- Service: `backend/app/services/user.py` — `UserService` (settings, persona/env-var management).
- Endpoint: `backend/app/api/endpoints/auth.py` — login, logout, refresh, register, password reset.
- Security: `backend/app/core/security.py` — token validation, encryption, WebSocket auth.
- Email: `backend/app/services/email.py` (verification, password reset).
- Frontend store: `frontend/src/store/authStore.ts`.
- Frontend API client auto-refresh: `frontend/src/lib/api.ts`.

## Vocabulary

- **User** — `email`, `hashed_password`, `is_active`, `is_verified`, `username`. Hashing via `fastapi_users.PasswordHelper` (Argon2).
- **UserSettings** — per-user config: `github_personal_access_token` (encrypted), `custom_instructions`, `custom_env_vars` (JSON list), `personas` (JSON list), `notifications_enabled`.
- **RefreshToken** — DB row with `user_id`, `token_hash`, `user_agent`, `ip_address`, `expires_at`. Cascades on user delete (PR #586).
- **EncryptedString** / **EncryptedJSON** — Fernet-based, derived from `settings.SECRET_KEY`. Helpers `encrypt_value()` / `decrypt_value()` in `db/types.py`.
- **WS_CLOSE_AUTH_FAILED** — WebSocket close code emitted on first-frame auth failure.

## Auth flows

### HTTP login

`POST /auth/jwt/login` — email + password → JWT access token + refresh token (DB-persisted). Rate-limited via `slowapi`.

### Token refresh

`RefreshTokenService.create_refresh_token(user_id, user_agent, ip_address)` persists with TTL. Frontend `apiClient` dedupes concurrent 401 responses and retries the original request once.

### WebSocket auth

`wait_for_websocket_auth(ws)` reads the **first frame** as JSON `{token: "..."}`, validates via `get_user_from_token()`, closes with `WS_CLOSE_AUTH_FAILED` on failure. Browsers can't set Authorization on `WebSocket()`, so the handshake is in-band.

### Query-param auth

SSE/WebSocket endpoints accept `?token=` for browser compatibility — `EventSource` can't set headers either. The validator is the same `get_user_from_token()`.

## Cross-domain edges

- → **chat**: `Depends(get_current_user)` on every chat route; SSE uses `?token=` query param.
- → **github**: `UserSettings.github_personal_access_token` is encrypted; `Depends(require_github_token)` raises 400 if missing.
- → **integrations.email**: verification + password reset email through `EmailService`.

## Gotchas

- **Refresh tokens include user_agent + IP for audit trail** — optional validation, not enforced today.
- **Encrypted columns are encrypted *at rest*.** Read access (via the ORM) decrypts transparently. **Don't log the decrypted value.**
- **`SECRET_KEY` rotation invalidates all encrypted columns.** Don't rotate without a re-encryption migration.
- **Custom env vars are stored plaintext** in `UserSettings.custom_env_vars`. Intentional (low-sensitivity user-provided values), may upgrade later — don't assume encryption.
- **Argon2 verify-then-update** — `PasswordHelper.verify_password()` returns whether the hash should be upgraded; `auth.py` writes the new hash on successful login when needed. Don't bypass.
- **No email re-send rate limit** beyond `slowapi` route limits — abuse handled at the SMTP provider.

## Recent prior art

- **PR #586** — Cascade refresh tokens on user delete. Read for: cascade rules and the small model + schema PR shape.
- **PR #587** — Fix admin user delete URL. Tangential bugfix in admin.
- **PR #589** — Remove agent auth env defaults. Read for: tightening contract — no implicit fallbacks for required auth values.
- **PR #449** — Remove timezone field from user settings. Read for: removing a `UserSettings` field end-to-end.
- **PR #550** — Remove 1500-char limit and frame from custom instructions. Read for: relaxing a `UserSettings` constraint.
- **PR #469** — Remove silent fallback defaults and make errors explicit (touches auth defaults).
