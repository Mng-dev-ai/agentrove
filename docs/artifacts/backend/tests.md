# Backend Tests

Read this **before adding or modifying anything under `backend/tests/`.**

Backend tests are **endpoint/API tests only**. We don't write standalone service tests. Test through the real HTTP/WebSocket route so the real route handlers, dependencies, and services run together — only external boundaries (email, Docker, ACP, third-party APIs) are stubbed.

---

## Where tests live

```
backend/tests/
├── conftest.py          # fixtures, factories, MemoryStore (Redis), FakeSandboxProvider
├── test_auth.py
├── test_chat.py         # large — chat CRUD, streaming, queue, sub-threads
├── test_websocket.py
├── test_sandbox.py
├── test_workspace.py
├── test_github.py
├── test_skills.py
├── test_settings.py
├── test_models.py       # ai_model endpoint
├── test_attachments.py
└── test_queue.py        # if present; otherwise queue tests live in test_chat.py
```

**Tests live directly under `backend/tests/`** — flat, one file per endpoint area. Don't nest by router folder. (See `CLAUDE.md` testing notes — preserved across the harness.)

---

## Fixtures

Defined in `conftest.py`. Most-used:

| Fixture | What it gives you |
|---|---|
| `app` | FastAPI app instance with overridden dependencies |
| `client` | `httpx.AsyncClient` against the app |
| `db_session` | `AsyncSession` against the test DB |
| `database` | DB lifecycle (create/drop tables per session) |
| `create_user` | `UserFactory` async factory |
| `login` | `LoginClient` helper — logs a user in and returns an authenticated client |
| `email_capture` | `EmailCapture` — replaces SMTP, lets tests assert sent emails |
| `settings_override` | `SettingsOverride` — runtime patches to `Settings` (e.g., `REGISTRATION_DISABLED`) |

### What gets stubbed vs. what runs real

✅ **Real**: route handlers, dependencies, services, DB writes, business logic, validation, auth flow.

⚠️ **Stubbed at the boundary only**:

- Email — `EmailCapture` collects calls instead of sending SMTP.
- Docker / Host sandbox — `FakeSandboxProvider` (in conftest) replaces `SandboxProvider`.
- ACP / agent processes — fake adapters that emit pre-canned event streams.
- Redis — `MemoryStore` (in conftest) replaces `CacheStore` / pub-sub.
- GitHub / external HTTP — `httpx` mocked or replaced via dependency override.

---

## Test database

- Uses a real isolated SQLite test DB (file per session).
- Tables created from `Base.metadata` at session start; dropped at end.
- The `database` fixture handles lifecycle. Don't roll your own.
- Inside a test, mutations go through real services — don't insert via raw SQL.

---

## Patterns

### ✅ Mechanized

- Pytest discovers `test_*.py` automatically.
- `@pytest.mark.anyio` is required on async tests (CI configured for it).

### ⚠️ Advisory

- **Test through HTTP/WebSocket.** A test calling `chat_service.create_chat(...)` directly is wrong. Make the API call.
- **Use `LoginClient`** for authenticated requests; don't manually construct `Authorization` headers.
- **Assert at the boundary too.** If your endpoint returns a Pydantic schema, assert the JSON shape; don't peek at internal state.
- **One test = one scenario.** Don't bundle unrelated assertions; split.
- **Provider tests use fake ACP boundaries** — never call live Claude / Codex / OpenCode / Cursor / Copilot. (See `golden_principles.md` §1 — no external services in default test runs.)

---

## CI

`.github/workflows/backend-checks.yml` runs `pytest` on every PR that touches `backend/`, `sandbox/`, or `scripts/`. The job is named **Backend Tests** — keep it generic. Don't split into `test_chat`-specific job names; just expand the pytest invocation.

---

## Anti-patterns to refuse

- ❌ **Standalone service tests.** Test the endpoint that exercises the service.
- ❌ **Tests nested by endpoint folder** (`tests/api/endpoints/test_chat.py`). Flat layout.
- ❌ **Calling real Claude / Codex / OpenCode / Cursor / Copilot CLIs from tests.** Always fake.
- ❌ **Real Docker container creation in tests.** `FakeSandboxProvider`.
- ❌ **Real SMTP from tests.** `EmailCapture`.
- ❌ **`@pytest.mark.skip` without an issue link.** A flaky test is a bug; quarantine explicitly. (See `docs/done.md`.)
- ❌ **Asserting against the test DB via raw SQL.** Go through services / endpoints.
- ❌ **Sharing fixture state across tests** in a way that breaks ordering. Tests should be independent.

---

## When you're stuck — canonical examples

- Authenticated CRUD test: `backend/tests/test_workspace.py`
- Streaming endpoint test (SSE + queue): `backend/tests/test_chat.py`
- WebSocket auth + I/O: `backend/tests/test_websocket.py`
- Email-sending flow: `backend/tests/test_auth.py` (registration → verification)
- Provider-faked sandbox flow: `backend/tests/test_sandbox.py`

---

## Recent prior art

- **PR #572** — Add backend chat, websocket, and workspace endpoint tests. Read for: how a fresh round of endpoint tests is shaped.
- **PR #570** — Add backend chat endpoint tests.
- **PR #565** — Add backend chat queue endpoint tests.
- **PR #568** — Add backend skills endpoint tests.
- **PR #563** — Add backend settings and workspace endpoint tests.

These five PRs (April 2026) are the canonical reference for what a "good test PR" looks like in this repo. Open one and copy the shape.
