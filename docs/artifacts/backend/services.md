# Backend Services

Read this **before adding or modifying any class in `backend/app/services/`.**

Services are **stateful, I/O-bound business logic**: DB access, external API calls, sandbox commands. Class-based, instantiated with their dependencies, injected into routes via `Depends()`.

---

## Where services live

```
backend/app/services/
├── exceptions.py             # ServiceException + 10 domain subclasses, ErrorCode enum
├── chat.py                   # ChatService — chat CRUD, search, sub-thread aggregation
├── message.py                # MessageService — message persistence & event log
├── agent.py                  # AgentService — orchestrates ACP + sandbox + streaming
├── sandbox.py                # SandboxService — files, terminal, command execution
├── git.py                    # GitService — branches, diff, commit, worktrees, checkpoints
├── user.py                   # UserService — settings, persona/env-var management
├── workspace.py              # WorkspaceService
├── github.py                 # GitHubService — repo listing, PR ops via httpx
├── queue.py                  # QueueService — Redis-backed message queue
├── auth_email.py / email.py  # email sending (SMTP)
├── refresh_token.py          # RefreshTokenService
├── attachment.py             # AttachmentService
├── permission.py             # PermissionService — agent permission requests
├── streaming/                # streaming runtime (see docs/domains/streaming.md)
├── sandbox_providers/        # Docker vs Host abstraction (see docs/domains/sandbox.md)
└── acp/                      # ACP client + adapters (see docs/domains/providers.md)
```

---

## Service shape

### ✅ Mechanized

- mypy strict — every method needs full type annotations.

### ⚠️ Advisory

- **Class-based**, not module-level functions.
- **Inherit `BaseDbService[T]`** when the service primarily reads/writes one aggregate root. It holds the `SessionFactory` and provides common patterns.
- **Constructor takes a `session_factory: async_sessionmaker[AsyncSession]`** (or `SessionLocal`), plus any other services it composes. Example: `ChatService(user_service, session_factory)`.
- **Open sessions inside methods** with `async with self.session_factory() as session:`. Don't share sessions across methods.
- **Compose services**, don't duplicate. `AgentService` composes `ChatService`, `SandboxService`, `MessageService`, etc.
- **One service per aggregate root.** When a service grows responsibilities for two distinct aggregates, split it. (Example: `GitService` was split out of `SandboxService` — see `golden_principles.md` §9 and PR history.)
- **Don't extract helper modules for a single aggregate's logic.** Methods on the service stay together.

---

## Exceptions

- **Raise domain exceptions** — `ChatException`, `SandboxException`, `AuthException`, `GitHubException`, `WorkspaceException`, `UserException`, `StorageException`, `MessageException`, `AttachmentException`, `AgentException`. Each carries `error_code: ErrorCode`, `details: dict`, `status_code: int`.
- Use the most specific subclass. The default status codes are sensible:
  - `ChatException` → 400
  - `AuthException` → 401
  - `SandboxException`, `AgentException`, `StorageException` → 500
  - `GitHubException` → 502
- **Narrow `try/except`** — wrap only the lines that need recovery. Never `except Exception:` when failure modes are known. (See `golden_principles.md` §6.)
- **Don't translate exceptions across boundaries just to change the type.** Routes already translate at `core/deps.py`.

---

## Calling external systems

- **httpx for HTTP** (async). Build a client per call site or reuse a long-lived one — don't mix.
- **aiodocker for Docker.** Lazy-instantiate; GC handles cleanup. Don't `try/finally` close.
- **Redis via the `cache` helpers** (`CacheStore`, `CachePubSub`). Don't reach for raw `redis.asyncio` clients in service code.
- **Sandbox shell commands** go through `SandboxService.execute_command(...)` — never `asyncio.create_subprocess_shell` directly.
- **ACP** goes through the adapter layer in `services/acp/` — never speak the protocol from a service directly. (See `docs/domains/providers.md`.)

---

## Caching

- `CacheStore` (Redis) is for **read-through caching of expensive computed values**, not for coordination.
- Always set TTL. **Never write a key without TTL** — single-user app, but unbounded growth is still bad.
- Cache keys: stable prefixes like `REDIS_KEY_USER_SETTINGS`. Define them as module-level constants in the service that owns them.
- On invalidation: delete the key in the same method that mutates the underlying state.

---

## Queues

- `QueueService` is **Redis-list-backed FIFO**, not a distributed broker. (See `golden_principles.md` §1.)
- Queue keys are scoped per chat: `chat:{chat_id}:queue`.
- Enqueue from request handlers; dequeue happens in the streaming runtime.
- Don't add cross-instance coordination — there's only one process.

---

## Sandbox & Git

These have their own domain maps. Read those before touching `SandboxService` or `GitService`:

- `docs/domains/sandbox.md`
- `docs/domains/git.md`

---

## Anti-patterns to refuse

- ❌ **Module-level service functions** (`def get_chat(id): ...` outside a class).
- ❌ **Instantiating services manually inside other services.** Use the constructor; let `deps.py` wire.
- ❌ **Sharing an `AsyncSession` across method calls.** Open a fresh `async with` per call.
- ❌ **Bare `except Exception:`** when failure modes are known.
- ❌ **Raising `HTTPException` from a service.** Use a domain exception.
- ❌ **Pre-flight compatibility checks when a fallback exists.** Let it fall through. (See `golden_principles.md` §2.)
- ❌ **Adding distributed-system patterns** (cross-process locks, multi-replica heartbeats). Single process. (See `golden_principles.md` §1.)
- ❌ **Resource cleanup boilerplate for short-lived clients.** GC handles `aiodocker.Docker`, `httpx.AsyncClient` (when scoped). Only add cleanup for long-lived pools.
- ❌ **Building elaborate rollback for failure paths.** Log + best-effort recovery (re-queue) is sufficient. (See `golden_principles.md` §2.)

---

## When you're stuck — canonical examples

- Service with composed sub-services + transactional flow: `backend/app/services/agent.py`
- DB-only CRUD service: `backend/app/services/workspace.py`
- External-API service (httpx): `backend/app/services/github.py`
- Service split from a sibling: `backend/app/services/git.py` (split from `sandbox.py`)
- Provider-abstracted service: `backend/app/services/sandbox.py` + `services/sandbox_providers/`

---

## Recent prior art

- **PR #531** — Refactor service layer and terminal WebSocket encapsulation. Read for: the refactor pattern when a service has accumulated cross-cutting concerns.
- **PR #460** — Refactor endpoint helpers into proper service/utils/deps layers.
- **PR #469** — Remove silent fallback defaults and make errors explicit. Read for: how raising-vs-defaulting plays out.
- **PR #330** — Clean up ChatService: remove dead code, inline wrappers, deduplicate logic. Read for: dead-code-sweep discipline (`golden_principles.md` §3).
- **PR #465** — Refactor adapter pattern to data-returning abstract methods. Read for: provider abstraction shape.
