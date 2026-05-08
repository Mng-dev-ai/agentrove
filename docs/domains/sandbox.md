# Sandbox

The execution environment for agent tools — file I/O, shell commands, terminals, git operations. Two concrete providers: **Docker** (web mode, containers per workspace) and **Host** (desktop mode, direct host filesystem). All callers go through the abstract `SandboxProvider` interface.

## Entry points

- Service: `backend/app/services/sandbox.py` — `SandboxService` (files, terminal, command execution).
- Provider abstraction: `backend/app/services/sandbox_providers/base.py` — `SandboxProvider` ABC.
- Docker impl: `backend/app/services/sandbox_providers/docker_provider.py`.
- Host impl: `backend/app/services/sandbox_providers/host_provider.py`.
- Endpoint: `backend/app/api/endpoints/sandbox.py` (files, git, terminal HTTP routes).
- Endpoint: `backend/app/api/endpoints/websocket.py` (terminal WebSocket / PTY).
- Frontend: `frontend/src/components/sandbox/` (terminal, git, secrets); `frontend/src/services/sandbox<Service>.ts`.

## Vocabulary

- **Sandbox** — opaque execution environment owned by a workspace. `sandbox_id` is the container name (Docker) or workspace path (Host).
- **Workspace** — per-user mount of a project. Has a stable `sandbox_id`; multiple chats share the workspace's sandbox.
- **`worktree_cwd`** — chat-scoped git worktree path. When `worktree=true` is set on a chat request, the agent runs inside the worktree, not the workspace root.
- **PTY session** — interactive terminal multiplexed over WebSocket. Backed by tmux when `tmux_session` is provided.
- **Provider** — `Docker` (web) vs `Host` (desktop). Resolved at runtime via `SandboxProvider.create_provider(provider_type, workspace_path)` and `settings.DESKTOP_MODE`.

## Lifecycle

- Workspaces are **per-user**, created once and reused across multiple chats. **No per-chat container overhead.**
- `initialize_sandbox(sandbox_id, has_github_token)` is one-time setup (writes `GIT_ASKPASS` script).
- `delete_sandbox(sandbox_id)` is best-effort — logs failures, doesn't propagate. (See `golden_principles.md` §2.)

## SandboxService surface

Common methods (cite paths from `services/sandbox.py`):

- `execute_command(sandbox_id, command, envs)` — run shell command with user env vars (tokens, custom).
- `create_pty_session(sandbox_id, rows, cols, tmux_session)` — spawn PTY for terminal.
- `get_files_metadata(sandbox_id)` → `list[FileMetadata]` (via `git ls-files`).
- `get_file_content(sandbox_id, path)` — read file; base64-encode if binary (per `SANDBOX_BINARY_EXTENSIONS`).
- `delete_sandbox(sandbox_id)`.
- `resolve_workspace_path(rel_path)` — convert cwd-relative → runtime-absolute. Critical for agents operating inside containers.

## Cross-domain edges

- → **git**: `GitService` is split out from `SandboxService` (own module) but still executes via `SandboxService.execute_command`. See `docs/domains/git.md`.
- → **chat**: each chat carries `worktree_cwd`. Operations must propagate `cwd` through the full chain (backend → frontend service → React Query hook → UI).
- → **providers (ACP)**: agent processes are launched inside the sandbox; ACP communicates with them through stdio.
- → **streaming**: tool events from the agent (`tool_started` / `tool_completed`) reference sandbox state; UI components like `ChangedFilesPanel` read sandbox file metadata after a turn ends.

## Gotchas

- **Volume mounts are implicit.** Docker `/workspace` maps to host `$WORKSPACE_PATH`; Host provider uses workspace path directly. **Don't introspect Docker mounts at runtime** to figure out a host path — use `HOST_STORAGE_PATH` env var. (See `golden_principles.md` cross-cutting notes.)
- **`resolve_workspace_path`** must always be applied when an agent passes a sandbox-relative path — the route handler shouldn't pass through raw paths.
- **Cwd propagation**: when adding a new operation that takes `cwd`, propagate it through every layer; don't fall back silently to workspace root. (`golden_principles.md` cross-cutting notes; PR #469.)
- **Binary detection** uses extension list (`SANDBOX_BINARY_EXTENSIONS`); large text files aren't binary-flagged.
- **`delete_sandbox` failures** are logged, not raised — single-user app, orphaned containers are GC'd by ops.

## Recent prior art

- **PR #590** — Align host terminal home with agent home. Read for: parity between Docker and Host providers.
- **PR #588** — Update agent Docker tooling. Read for: sandbox Dockerfile and build.
- **PR #531** — Refactor service layer and terminal WebSocket encapsulation. Read for: how the terminal WS became a clean service surface.
- **PR #505** — Remove CLI auth sync and skill deployment from sandbox initialization. Read for: tightening init scope.
- **PR #551** — Drop sandbox_provider from user settings. Read for: provider resolution moving from per-user to global config.
- **PR #594** — Expand per-file diffs inline. Read for: cwd-aware diff fetching.
