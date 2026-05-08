# Backend Endpoints

Read this **before adding or modifying any FastAPI route, dependency, or response schema.**

Endpoints are FastAPI route handlers under `backend/app/api/endpoints/`. They contain **only routing concerns** — auth, parameter validation, calling a service, returning a response. Business logic lives in services.

---

## Where endpoints live

```
backend/app/api/endpoints/
├── auth.py              # login, register, refresh, password reset
├── chat.py              # chat CRUD + streaming SSE
├── sandbox.py           # files, terminal, git ops
├── workspace.py         # workspace CRUD
├── github.py            # GitHub token + repo ops
├── attachments.py       # file uploads
├── ai_model.py          # available models
├── skills.py            # workspace skills
├── settings.py          # user settings
├── websocket.py         # terminal WebSocket
└── queue.py             # message queue ops
```

Each file: `router = APIRouter(prefix=..., tags=[...])`. Routes registered with decorators on the router. Routers wired in `app/main.py`.

---

## Dependency injection

### ✅ Mechanized (FastAPI itself)

- Service factories live in `backend/app/core/deps.py` — never instantiate services in route handlers.
- Inject via `Depends(...)`. The route signature declares everything it needs.

### Common dependencies

| Need | Dependency | Source |
|---|---|---|
| Authenticated user | `Depends(get_current_user)` | wraps `fastapi-users` |
| DB session | `Depends(get_db)` → `AsyncSession` | `db/session.py` |
| Chat service | `Depends(get_chat_service)` | `core/deps.py` |
| Agent service | `Depends(get_agent_service)` | `core/deps.py` |
| Sandbox service | `Depends(get_sandbox_service)` | `core/deps.py` |
| User's GitHub token (required) | `Depends(require_github_token)` | `core/deps.py` (raises 400 if missing) |
| User's GitHub token (optional) | `Depends(get_github_token)` | `core/deps.py` |

### When to add a new dependency

- **Multiple endpoints share parameter validation** (e.g., token presence) — extract a dependency that raises and returns the validated value. (See `golden_principles.md` §9.)
- **A service needs to be instantiated with deps** — add a factory in `deps.py` that pulls those deps via `Depends()`. Don't hand-wire from inside the route.

---

## Request models

- Pydantic v2 `BaseModel` from `backend/app/models/schemas/`.
- **Every `str` field has `Field(max_length=...)`.** Add `min_length=1` when empty is invalid. (See `golden_principles.md` §7.)
- Validators live on the schema, not in the route. Use `@field_validator` for normalization.

---

## Response models

- Use `response_model=...` on every route — FastAPI handles serialization.
- Pydantic v2 with `ConfigDict(from_attributes=True)` for ORM mapping.
- **If a response field has a default, the corresponding frontend TypeScript type marks it required.** (See `golden_principles.md` §8.)

---

## Exceptions

### ✅ Mechanized

- mypy will catch `raise SomeException(...)` mismatches.

### ⚠️ Advisory

- **Raise domain exceptions** (`ChatException`, `SandboxException`, `AuthException`, `GitHubException`, `WorkspaceException`, `UserException`, `StorageException`, `MessageException`, `AttachmentException`, `AgentException`) — not bare `HTTPException` from inside services.
- **At the boundary, translate.** If you must catch a `ServiceException` in an endpoint, use `exc.status_code` — don't hardcode a status that shadows the exception's own classification. (See `golden_principles.md` §6.)
- **Don't translate exceptions across boundaries just to change the type.** Catch-and-wrap only when the caller needs a different status/shape. PR #469 ("Remove silent fallback defaults and make errors explicit") is the canonical example.
- **Narrow `except` blocks.** Wrap only the line(s) that need recovery; let unrelated errors propagate. Never `except Exception:` when failure modes are known.

### Domain exception hierarchy

`backend/app/services/exceptions.py`:

```
ServiceException(message, error_code: ErrorCode, details: dict, status_code: int)
├── ChatException        (default 400)
├── MessageException     (default 400)
├── SandboxException     (default 500)
├── AgentException       (default 500)
├── AuthException        (default 401)
├── GitHubException      (default 502)
├── WorkspaceException   (default 400)
├── UserException        (default 400)
├── StorageException     (default 500)
└── AttachmentException  (default 400)
```

Always raise the most specific subclass. The status code defaults are sensible — only override via the `status_code=` kwarg when there's a real reason.

---

## Auth on routes

- ✅ **Default**: `Depends(get_current_user)` — every endpoint requires authentication unless explicitly public.
- **Public endpoints** (auth login, public registration, health): no auth dependency, but document why.
- **Streaming endpoints** (SSE, WebSocket) often need `?token=` query-param auth because browsers can't set Authorization on `EventSource` / first-frame WebSocket. The query-param flow is in `core/security.py` (`get_user_from_token`). Don't reinvent it.
- **WebSocket auth handshake**: `wait_for_websocket_auth(ws)` reads first frame as JSON `{token: "..."}`, validates, closes with `WS_CLOSE_AUTH_FAILED` on failure.

---

## Rate limiting

`slowapi` decorators on sensitive endpoints (login, register, password reset). Example:

```python
@router.post("/jwt/login")
@limiter.limit("5/minute")
async def login(...): ...
```

Rate limits are advisory — the limiter applies them in production but is not enforced by tests.

---

## Streaming endpoints (SSE)

- Use `sse-starlette`'s `EventSourceResponse`.
- Query params: `chatId`, `messageId`, `seq` (resume cursor). See `docs/domains/streaming.md`.
- The actual envelope construction lives in `services/streaming/`. Endpoints just plumb through.

---

## Anti-patterns to refuse

- ❌ **Instantiating services in route handlers.** Use a factory in `deps.py`.
- ❌ **Importing `SessionLocal` in an endpoint file.** Inject `Depends(get_db)`.
- ❌ **Inline business logic in a route.** Move it to a service. The route is plumbing.
- ❌ **`raise HTTPException(...)` from inside a service.** Services raise `ServiceException` subclasses; the boundary translates.
- ❌ **Hardcoded status codes when re-raising a `ServiceException`.** Use `exc.status_code`.
- ❌ **`except Exception:` in a route.** Catch the specific domain exception.
- ❌ **Re-validating values that the endpoint already validated.** Validate at the boundary; trust internal code. (See `golden_principles.md` §2.)

---

## When you're stuck — canonical examples

- Standard CRUD endpoint: `backend/app/api/endpoints/workspace.py`
- Endpoint with service injection + domain exception translation: `backend/app/api/endpoints/chat.py`
- SSE streaming endpoint: `backend/app/api/endpoints/chat.py` (`stream_chat_sse`)
- WebSocket endpoint with auth handshake: `backend/app/api/endpoints/websocket.py`
- Endpoint with nested permission check: `backend/app/api/endpoints/sandbox.py` (workspace ownership)

---

## Recent prior art

- **PR #460** — Refactor endpoint helpers into proper service/utils/deps layers. Read for: how to disentangle a fat endpoint file.
- **PR #469** — Remove silent fallback defaults and make errors explicit. Read for: when to raise instead of defaulting.
- **PR #572** — Add backend chat, websocket, and workspace endpoint tests. Read for: test patterns matching the endpoint shape.
- **PR #563** — Add backend settings and workspace endpoint tests.
