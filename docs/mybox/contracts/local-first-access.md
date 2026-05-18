# Local-First Access Contract

**Status:** G2 implemented contract
**Date:** 2026-05-18

MyBox is desktop-first. A local desktop user should be able to enter the app and
work with local harnesses without being blocked by hosted-style account sign-in.

## Required Behavior

- Desktop local mode should not require hosted login.
- Hosted/web mode must not be weakened by local desktop access.
- Auth relaxation must be owned by backend/runtime mode or another explicit
  trusted boundary. It must not be a frontend-only bypass.
- Existing auth code should be changed deliberately, not deleted.
- Local profile/session behavior must still protect workspace ownership and
  mutation surfaces.

## Non-Goals

- Do not remove hosted auth.
- Do not remove refresh token tests.
- Do not make all API routes unauthenticated.
- Do not silently convert hosted mode into local mode.

## Implemented Runtime Shape

G2 implements the explicit runtime mode through a backend-owned desktop session
endpoint:

```text
POST /api/v1/auth/desktop/local-session
```

The endpoint is available only when the backend is running with
`DESKTOP_MODE=true`. When `DESKTOP_MODE=false`, it returns `404` so hosted/web
mode does not gain a local-login path.

In desktop mode, the endpoint creates or resolves a deterministic local profile:

```text
email: local@mybox.desktop
username: local_desktop
```

That user is active, verified, persisted in the normal users table, and has a
normal `UserSettings` row. The endpoint issues the same access-token and
refresh-token shapes as hosted login, so existing current-user, workspace,
stream, and WebSocket ownership checks continue to run against a real user id.
The reserved desktop-local email is blocked from the hosted `/jwt/login` route,
hosted registration, and its stored password hash is rotated from an
unguessable value during local session bootstrap so the local identity cannot
become a public hosted credential. Reserved-email checks are case-insensitive.
Desktop-local access tokens, query tokens, WebSocket tokens, refresh tokens, and
optional user dependency paths reject the reserved identity when
`DESKTOP_MODE=false`. Token-query and WebSocket auth also reject inactive users
before returning a user object.

| Mode | Expected behavior |
| --- | --- |
| desktop-local | Local profile is available without hosted sign-in; local storage and workspace ownership remain scoped. |
| hosted-web | Existing hosted auth remains required. |
| test | Tests can create users and sessions deterministically. |

The frontend calls the desktop local-session endpoint only after Tauri backend
port resolution and auth storage hydration. It stores the returned tokens in the
existing auth storage layer and does not make protected routes trust a
frontend-only desktop flag.

## Test Expectations

G2 includes tests for:

- desktop local mode enters the app without hosted sign-in,
- hosted/web mode still requires auth,
- backend routes do not trust a frontend-only flag,
- workspace access boundaries remain enforced,
- terminal WebSocket auth accepts the normal desktop-issued JWT,
- hosted login rejects the reserved desktop-local identity,
- hosted registration rejects the reserved desktop-local email,
- hosted login and registration reject case variants of the reserved
  desktop-local email,
- existing desktop-local tokens and refresh tokens reject after leaving desktop
  mode,
- token-query auth rejects users deactivated after token issue,
- username collisions on `local_desktop` do not break desktop bootstrap,
- login/signup/refresh/logout routes remain functional where hosted mode is
  enabled.
