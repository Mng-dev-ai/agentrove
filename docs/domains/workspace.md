# Workspace, Skills, Personas

A workspace is a per-user mount of a project directory. It owns the sandbox, the file structure, the per-agent **skills** (filesystem-scanned tool definitions), and shapes the slash-command surface the user sees. **Personas** are user-scoped system-prompt variants stored in `UserSettings`, gated to agents whose CLI honors a replaced system prompt.

## Entry points

- Model: `backend/app/models/db_models/workspace.py` — `Workspace`.
- Service: `backend/app/services/workspace.py` — `WorkspaceService`.
- Endpoint: `backend/app/api/endpoints/workspace.py`.
- Endpoint: `backend/app/api/endpoints/skills.py`.
- Schema for resources: `WorkspaceResources` in `backend/app/models/schemas/`.
- Frontend: `frontend/src/pages/LandingPage.tsx`, `frontend/src/components/settings/`.
- Frontend context: `ChatContext` exposes `customSkills`, `builtinSlashCommands`, `personas`.

## Vocabulary

- **Workspace** — per-user, has a stable `sandbox_id` and `workspace_path`. Multiple chats share it.
- **Resources** — `GET /workspaces/{workspace_id}/resources` → `WorkspaceResources` (skills + builtin slash commands).
- **CustomSkill** — workspace-level tool extension. Schema: `{ name, description, size_bytes, file_count, source, read_only }`. Discovered by scanning per-agent directories (`.opencode/skills/`, `.cursor/`, etc.). Per-agent (not shared across agents) — though OpenCode cross-reads other agents' dirs (PR #537).
- **Built-in slash commands** — keyed by `AgentKind`, enumerated server-side and filtered per chat's agent (PR #464).
- **Persona** — user-defined system prompt variant. Stored in `UserSettings.personas` as a JSON list of `{ name, systemPrompt }`. Selectable per chat. Only honored by **Claude / Codex / OpenCode** (see PR #542 and `providers.md`).
- **Custom env vars** / **custom instructions** — also on `UserSettings`. Custom env vars are plaintext (intentional, low-sensitivity).

## Cross-domain edges

- → **sandbox**: workspace owns `sandbox_id`. Workspace creation initializes the sandbox.
- → **providers (ACP)**: persona honoring is gated by `AgentKind`; skills are per-agent; slash commands are filtered by `AgentKind`.
- → **chat**: every chat is created within a workspace. Switching workspace switches the file tree and skill set in `ChatContext`.
- → **integrations.github**: cloning a workspace fetches the repo and **all branches** (PR #596).

## Gotchas

- **Skills are filesystem-only** (PR #378). No DB-backed skill storage.
- **Skill resolution simplified** to per-agent paths (PR #506) — earlier, skills were globally pooled.
- **Cursor skills** were added later (PR #510) — don't assume parity in older code.
- **Claude Code plugins as skill source** — PR #476 added support for loading skills from enabled plugins. The skill scan path may need to consider plugin dirs.
- **Personas were renamed from `customPrompts`** (PR #414). Don't reintroduce the old name.
- **Persona selector visibility is gated on agent capability** — show only when the current agent honors a replaced system prompt. (See `providers.md`.)
- **Always keep a workspace selected on the landing page** (PR #598) — when the last workspace is deleted, fall through cleanly.
- **Don't silently drop user-provided settings** when a field is removed (PR #449 — timezone removal). Migrate or warn.

## Recent prior art

- **PR #598** — Always keep a workspace selected on the landing page.
- **PR #597** — Enable command menu and split view on landing page.
- **PR #596** — Fetch all branches when cloning workspaces in web mode.
- **PR #506** — Refactor skills to be per-agent with simplified path resolution.
- **PR #510** — Add skills support for Cursor agent.
- **PR #537** — Show OpenCode skills and cross-read shared skill directories.
- **PR #542** — Gate personas to agents whose CLI honors a replaced system prompt.
- **PR #561** — Enable persona selector for OpenCode.
- **PR #414** — Rename custom prompts to personas.
- **PR #464** — Move slash commands to backend and filter by agent kind.
- **PR #476** — Add support for loading skills from enabled Claude Code plugins.
- **PR #563** — Add backend settings and workspace endpoint tests.
