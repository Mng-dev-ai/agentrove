# MyBox G2 Local-First Desktop Access Completed Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the desktop/Tauri app usable in local mode without hosted sign-in while preserving hosted/web authentication and workspace ownership boundaries.

**Architecture:** G2 introduces an explicit backend-owned desktop-local identity path. Tauri already starts the backend with `DESKTOP_MODE=true`; the backend should expose a narrow local bootstrap/session mechanism only in that mode, and the frontend should consume that mechanism instead of using a frontend-only auth bypass.

**Tech Stack:** FastAPI, fastapi-users, SQLAlchemy async models/services, React, Zustand auth store, TanStack Query auth hooks, Tauri desktop mode environment, existing pytest/Vitest/build checks where available.

---

## Context

G1 established the local-first access contract:

- desktop local mode should not require hosted sign-in,
- hosted/web mode must not be weakened,
- auth relaxation must be backend-owned or runtime-mode-owned,
- existing auth code should be changed deliberately, not deleted.

Current implementation facts:

- `frontend/src-tauri/src/main.rs` starts the backend with `DESKTOP_MODE=true`,
  `SECRET_KEY`, `DATABASE_URL`, and `STORAGE_PATH`.
- `backend/app/core/config.py` already has `DESKTOP_MODE: bool = False` and
  desktop storage defaults.
- `frontend/src/App.tsx` treats a session as authenticated only when the
  frontend auth store is authenticated and `authService.getToken()` exists.
- `frontend/src/components/routes/AuthRoute.tsx` redirects protected routes to
  `/login` when unauthenticated.
- `backend/app/api/endpoints/auth.py` owns hosted login/register/refresh/logout.
- `backend/app/core/security.py` and `backend/app/core/deps.py` enforce user and
  workspace ownership through current-user dependencies.

G2 must bridge desktop mode through real backend identity, not fake frontend
state.

## Non-Goals

- No harness registry.
- No harness switcher.
- No OpenClaw adapter.
- No UI redesign.
- No removal of hosted auth, refresh tokens, signup, password reset, or email
  verification.
- No unauthenticated broad API access.
- No bypass that trusts only `isTauri()` or a frontend environment flag.

## Desired User Behavior

Desktop local mode:

- User opens the app.
- Backend creates or resolves a local desktop user/profile.
- Frontend gets a real access token/session for that local profile.
- Protected routes such as chat and settings work without manual hosted login.
- Workspace ownership remains scoped to that local profile.
- Login/signup pages can remain available but are not the local desktop entry
  blocker.

Hosted/web mode:

- Existing login/signup/auth behavior remains required.
- No local bootstrap endpoint works when `DESKTOP_MODE=false`.
- Existing tests for hosted auth remain meaningful.

## Proposed Design

Add a desktop-only endpoint:

```text
POST /api/v1/auth/desktop/local-session
```

Behavior:

1. If `settings.DESKTOP_MODE` is false, return `404` or `403`.
2. Create or fetch a deterministic local desktop user, for example:
   - email: `local@mybox.desktop`
   - username: `local_desktop`
   - verified: true
   - active: true
3. Ensure `UserSettings` exists for that user using existing user/settings
   service patterns.
4. Issue the same JWT access token shape used by hosted login.
5. Return a response compatible with existing auth storage expectations:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "bearer",
  "mode": "desktop-local",
  "user": {
    "id": "...",
    "email": "local@mybox.desktop",
    "username": "local_desktop"
  }
}
```

Refresh-token handling:

- Preferred: create a real refresh token row through `RefreshTokenService`, same
  as hosted login.
- If this is blocked by schema/service assumptions, stop and report; do not
  invent a separate token system.

Frontend:

- Add a small desktop-local bootstrap service/hook that runs only after Tauri
  backend port resolution.
- If no token exists and desktop mode is active, call the desktop local-session
  endpoint, store tokens through existing `authStorage`, then mark auth store
  authenticated.
- Preserve hosted login flow for web mode.
- Avoid making `AuthRoute` trust frontend-only desktop state.

## Files Likely To Change

Backend:

- `backend/app/api/endpoints/auth.py`
- `backend/app/core/config.py` only if a new explicit setting is needed.
- `backend/app/services/user.py` if a helper is needed to create local settings
  cleanly.
- `backend/app/models/schemas/auth.py` for a desktop local-session response
  schema if the existing `Token` schema is insufficient.
- `backend/tests/test_auth.py`

Frontend:

- `frontend/src/services/authService.ts`
- `frontend/src/hooks/queries/useAuthQueries.ts`
- `frontend/src/App.tsx`
- `frontend/src/store/authStore.ts` only if the existing boolean auth state is
  not enough.
- `frontend/src/types/user.types.ts` if response typing changes.

Docs/tests:

- `docs/mybox/contracts/local-first-access.md`
- `docs/mybox/testing/baseline.md`
- `docs/mybox/inventory/features.yaml` if ownership/test requirements change.
- `docs/mybox/graph/*` regenerated after implementation.

Do not touch:

- OpenClaw, Workflow OS, Atlas, active MyBox HTML repo, MyBox bridge.
- Harness registry/switcher code.

## Task 1: Backend desktop-local session endpoint

**Files:**
- Modify: `backend/app/api/endpoints/auth.py`
- Modify: `backend/app/models/schemas/auth.py` if needed
- Modify: `backend/tests/test_auth.py`

- [x] **Step 1: Add failing backend tests**

Add tests proving:

- `POST /auth/desktop/local-session` returns 404 or 403 when
  `DESKTOP_MODE=false`.
- The same endpoint returns a bearer token when `DESKTOP_MODE=true`.
- The returned token works with `GET /auth/me`.
- Repeated calls return the same local user identity, not many duplicate local
  users.
- Hosted login tests still pass.

Expected command:

```bash
cd backend && pytest tests/test_auth.py -q
```

Expected before implementation: new tests fail because endpoint does not exist.

- [x] **Step 2: Implement desktop-local user resolution**

Use existing `User` and `UserSettings` patterns. Do not bypass DB ownership by
creating an in-memory fake user.

Rules:

- only active when `settings.DESKTOP_MODE` is true,
- local user must be active and verified,
- user creation must be idempotent,
- if creation races, handle unique constraint by fetching the existing user.

- [x] **Step 3: Issue normal JWT and refresh token**

Use `get_jwt_strategy()` and `RefreshTokenService.create_refresh_token()` so
the frontend can reuse existing auth storage and refresh flow.

- [x] **Step 4: Run focused backend tests**

```bash
cd backend && pytest tests/test_auth.py -q
```

Expected: pass.

## Task 2: Frontend desktop bootstrap

**Files:**
- Modify: `frontend/src/services/authService.ts`
- Modify: `frontend/src/hooks/queries/useAuthQueries.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/types/user.types.ts` if needed

- [x] **Step 1: Add local-session client method**

Add `authService.startDesktopLocalSession()` that calls:

```text
POST /auth/desktop/local-session
```

It must store returned access and refresh tokens through existing
`authStorage.setToken()` and `authStorage.setRefreshToken()`.

- [x] **Step 2: Add hook/mutation for desktop local bootstrap**

Add a query or mutation in `useAuthQueries.ts` that invokes the service method.
It should be disabled by default and called explicitly from app boot logic.

- [x] **Step 3: Wire App boot carefully**

In `frontend/src/App.tsx`, after Tauri backend port resolution and auth storage
hydration:

- if `isTauri()` is false, do nothing new,
- if a token already exists, preserve current behavior,
- if no token exists, call desktop local bootstrap,
- on success, mark auth store authenticated and allow protected routes,
- on failure, show an honest desktop auth/bootstrap error instead of silently
  falling back to hosted login.

Do not change `AuthRoute` into a blanket desktop bypass.

- [x] **Step 4: Run frontend type/build checks**

```bash
cd frontend && npm run typecheck
cd frontend && npm run build
```

If dependencies are unavailable, record the exact failure and run the smallest
available syntax/static checks instead.

## Task 3: Route/API/security regression checks

**Files:**
- Modify tests only as needed.

- [x] **Step 1: Verify hosted mode still requires auth**

Add or preserve tests proving protected chat/workspace/sandbox routes reject
missing auth when `DESKTOP_MODE=false`.

- [x] **Step 2: Verify desktop local user owns workspaces**

Add tests or integration coverage showing workspaces created under the local
desktop user are still scoped to that user id. Do not make workspace access
global.

- [x] **Step 3: Verify websocket/auth compatibility**

If desktop local tokens are normal JWTs, existing SSE/WebSocket token paths
should continue to work. Add a note or test confirming the first-frame/query
token validation accepts the desktop local token.

## Task 4: Docs, graph, and inventory updates

**Files:**
- Modify: `docs/mybox/contracts/local-first-access.md`
- Modify: `docs/mybox/testing/baseline.md`
- Modify: `docs/mybox/inventory/features.yaml`
- Modify: `docs/mybox/graph/*`
- Modify: `docs/generated/*`
- Add completed plan: `plans/completed/mybox_g2_local_first_access.md`

- [x] **Step 1: Update the local-first contract**

Record the implemented runtime-mode boundary and endpoint name.

- [x] **Step 2: Update testing baseline**

Add the exact test commands run for G2.

- [x] **Step 3: Update inventory if behavior changed**

At minimum update `F-AUTH-001` risks/tests if implementation details differ
from this plan.

- [x] **Step 4: Regenerate graph and repo maps**

```bash
node scripts/mybox/graph/build-codebase-graph.mjs
node scripts/mybox/checks/check-mybox-graph.mjs
node scripts/generate-repo-map.mjs
```

Expected: graph and generated maps update cleanly.

## Task 5: Final verification and closeout

Run, as available:

```bash
node --check scripts/generate-repo-map.mjs
node --check scripts/mybox/graph/build-codebase-graph.mjs
node --check scripts/mybox/checks/check-mybox-inventory.mjs
node --check scripts/mybox/checks/check-mybox-graph.mjs
node scripts/mybox/checks/check-mybox-inventory.mjs
node scripts/mybox/graph/build-codebase-graph.mjs
node scripts/mybox/checks/check-mybox-graph.mjs
node scripts/generate-repo-map.mjs
git diff --check
cd backend && pytest tests/test_auth.py -q
cd backend && pytest tests/test_workspace.py tests/test_chat.py tests/test_sandbox.py -q
cd frontend && npm run typecheck
cd frontend && npm run build
```

If full frontend/backend dependency checks cannot run on the MacBook Air, record
the exact reason in the closeout and do not claim they passed.

## Done When

- Desktop/Tauri local mode can get a real backend-issued token/session without
  hosted sign-in.
- Hosted/web mode still requires auth.
- Protected routes are not broadly unauthenticated.
- Workspace ownership is still user-scoped.
- Existing hosted login/register/refresh/logout tests pass.
- Frontend uses existing auth storage rather than a separate fake desktop auth
  state.
- G2 docs, graph, inventory, and generated maps are updated.

## Parallelization

Do not run backend auth implementation and frontend app-boot implementation as
separate write-capable agents in parallel. They share the token/session
contract.

Safe parallel support:

- read-only reviewer can inspect auth/security assumptions,
- read-only reviewer can inspect frontend boot flow,
- test-only worker can draft expected regression scenarios after the endpoint
  contract is stable.

## First Implementation Recommendation

Implement backend endpoint and tests first. Do not touch frontend boot until the
backend endpoint returns a normal token and `GET /auth/me` works with that
token. That keeps the safety boundary where it belongs: backend/runtime mode
first, UI second.
