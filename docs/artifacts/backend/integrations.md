# Backend Integrations

Read this **before calling any external system** — Docker, GitHub, ACP processes, SMTP, Redis. Each has a single owning service and a stub used in tests; reach for those, not the raw SDK.

---

## Catalog

| Integration | Owning service | SDK / library | Stub in tests |
|---|---|---|---|
| Docker (sandbox containers, web mode) | `SandboxProvider` (Docker variant) | `aiodocker` | `FakeSandboxProvider` |
| Host filesystem (sandbox, desktop mode) | `SandboxProvider` (Host variant) | `subprocess` / native | `FakeSandboxProvider` |
| Git inside the sandbox | `GitService` | shell via `SandboxService.execute_command` | `FakeSandboxProvider` returns canned stdout |
| GitHub REST API | `GitHubService` | `httpx` | mocked via dependency override |
| ACP (Claude / Codex / Copilot / Cursor / OpenCode) | `services/acp/` adapters | bespoke per-CLI process protocol | fake adapters in conftest |
| SMTP (verification, password reset) | `EmailService` | `aiosmtplib` | `EmailCapture` |
| Redis (cache + pub/sub) | `CacheStore`, `CachePubSub` | `redis.asyncio` | `MemoryStore` |
| Prometheus metrics | `prometheus-fastapi-instrumentator` | optional, skippable | not stubbed (no-op when disabled) |

Each row is owned by **one** service. Don't reach around it.

---

## Docker (sandbox)

- See `docs/domains/sandbox.md` for the full lifecycle and Docker-vs-Host abstraction.
- Use `aiodocker.Docker()` lazily. Don't `try/finally close()` — GC handles it. (See `golden_principles.md` §2.)
- Volume mounts are configured at container creation: `/workspace` inside the container maps to the host workspace path.
- Use `HOST_STORAGE_PATH` env var for container→host path translation. Don't introspect Docker mounts at runtime to figure out a host path. (See `golden_principles.md` §13 — env-var/config over runtime introspection.)

---

## GitHub

- All GitHub calls go through `GitHubService`. The user's PAT is encrypted at rest in `UserSettings.github_personal_access_token` (`EncryptedString` column).
- `Depends(require_github_token)` raises 400 if missing; `Depends(get_github_token)` returns `Optional[str]`.
- Use `GitHubException` (default 502) for upstream failures. Don't translate to a generic 500.
- See PR #589 — env defaults removed; the token must be present and explicit.

---

## ACP (Agent Client Protocol)

- One adapter per agent kind: Claude, Codex, Copilot, Cursor, OpenCode. Lives in `services/acp/adapters.py`.
- Each adapter declares supported features:
  - `NATIVE_FILE_TYPES[AgentKind]` — what file types are inlined as base64 vs. passed as sandbox-relative paths.
  - Permission mode → ACP `session_mode` mapping.
  - Whether the agent honors a replaced system prompt (Claude/Codex/OpenCode do; Cursor/Copilot don't — see PR #542).
- **`field_meta` (`_meta`)** is optional extensibility metadata. Don't put user-facing data there. (See `golden_principles.md` §1.)
- Bundled adapters in desktop builds: see PR #591.
- Read `docs/domains/providers.md` before adding a new agent or modifying adapter behavior.

---

## SMTP

- `EmailService` is the only thing that sends mail.
- Tests use `EmailCapture` — a fixture that records calls without sending.
- Don't catch SMTP errors silently; let them propagate so tests see the failure.

---

## Redis

- ✅ **Pub/sub + cache only.** Not a task broker. Not a coordination layer. (See `golden_principles.md` §1.)
- `CacheStore` for read-through caching with explicit TTL. **Never write a key without TTL.** (See `services.md`.)
- `CachePubSub` for cross-process notification (e.g., streaming envelopes published to subscribers — PR #370 is the defining example).
- `QueueService` uses Redis lists for **per-chat FIFO message queues** — not a distributed work queue.
- `MemoryStore` replaces both in tests.

---

## httpx (general HTTP)

- Async only. `httpx.AsyncClient`.
- Scope an `AsyncClient` to one call site or one service — don't share a global one across services.
- Don't add retries with backoff unless asked; surface errors and let the caller decide.

---

## Anti-patterns to refuse

- ❌ **Reaching past the owning service.** No raw `aiodocker` from `chat.py`; use `SandboxService`.
- ❌ **Catching integration errors silently.** Either raise the domain exception or let it propagate.
- ❌ **Adding retries / circuit breakers** without an explicit ask.
- ❌ **Mocking integrations at the wrong layer in tests** — stub at the boundary (provider / fixture), not deep inside.
- ❌ **Calling real Claude / Codex / OpenCode / Cursor / Copilot CLIs in tests.** Always fake. (See `tests.md`.)
- ❌ **Using `_meta` to convey load-bearing user-facing data** through ACP. (See `golden_principles.md` §1.)
- ❌ **Adding distributed-coordination patterns to Redis usage.** Single process. (See `golden_principles.md` §1.)
- ❌ **Hardcoding host paths** by inspecting Docker mounts at runtime. Use env-var config (`HOST_STORAGE_PATH`).

---

## When something fails in production

- **Docker** — most failures surface as `DockerError` from `aiodocker`. Translate to `SandboxException`. Container creation issues (port collisions, image missing) are common — log the cause.
- **GitHub** — 401 (token expired), 403 (rate limit), 404 (repo gone). All wrap as `GitHubException` with the upstream status preserved in `details`.
- **ACP CLIs** — the adapter process can die. The streaming runtime detects this and emits a stream `error` event. See `docs/domains/streaming.md`.
- **SMTP** — provider-specific. Logs + retry on next user action; no internal queue.
- **Redis** — if Redis is down, cache reads should miss-and-fall-through, not block. Pub/sub failures degrade real-time updates but don't break persistence.

---

## Recent prior art

- **PR #591** — Bundle ACP adapters in desktop sidecar. Read for: how the desktop build embeds external CLIs.
- **PR #589** — Remove agent auth env defaults. Read for: tightening the contract with external agents (no implicit fallbacks).
- **PR #588** — Update agent Docker tooling. Read for: sandbox Dockerfile evolution.
- **PR #370** — Publish full stream envelopes via Redis pub/sub. Read for: the canonical Redis-as-pub/sub usage.
- **PR #586** — Cascade refresh tokens on user delete. Tangential, but illustrates the discipline of keeping data integrity at the integration boundary.
