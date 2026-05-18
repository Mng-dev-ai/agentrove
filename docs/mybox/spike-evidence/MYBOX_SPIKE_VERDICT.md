# MyBox V1 Agentrove Desktop Spike Verdict

Date: 2026-05-18

## Scope

This spike used the existing Agentrove checkout at
`/Users/user/.codex/research/mybox-bases/agentrove` as the source and created an
isolated copy at `/Users/user/mybox-agentrove-spike`.

The active MyBox HTML repo, OpenClaw, Workflow OS, Atlas, and the MyBox bridge
were not edited or restarted. OpenClaw behavior in the spike is mock/read-only
only.

## Visual Pivot

The first custom MyBox shell route was rejected after visual review. It proved
that a separate MyBox-styled overlay fights the reason Agentrove is interesting:
Agentrove already has the closest baseline UI language.

The spike was pivoted so `/mybox-v1-spike` renders Agentrove's native landing
surface and adds only a small MyBox harness selector in the existing control
row. That selector must follow Agentrove's own component anatomy: quiet
toolbar-sized trigger, subtle dropdown, no badge-like capsule, no separate
visual system.

The local spike also enables a frontend-only auth bypass in development so the
UI can be inspected without login/signup chrome. The bypass unlocks frontend
routes and removes `Log in` / `Get Started`; it does not fabricate backend data
or pretend a real API session exists.

Updated recommendation: **keep Agentrove's UI as the baseline and integrate
MyBox through adapters, data models, and small native-feeling controls. Do not
build a parallel MyBox shell on top of it.**

## What Worked

- Agentrove copied cleanly from commit `ea33c2f`.
- Frontend baseline is buildable with the current Vite/React/Tailwind stack.
- Backend baseline tests pass once test-only dependencies are installed in the
  spike venv.
- Desktop sidecar build works and can boot in isolated host mode after providing
  a local `SECRET_KEY`, `DATABASE_URL`, and `STORAGE_PATH`.
- The frontend has a clean seam for adding MyBox controls to Agentrove's native
  landing/chat surfaces without rewriting Agentrove's ACP, stream, terminal,
  diff, permission, or workspace backends.
- The current spike route demonstrates a data-driven harness list for Codex,
  OpenClaw, Claude Code, and OpenCode without hard-coding those names into
  route logic.
- The harness selector keeps OpenClaw visibly non-live by labeling it
  read-only/mock in the chooser.

## What Fought Us

- Agentrove is a full product, not a UI kit. It brings auth, workspaces, backend
  services, ACP adapters, sandboxing, terminal, git, sidecar packaging, and
  update surfaces.
- The backend test command is not self-contained from `requirements.txt`;
  `pytest`, `pytest-asyncio`, `httpx`, and `aiosqlite` had to be installed into
  the spike venv before tests could run.
- Desktop sidecar host mode refuses to boot without a real `SECRET_KEY`. That is
  good security behavior, but the local setup path needs documentation.
- `npm install` reports 21 dependency vulnerabilities in the current Agentrove
  dependency graph. This was not fixed in the spike because changing dependency
  versions would widen the scope.
- Existing frontend lint warnings remain in upstream files. The spike added no
  new lint errors, but the repo is not warning-clean.

## Security Concerns

- Forking Agentrove means inheriting a large security surface: auth, session
  secrets, local filesystem access, terminal execution, git operations, ACP
  adapters, and desktop sidecar process management.
- MyBox must keep truth labels strict. OpenClaw data must remain marked
  `MOCK`, `READ-ONLY`, or `OBSERVED` until a live read-only adapter is built and
  verified.
- Permission prompts need to stay harness-specific. Codex, OpenClaw, Claude
  Code, and OpenCode should not share approval state unless a policy layer
  explicitly maps equivalent permissions.
- Embedded browser support should be added only through a deliberate webview
  security design, not by casually exposing arbitrary local URLs.

## Maintenance Burden

Agentrove is a strong base, but it is heavy:

- Forking it gives MyBox a mature desktop/host foundation quickly.
- Keeping it current requires tracking upstream Agentrove changes, dependency
  patches, ACP protocol changes, Tauri updates, and backend migrations.
- Extracting patterns is less risky long-term, but much slower because MyBox
  would need to recreate terminal, diff, permissions, streaming, and workspace
  panels.

## Recommendation

Use Agentrove's existing UI as the primary MyBox V1 base candidate, but keep
the fork decision bounded until one real adapter spike proves the integration
model.

Recommended path: **keep this isolated Agentrove spike, preserve Agentrove's
visual language, and add MyBox behavior through narrow adapter/control seams.**

Why:

- The UI and runtime primitives are close to the desired Codex-like MyBox V1.
- The product surface is much larger than MyBox needs for the first milestone.
- A premature fork would pull MyBox into auth/backend/sandbox maintenance before
  the adapter model is proven.
- The safest next proof is a live read-only Codex or OpenClaw adapter inside the
  native Agentrove surface, still isolated from the active MyBox and OpenClaw
  systems.

## Next Concrete Step

Run a second bounded spike:

1. Keep this Agentrove copy isolated.
2. Add a real read-only adapter for one harness only, preferably Codex first.
3. Feed real session/history/tool/diff metadata into the same collapsed timeline
   and right inspector pattern.
4. Do not add write execution yet.
5. Decide after that whether MyBox should fork Agentrove or build a native app
   that borrows Agentrove's interaction patterns.

## Evidence

- Spike route: `http://127.0.0.1:3097/mybox-v1-spike`
- Native Agentrove pivot screenshot:
  `/Users/user/mybox-agentrove-spike/mybox-agentrove-native-pivot.png`
- Refined native harness chooser screenshot:
  `/Users/user/mybox-agentrove-spike/mybox-agentrove-native-picker-refined.png`
- Rejected custom-shell screenshots retained as historical evidence:
  - `/Users/user/mybox-agentrove-spike/mybox-spike-desktop.png`
  - `/Users/user/mybox-agentrove-spike/mybox-spike-openclaw-expanded.png`
  - `/Users/user/mybox-agentrove-spike/mybox-spike-browser-panel.png`
  - `/Users/user/mybox-agentrove-spike/mybox-spike-mobile.png`

Verification:

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run lint`: passed with 25 existing warnings and 0 errors.
- `backend/.venv/bin/python -m pytest backend/tests -q`: 84 passed, 3 warnings.
- `node desktop/run_build.mjs`: completed sidecar build.
- Sidecar host smoke:
  `GET http://127.0.0.1:8096/health` returned `{"status":"healthy"}` using
  spike-local DB/storage.
- Browser QA:
  - route loaded successfully after pivot;
  - native Agentrove landing surface remained intact;
  - placeholder changed to `Message MyBox...`;
  - harness selector opened with Codex, OpenClaw, Claude Code, and OpenCode;
  - OpenClaw could be selected and remained labeled read-only/mock in the
    chooser;
  - first harness selector pass looked out of place and was refined to match
    Agentrove's native workspace/worktree control sizing and menu style.
  - root route loaded without `Log in` / `Get Started` while preserving the
    native Agentrove landing surface.
