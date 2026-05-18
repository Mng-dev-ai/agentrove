# MyBox G1 Fork Intelligence Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the minimum durable intelligence baseline needed before MyBox product-code changes: feature inventory seed, deterministic codebase graph v0, contracts, and test/visual baseline.

**Architecture:** G1 is a docs-and-scripts foundation slice. The deterministic graph is generated from local source files and is the authority; external tools such as Graphify are advisory comparisons only. No Agentrove product behavior changes in this goal.

**Tech Stack:** Node.js scripts, Markdown/YAML/JSON docs, existing Agentrove React/FastAPI/Tauri source inspection, optional external graph reports stored as advisory artifacts.

---

## Completion Status

Completed on 2026-05-18. G1 produced the inventory seed, deterministic graph v0,
contracts, baseline testing notes, validators, and refreshed generated maps. It
did not change product UI, auth behavior, OpenClaw, Workflow OS, Atlas, the
active MyBox HTML repo, or the MyBox bridge.

---

## Context

G0 created the clean MyBox Agentrove fork. G0.5 audited the major Agentrove
features and concluded that MyBox should preserve Agentrove's UI and core
systems. The next risk is blind product editing: auth, harness switching,
OpenClaw observation, terminal, git, permissions, and streaming are powerful
surfaces. We need enough repo intelligence to change them deliberately.

This plan creates a bounded G1 baseline. It does not implement local-first auth,
the harness registry, the harness switcher, OpenClaw integration, or UI changes.

## Non-Goals

- No product UI changes.
- No auth behavior changes.
- No harness registry implementation.
- No OpenClaw, Workflow OS, Atlas, active MyBox HTML, or bridge changes.
- No dependency-heavy framework adoption unless explicitly recorded as advisory.
- No Docker or desktop packaging work.
- No Graphify output treated as source of truth.

## Required Outputs

Create or update these files:

```text
docs/mybox/inventory/screens.md
docs/mybox/inventory/features.yaml
docs/mybox/graph/codebase.graph.json
docs/mybox/graph/codebase.graph.md
docs/mybox/graph/frontend-routes.md
docs/mybox/graph/backend-api.md
docs/mybox/graph/stream-events.md
docs/mybox/graph/adapter-boundaries.md
docs/mybox/graph/mutation-surfaces.md
docs/mybox/graph/auth-boundaries.md
docs/mybox/graph/desktop-boundaries.md
docs/mybox/contracts/harness-registry.md
docs/mybox/contracts/truth-labels.md
docs/mybox/contracts/local-first-access.md
docs/mybox/contracts/permission-mutation-safety.md
docs/mybox/testing/baseline.md
scripts/mybox/graph/build-codebase-graph.mjs
scripts/mybox/checks/check-mybox-inventory.mjs
scripts/mybox/checks/check-mybox-graph.mjs
plans/completed/mybox_g1_fork_intelligence_baseline.md
```

Optional advisory output:

```text
docs/mybox/graph/external/graphify-report.md
```

If Graphify or a similar external tool is used, the file must clearly say:
`Advisory only. Verify before use. The deterministic graph is authoritative.`

## Task 1: Create inventory seed

**Files:**
- Create: `docs/mybox/inventory/screens.md`
- Create: `docs/mybox/inventory/features.yaml`
- Create: `scripts/mybox/checks/check-mybox-inventory.mjs`

- [x] **Step 1: Create `screens.md` with top-level screen decisions**

Include one table with these columns:

```markdown
| Screen | Current route or entrypoint | Main owner files | MyBox decision | V1 priority | Notes |
| --- | --- | --- | --- | --- | --- |
```

At minimum include:

- Landing/start screen
- Login/signup/account recovery screens
- Workspace chat
- Split chat / subthreads
- Terminal
- Diff/review
- File tree/editor/preview
- Settings
- Skills
- Personas/custom instructions
- Secrets/env vars
- GitHub/PR surfaces
- Admin/backend management surface

- [x] **Step 2: Create `features.yaml` using this exact record shape**

```yaml
features:
  - id: F-CHAT-001
    feature_name: Workspace chat
    screen_or_surface: Workspace chat
    current_user_behavior: "User can create or resume an agent session and view streamed assistant, thinking, tool, and permission events."
    agentrove_status: keep
    mybox_v1_priority: v1_required
    owning_frontend:
      routes:
        - frontend/src/pages/ChatPage.tsx
      components:
        - frontend/src/components/chat/chat-window/Chat.tsx
        - frontend/src/components/chat/message-bubble/Message.tsx
      hooks: []
      stores: []
    owning_backend:
      endpoints:
        - backend/app/api/endpoints/chat.py
      services:
        - backend/app/services/chat.py
        - backend/app/services/streaming/runtime.py
      adapters:
        - backend/app/services/acp/adapters.py
      models:
        - backend/app/models/db_models/chat.py
    mutation_surfaces:
      filesystem: false
      git: false
      terminal: false
      external_network: true
      permissions: true
    risks:
      - "Stream/event semantics are shared across harnesses and should not be special-cased by UI."
    tests_needed:
      - "Backend chat tests"
      - "Stream event fixture tests"
      - "Browser smoke for session creation and streaming"
```

Add records for the same minimum screens listed in Step 1. Unknown details must
use an empty list or `"unknown after G1 seed"` string, not `TBD`.

- [x] **Step 3: Add inventory validator**

`scripts/mybox/checks/check-mybox-inventory.mjs` must:

- read `docs/mybox/inventory/features.yaml`,
- fail if the file is missing,
- fail if it lacks `features:`,
- fail if any feature lacks `id`, `feature_name`, `agentrove_status`, or `mybox_v1_priority`,
- fail if any `agentrove_status` is not one of `keep`, `change`, `remove`, `defer`, `unknown`,
- fail if any `mybox_v1_priority` is not one of `v1_required`, `v1_optional`, `later`, `remove`.

- [x] **Step 4: Run validator**

Run:

```bash
node scripts/mybox/checks/check-mybox-inventory.mjs
```

Expected: exits 0 and prints a concise success line with the feature count.

## Task 2: Create deterministic codebase graph v0

**Files:**
- Create: `scripts/mybox/graph/build-codebase-graph.mjs`
- Create: `docs/mybox/graph/codebase.graph.json`
- Create: `docs/mybox/graph/codebase.graph.md`
- Create: `docs/mybox/graph/frontend-routes.md`
- Create: `docs/mybox/graph/backend-api.md`
- Create: `docs/mybox/graph/stream-events.md`
- Create: `docs/mybox/graph/adapter-boundaries.md`
- Create: `docs/mybox/graph/mutation-surfaces.md`
- Create: `docs/mybox/graph/auth-boundaries.md`
- Create: `docs/mybox/graph/desktop-boundaries.md`
- Create: `scripts/mybox/checks/check-mybox-graph.mjs`

- [x] **Step 1: Implement graph builder**

`build-codebase-graph.mjs` must generate a JSON object with:

```json
{
  "generatedAt": "ISO timestamp",
  "nodes": [],
  "edges": [],
  "reports": {}
}
```

Node types must include at least:

- `frontend.page`
- `frontend.component`
- `frontend.store`
- `frontend.hook`
- `backend.endpoint`
- `backend.service`
- `backend.model`
- `backend.adapter`
- `backend.stream`
- `desktop.tauri`
- `mutation.surface`
- `auth.boundary`

Edges must include at least:

- `owns`
- `calls`
- `renders`
- `uses`
- `emits`
- `mutates`
- `requires_auth`

The script may use deterministic filesystem scanning and regular expressions in
G1. It does not need full AST precision yet, but generated reports must be clear
about this limitation.

- [x] **Step 2: Include the high-risk surfaces explicitly**

The generated graph must include nodes for:

- `backend/app/api/endpoints/auth.py`
- `backend/app/api/endpoints/chat.py`
- `backend/app/api/endpoints/sandbox.py`
- `backend/app/api/endpoints/websocket.py`
- `backend/app/services/acp/adapters.py`
- `backend/app/services/streaming/types.py`
- `backend/app/services/git.py`
- `backend/app/services/terminal.py`
- `frontend/src/pages/ChatPage.tsx`
- `frontend/src/pages/LandingPage.tsx`
- `frontend/src/components/sandbox/git/DiffView.tsx`
- `frontend/src/components/sandbox/terminal/Container.tsx`
- `frontend/src/components/chat/tools/registry.tsx`
- `frontend/src/components/chat/message-bubble/segmentBuilder.ts`
- `frontend/src-tauri/Cargo.toml`

- [x] **Step 3: Generate Markdown graph reports**

The graph builder must write:

- `frontend-routes.md`: visible route/page entrypoints and primary components.
- `backend-api.md`: backend endpoint files and exported route/function names.
- `stream-events.md`: stream event type files and frontend render consumers.
- `adapter-boundaries.md`: ACP adapter files and known provider names.
- `mutation-surfaces.md`: filesystem, git, terminal, secrets, permissions, and external network mutation candidates.
- `auth-boundaries.md`: auth endpoints, auth pages, and auth dependency files.
- `desktop-boundaries.md`: Tauri/desktop files and host provider boundaries.

- [x] **Step 4: Add graph validator**

`check-mybox-graph.mjs` must:

- read `docs/mybox/graph/codebase.graph.json`,
- fail if `nodes` or `edges` are missing arrays,
- fail if any required high-risk node from Task 2 Step 2 is absent,
- fail if any required Markdown graph report is missing,
- fail if `mutation-surfaces.md` does not mention `git`, `terminal`, and `filesystem`,
- fail if `auth-boundaries.md` does not mention `auth.py` and `LoginPage.tsx`.

- [x] **Step 5: Run graph generation and validation**

Run:

```bash
node scripts/mybox/graph/build-codebase-graph.mjs
node scripts/mybox/checks/check-mybox-graph.mjs
```

Expected: both exit 0. The graph validator prints node and edge counts.

## Task 3: Write MyBox contracts

**Files:**
- Create: `docs/mybox/contracts/harness-registry.md`
- Create: `docs/mybox/contracts/truth-labels.md`
- Create: `docs/mybox/contracts/local-first-access.md`
- Create: `docs/mybox/contracts/permission-mutation-safety.md`

- [x] **Step 1: Write harness registry contract**

Must define:

- data-driven harness list,
- required harness fields,
- capability list,
- status/truth labels,
- rule that presentation components must consume registry data rather than hardcoded arrays,
- OpenClaw starts as planned/not connected/read-only only until separately implemented.

- [x] **Step 2: Write truth-label contract**

Must define these exact labels:

- `LIVE`
- `LOCAL`
- `OBSERVED`
- `READ-ONLY`
- `MOCK`
- `PLANNED`
- `NOT CONNECTED`

Must state that mock/planned data cannot be displayed as live.

- [x] **Step 3: Write local-first access contract**

Must state:

- desktop local mode should not require hosted sign-in,
- hosted/web mode must not be weakened,
- auth relaxation must be backend-owned or runtime-mode-owned, not frontend-only,
- existing auth code should be changed deliberately, not deleted.

- [x] **Step 4: Write permission/mutation safety contract**

Must separate:

- observation,
- user-approved mutation,
- adapter-initiated mutation,
- read-only adapters,
- terminal/git/filesystem/secret mutation surfaces.

Must state OpenClaw V1 cannot expose mutating methods.

## Task 4: Record baseline testing and visual state

**Files:**
- Create: `docs/mybox/testing/baseline.md`

- [x] **Step 1: Record test commands**

`baseline.md` must list the current baseline commands:

```bash
node scripts/generate-repo-map.mjs
node scripts/mybox/checks/check-mybox-inventory.mjs
node scripts/mybox/graph/build-codebase-graph.mjs
node scripts/mybox/checks/check-mybox-graph.mjs
git diff --check
```

If dependency installs are not present on the MacBook Air, record that frontend
and backend full test suites are deferred until dependencies are available.

- [x] **Step 2: Record visual baseline requirements**

`baseline.md` must require screenshots before future UI changes for:

- landing/start screen,
- chat/workspace screen,
- terminal,
- diff/review,
- settings,
- permission prompt when available,
- narrow desktop/mobile-like width when practical.

No screenshots need to be captured in G1 unless the app is already running and
safe to inspect.

## Task 5: Optional Graphify advisory pass

**Files:**
- Optional create: `docs/mybox/graph/external/graphify-report.md`

- [x] **Step 1: Decide whether to run Graphify**

Run Graphify only if it can be done without heavy setup, without uploading
private code to an unapproved hosted service, and without disrupting the current
repo. If not run, record in `docs/mybox/graph/codebase.graph.md` that Graphify
was deferred.

- [x] **Step 2: If run, store advisory output**

The report must begin with:

```markdown
# Graphify Advisory Report

Advisory only. Verify before use. The deterministic graph is authoritative.
```

The report must list any useful findings that should be added to the
deterministic graph later.

## Task 6: Refresh repo maps and close G1

**Files:**
- Modify: `docs/generated/repo-map.md`
- Modify: `docs/generated/frontend-map.md`
- Modify: `docs/generated/backend-map.md`
- Modify: `docs/generated/agent-entrypoints.md`
- Move or copy plan summary to: `plans/completed/mybox_g1_fork_intelligence_baseline.md`

- [x] **Step 1: Run generated map script**

Run:

```bash
node scripts/generate-repo-map.mjs
```

Expected: generated docs update and include the new G1 docs/check scripts.

- [x] **Step 2: Run all G1 checks**

Run:

```bash
node --check scripts/mybox/graph/build-codebase-graph.mjs
node --check scripts/mybox/checks/check-mybox-inventory.mjs
node --check scripts/mybox/checks/check-mybox-graph.mjs
node scripts/mybox/checks/check-mybox-inventory.mjs
node scripts/mybox/graph/build-codebase-graph.mjs
node scripts/mybox/checks/check-mybox-graph.mjs
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Record completion**

Copy this plan to `plans/completed/mybox_g1_fork_intelligence_baseline.md` and
set its status context to completed once all steps are done. The active plan may
remain until the branch is merged if that is the repo convention, but the
completed copy must exist for closeout.

- [x] **Step 4: Commit**

Use commit message:

```bash
git commit -m "Add MyBox fork intelligence baseline"
```

## Parallelization Guidance

Can run in parallel:

- Task 1 inventory seed.
- Task 2 graph builder.
- Task 3 contracts.
- Task 4 baseline doc.

Must not run in parallel:

- Product UI changes with this G1 plan.
- Auth behavior changes with this G1 plan.
- OpenClaw adapter implementation with this G1 plan.
- Harness switcher implementation with this G1 plan.

## Execution Recommendation

Use one parent agent for synthesis and verification. If subagents are available:

- one read-only worker can populate the inventory seed,
- one worker can implement graph/check scripts,
- one worker can draft contracts,
- one visual/review worker can verify that no UI/product changes were made.

All workers must stay inside `/Users/user/mybox-agentrove` and must not touch
OpenClaw, Workflow OS, Atlas, the active MyBox HTML repo, or the MyBox bridge.
