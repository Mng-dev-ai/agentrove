# Agentrove agent guide

Facts and rules for changing this repo. Search with `.worktrees/`, `node_modules/` and `target/` excluded: `.worktrees/` holds stale copies of the whole repo.

## Layout

- `backend/`: FastAPI app (`app/api/endpoints`, `app/services`, `app/models`, `app/core`, `app/db`), Alembic `migrations/`, `tests/`, `entrypoint.sh`, `Dockerfile`.
- `backend/app/services/acp/`: ACP agent sessions (`adapters.py` has one adapter per agent CLI: Claude, Codex, Copilot, Cursor, Grok, OpenCode, Antigravity).
- `mcp-server/`: the Agentrove MCP server (`server.py`) and its HTTP client for the backend (`client.py`). It sits beside `backend/`, not inside it; the API image copies it to `/app/mcp-server/` and tests add it to `sys.path` (`backend/tests/bootstrap.py`).
- `frontend/`: React + Vite + TypeScript app, also the Tauri desktop shell (`frontend/src-tauri`, Rust).
- `desktop/run_build.mjs`: builds the desktop backend sidecar (`frontend/backend-sidecar`) that Tauri bundles.
- `backend/app/catalog/opencode.py` is generated: change it only by editing `scripts/opencode_catalog_overrides.toml` (provider allow-list, display-name overrides, keep-list, legacy flags) and running `python3 scripts/sync_opencode_catalog.py [models.dev snapshot.json]` with ruff 0.15.0 on `PATH`. The daily bump workflow runs it too.
- `sandbox/`: sandbox Docker image; `scripts/`: `install-hooks.sh` (sets `core.hooksPath=.githooks`; the pre-commit hook runs lint-staged in `frontend/` and `pre-commit` on staged backend files).

## Backend

- SQLite only (aiosqlite): WAL, `NullPool`, `busy_timeout` 30s (`backend/app/db/sqlite.py`, `backend/app/db/session.py`). No Postgres.
- One uvicorn worker (`backend/entrypoint.sh`). SQLite's busy wait polls and is not FIFO, so lock waits can reorder requests.
- Client timeouts are shorter than the busy timeout: paired-machine requests 15s (unpair 5s) in `frontend/src-tauri/src/machine.rs` and `frontend/src/services/machineVault.ts`; web token refresh 45s (`frontend/src/lib/api.ts`). A request the client abandoned can still be served later and out of order. Account for this in auth and DB-write changes.
- Code style: ruff line length 88, py312, mypy `disallow_untyped_defs` (`backend/pyproject.toml`). Use the Alembic setup in `backend/migrations/`; `backend/tests/test_migrations.py` covers it.
- Tests use `backend/tests/conftest.py` fixtures (temp-file SQLite via `bootstrap.py`, `fake_acp_agent.py` for ACP). Coverage gate is 85%.

## MCP server

- MCP tokens are agent tokens. `_enforce_agent_routes` in `backend/app/core/user_manager.py` returns 403 for any `(method, path)` not in `AGENT_ROUTES`.
- Every backend route that `mcp-server/client.py` calls must be added to `AGENT_ROUTES`. `test_agent_route_allowlist_is_exactly_what_the_mcp_client_calls` in `backend/tests/test_auth.py` asserts the two sets are equal. Passing endpoint-level dependencies (e.g. chat membership) does not make a route reachable from MCP.

## Frontend

- Path alias `@/` = `frontend/src/`. Vitest merges `vite.config.ts`; default environment is `node`, component tests opt in with `// @vitest-environment jsdom`. Setup is `frontend/src/test/setup.ts`; shared fixtures in `frontend/src/test/fixtures.ts`.
- jsdom has no `ResizeObserver`. A component that adds one breaks its existing tests: stub it per test file as `Input.test.tsx` and `QueueMessageCard.test.tsx` do (`vi.stubGlobal` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`).
- No `@testing-library/user-event`; use `fireEvent`.
- Chat events (`chat_created`, `stream_started`, `title_updated`) are parsed and dispatched once, in `frontend/src/hooks/chatEventSync.ts`. `frontend/src/hooks/useChatEvents.ts` (local) and `frontend/src/hooks/useRemoteMachineSync.ts` (remote machines) each pass it a `ChatEventOrigin` holding only what differs per origin; a step both origins need belongs in `chatEventSync.ts`.
- `patchChatInCache` (`frontend/src/hooks/queries/useChatQueries.ts`) writes with `Query.setState` after `replaceEqualDeep`. `setQueryData` would clear pending invalidations; a bare `setState` would drop structural sharing. Keep both properties.
- Composer lifetime: `ChatPage` keys `AgentPane` by chat id and `ChannelPage` keys `ChannelView` by channel id, so a chat switch remounts the composer and late callbacks cannot write across chats.
- `handleDroppedFiles` (`frontend/src/hooks/useInputFileOperations.ts`) closes over the render-time `attachedFiles` and `onAttach` takes a full array. Never call it after an `await` except through a latest-value ref.
- There is no insert-at-cursor helper; `useInputAttachments.ts` uses `document.execCommand('insertText')`.
- Do not use `''` as an object key: Rollup has dropped an empty-string key read only through a function parameter, which broke production chunks that dev server and vitest do not show.

## Compatibility rules

- Released frontends can be older than the backend they talk to. They ignore channel-feed envelope kinds they do not know (`default` case of `applyToSlice` in `frontend/src/store/channelStore.ts`; frontends up to v0.1.69 wiped the open channel instead and are unsupported), so a new kind is safe when older frontends still work without it. Changing or removing an existing kind or payload field breaks them.
- Older backends ignore unknown request fields, so new optional request fields are safe.
- Grok CLI is pinned as `grok_version=` in both Dockerfiles and bumped to `x.ai/cli/stable` by `scripts/bump-acp-providers.sh`: its ACP behavior changes arrive through bump PRs. Its modes are UI labels mapped to the CLI's `default`/`plan`; always-approve is the `--always-approve` launch flag; auto-review is `_meta.autoMode` on session new/load; effort is the `reasoning_effort` config option (ignored on load). See `GrokAgentAdapter` in `backend/app/services/acp/adapters.py`.

## Checks CI runs

Backend (`.github/workflows/backend-checks.yml`, Python 3.12, runs when `backend/`, `mcp-server/`, `sandbox/` or `scripts/` change). From `backend/`:

- Lint tools only, no project deps: `pip install ruff==0.15.0 mypy types-redis deptry pip-audit`. A venv with project deps gives dozens of unrelated mypy errors; use a throwaway venv with just these.
- `ruff check . ../mcp-server`, `ruff format --check . ../mcp-server`, `mypy app/`, `mypy --config-file pyproject.toml ../mcp-server`, `deptry . --requirements-files requirements.txt`. `pip-audit -r requirements.lock` is non-blocking.
- Direct deps live in `backend/requirements-core.txt` (shared with the desktop sidecar); `backend/requirements.txt` includes it with `-r` (deptry follows the include) and adds the server-only packages. `desktop/requirements.lock` is compiled from the core list constrained by `backend/requirements.lock`; CI recompiles it with `uv==0.13.10` and fails on `git diff --exit-code desktop/requirements.lock`. Both compile commands, run from the repo root, are in the lock headers.
- Tests: `uv pip install -r backend/requirements.lock pytest pytest-asyncio pytest-cov pytest-xdist ruff==0.15.0`, then `COVERAGE_CORE=sysmon pytest tests -n auto --cov=app --cov-fail-under=85`.

Docker Smoke (`.github/workflows/docker-smoke.yml`, runs when either Dockerfile, `scripts/bump-acp-providers.sh` or `.github/actions/docker-smoke/` change): builds `backend/Dockerfile` and `sandbox/docker/Dockerfile` for linux/amd64 without pushing, then runs `--version` of every bundled agent CLI in each image (`.github/actions/docker-smoke/`). The daily bump workflow runs the same action before opening its PR, because `pull_request` runs on its `github.token` PRs wait for manual approval; the PR job is skipped on `bot/bump-acp-providers`.

Frontend (`.github/workflows/frontend-checks.yml`, Node 20, runs when `frontend/` changes). From `frontend/`, after `npm ci --legacy-peer-deps`:

- `npm run lint`, `npm run format:check` (`prettier --check .`), `npm run typecheck`, `npm test` (`vitest run`, all tests), `npm run build`.
- Also verify frontend changes on a production build, not only the dev server: `npx vite build --mode desktop` into a scratch `--outDir`, served statically.

PR checks do not run while the PR conflicts with `main`.

## Desktop / release

- `.github/workflows/desktop-release.yml` runs on `v*` tags and `workflow_dispatch` on macOS; `validate_only=true` builds, signs and notarizes without publishing.
- No PR check compiles the Tauri Rust (`frontend/src-tauri`, toolchain in `rust-toolchain.toml`). The validate-only run is the compile proof: `gh workflow run desktop-release.yml --ref <branch> -f validate_only=true`. Do not list `cargo` as a CI check.
- `desktop/run_build.mjs` pins the bundled Python, Node, ripgrep, claude-agent-acp, Claude Code and codex-acp versions and supports macOS arm64/x64 only. Tauri bundles `frontend/backend-sidecar/` as a resource.
- Tauri's resource copy turns symlinks and hardlinks into full files. After changing what `run_build.mjs` installs, list the release tarball (`tar -tzv`) for duplicated large binaries.
- Cargo caches saved on a tag ref are unreadable by later tags; `.github/workflows/desktop-rust-cache.yml` warms the cache from `main` (on Rust toolchain/lock changes and a twice-weekly schedule).
