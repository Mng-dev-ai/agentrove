# AGENTS.md

Entry point for any AI agent (Claude Code, Codex, Cursor, Copilot) or new human working in this repo. This file is a **map and a workflow contract** — not an encyclopedia. Detailed rules live in the docs linked below.

If you're an agent, read this file first. Then route via the maps. Don't try to memorize the codebase.

---

## What this repo is

AgentRove is an open-source, self-hosted IDE-style frontend for AI coding agents (Claude Code, Codex, Cursor, Copilot, OpenCode). The backend is **FastAPI + SQLAlchemy 2 (async) + Alembic + Redis**, single-process. The frontend is **React 19 + Vite + TanStack Query + Zustand + Tailwind**, plus a Tauri desktop app. Sandboxes run as Docker containers (web mode) or directly on the host filesystem (desktop mode).

Designed for **single-user / small-team** self-hosting — no distributed-system patterns. See `docs/golden_principles.md` for the full non-distributed contract.

Setup: `README.md` (quick start). Migrations and dev workflows: `docker-compose.yml`.

---

## The workflow contract

Apply in proportion to the task. A one-line guard fix doesn't need a six-step process; anything touching a model, an ACP provider, the streaming runtime, or more than one file should follow these steps.

### 1. State a plan before writing code

- **Small / medium task** (single domain, < 1 day): a 3–10 bullet plan stated up front in your message or PR description.
- **Non-trivial task** (multi-domain, schema/migration changes, ACP/streaming/sandbox surgery, or anything materially uncertain): copy `plans/template.md` to `plans/active/{topic}.md`, fill it in *before* writing code, and link it from the PR.

Plans are cheap. Bad inheritance choices die at plan stage.

### 2. Route via the maps

Based on your plan, read the relevant docs **before** opening source files.

| If you're touching… | Read first |
|---|---|
| SQLAlchemy models / Alembic migrations | `docs/artifacts/backend/models.md` |
| FastAPI routes / dependencies | `docs/artifacts/backend/endpoints.md` |
| Backend services / business logic | `docs/artifacts/backend/services.md` |
| Backend tests | `docs/artifacts/backend/tests.md` |
| External integrations (Docker, GitHub, ACP, SMTP, Redis) | `docs/artifacts/backend/integrations.md` |
| React components / contexts / providers | `docs/artifacts/frontend/components.md` |
| TanStack Query hooks, mutations, query keys | `docs/artifacts/frontend/data-fetching.md` |
| Zustand stores / global state | `docs/artifacts/frontend/state.md` |
| Tailwind tokens / UI primitives / styling | `docs/artifacts/frontend/styling.md` |

| If you're working in domain… | Read first |
|---|---|
| Chat / messages / sub-threads / checkpoints | `docs/domains/chat.md` |
| Sandbox lifecycle / Docker vs Host providers | `docs/domains/sandbox.md` |
| ACP providers (Claude / Codex / Copilot / Cursor / OpenCode) | `docs/domains/providers.md` |
| Auth / users / refresh tokens / WebSocket auth | `docs/domains/auth.md` |
| Git / worktrees / per-message checkpoints | `docs/domains/git.md` |
| SSE/WebSocket streaming / `StreamEnvelope` | `docs/domains/streaming.md` |
| Workspaces / skills / personas / slash commands | `docs/domains/workspace.md` |

A typical task touches 1–2 artifact docs and 1–2 domain maps. Read them all — they're short.

### 3. Find prior art

Before writing, look for the most recent similar PR:

```bash
gh pr list --state merged --search "<keyword>" --limit 10
gh pr view <number> --json files,title,body
```

A good prior PR is worth more than three pages of docs. Recent examples by domain are listed in each domain map.

### 4. Implement

Match patterns the artifact docs describe. When in doubt, copy a recent canonical example over inventing.

### 5. Self-review against the definition of done

Before opening a PR, verify against `docs/done.md`. Don't skip it — it's short and exists to catch what you forgot.

### 6. Submit

PR description must include:

- A link to the plan (or inline the bullets if it's small)
- Verification steps you ran (commands, scenarios)
- Any doc / principle updates if behavior changed

---

## Foundational reading

Read these once when you start working in this repo:

- `docs/golden_principles.md` — opinionated invariants. Some lint-enforced, most reviewer-enforced.
- `docs/done.md` — definition of done.
- `README.md` — local boot (Docker compose), env vars, common commands.

---

## Common commands

```bash
docker compose up                                           # boot the full stack (web mode)
docker compose exec api alembic upgrade head                # apply migrations
docker compose exec api alembic revision --autogenerate -m "msg"   # new migration
docker compose exec api pytest                              # backend tests
cd frontend && npm run lint && npm run typecheck            # frontend gates
gh pr list --state merged --search "<keyword>" --limit 10   # find prior art
```

Pre-commit hooks live in `.githooks/pre-commit`. To enable: `git config core.hooksPath .githooks`.

---

## Hard rules

These cannot be overridden without explicit human sign-off:

1. **Never commit secrets.** `.env` and `storage/` are git-ignored — verify before staging.
2. **Never edit a merged Alembic migration.** Write a new one.
3. **Never push directly to `main`.** PRs only.
4. **Never disable a failing test without an issue link.** Either fix it or quarantine it explicitly.
5. **Never bypass `docs/golden_principles.md` silently.** If you must, say so in the PR description and open a follow-up.
6. **Never edit `frontend/backend-sidecar/`.** It's a build artifact — all backend source lives in `backend/`.
7. **Don't add distributed-system patterns** (cross-process locks, multi-replica coordination, cron-based brokers). This is a single-process app. Redis is pub/sub + cache only.
8. **Don't use ACP `_meta` / `field_meta` for user-facing data.** It's optional extensibility metadata — agents aren't required to read it.

---

## Where humans help

Escalate to a human (rather than guessing) when:

- A task crosses 3+ domains and the boundaries aren't clear.
- An ACP adapter's behavior diverges from what `docs/domains/providers.md` documents.
- A migration would lock a large table or backfill non-trivially.
- A change would break the SSE `StreamEnvelope` contract or message-replay semantics.
- You can't reproduce a bug after reasonable effort.

Don't fight the harness silently. Surface the friction.
