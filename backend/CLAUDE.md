# CLAUDE.md (backend)

## Testing

- Backend tests are endpoint/API tests only — don't add standalone service tests
- Place backend tests directly under `backend/tests/` (e.g., `tests/test_auth.py`), not nested by endpoint folder
- Test through HTTP/WebSocket routes so the real route handlers, dependencies, and services run together
- Use a real isolated test database for backend endpoint tests when persistence matters
- Stub only external boundaries: email delivery, third-party APIs, ACP/provider processes, Docker/host sandbox execution, Redis/cache when needed
- Provider coverage should exercise endpoint flows with fake ACP/provider boundaries; don't call real Claude, Codex, OpenCode, Cursor, Grok, or Copilot in default tests
- CI's backend test job should stay generic (`Backend Tests`) and expand its pytest command as more test files are added

## Code Style

### Exceptions
- Keep `try/except` narrow — wrap only the code needing the specific recovery; safely-propagating code stays outside the `try`
- Narrow `except` clauses to specific types — never `except Exception` when failure modes are known
- Don't translate exceptions across boundaries just to change the type — catch-and-wrap only when the caller needs a different status/shape
- When catching a `ServiceException` subclass at the API boundary, use `exc.status_code` — don't hardcode a status that shadows the exception's classification
- When a function receives an optional targeting parameter (e.g., `cwd`, `workspace_id`) and the value is invalid, raise — don't silently fall back to a default target

### Input & Security
- Don't use Python `str.format()` or f-strings to interpolate untrusted content that may contain `{`/`}` (diffs, code, JSON) — use concatenation or `string.Template`
- Add `Field(max_length=...)` to all `str` fields on Pydantic request models; add `min_length=1` when empty is invalid

### Imports, Typing, Structure
- No inline imports unless needed to break a circular import
- Strong typing only — no `# type: ignore`, `# pyright: ignore`, `# noqa` to silence typing/import issues; fix types directly
- Don't define nested/inline functions — use module-level functions or class methods; a helper only used by a class must be a method on it
- Module-level constants go at the top of the file, right after imports/logger/settings — never between classes or functions
- Don't call private methods (`_method`) across files; make them public (and rename) if cross-file use is needed
- Don't use `TypedDict` with `total=False` when all keys are always present
- When defining an abstract method signature during a refactor, verify every parameter gets a meaningful value from all call sites

### FastAPI
- Don't instantiate services in route handlers — add a factory in `deps.py` and inject via `Depends()`; route files shouldn't import `SessionLocal`
- Endpoint files contain only route handlers — all business logic belongs in services. Inline no-op exception-translation wrappers at the call site; move reusable access/service helpers to `deps.py`; move pure utilities to `utils/`
- When multiple endpoints share parameter validation (e.g., token presence), extract a FastAPI dependency that raises on failure and returns the validated value

### Gotchas
- When closing/tearing down multiple independent resources in a loop, use `asyncio.gather(*[...], return_exceptions=True)` — don't serialize independent I/O
- Prefer env-var/config solutions over runtime introspection (e.g., `HOST_STORAGE_PATH` to map container→host paths, not inspecting Docker mounts at runtime)

## Module Organization

- Keep logic where it belongs — factory methods go on the class they construct (e.g., `Chat.from_dict`, `SandboxService.create_for_user`)
- Group related free functions into a class with static methods (e.g., `StreamEnvelope.build()` + `StreamEnvelope.sanitize_payload()`)
- Prefer one data structure over two when one serves both purposes — derive properties (e.g., `path.is_relative_to(base_dir)`) instead of tracking a parallel set
- **`utils/`** — stateless pure functions only (parsing, formatting, validation). No I/O, DB, services, or HTTP concerns. Raise `ValueError`; let callers translate.
- **`services/`** — stateful I/O-bound business logic (DB, API calls, sandbox commands). Instantiated with dependencies, injected via `Depends()`. Raise domain exceptions (`SandboxException`, `ChatException`, ...).
- **`core/deps.py`** — FastAPI DI wiring; instantiate services, validate access, translate domain exceptions to `HTTPException` at the boundary.
- **`core/security.py`** — auth/authz (token validation, password hashing, encryption, WebSocket auth handshake).
- When a service accumulates responsibilities from two distinct domains, extract the secondary into its own service (e.g., `GitService` split from `SandboxService`)
- Place class definitions (including `NamedTuple`/`TypedDict`) at the top of the file after imports — never between constants

## SQLAlchemy Model Conventions

- Always pair `default=` with `server_default=` — `default` only applies in Python/ORM
- Always specify `nullable=True|False` explicitly
- Always set max length on String fields (e.g., `String(64)`)
- Use `DateTime(timezone=True)` for all datetime fields
- Don't add `index=True` on an FK if a composite index already starts with that column

## Migration Workflow

- Generate migrations via Alembic autogenerate (don't write them by hand); manual edits to generated migrations are fine when needed for correctness
- Run Alembic commands inside the Docker backend container (not on host)
