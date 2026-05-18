# MyBox Agent Operating Contract

This file is the operating contract for AI and human contributors working in the
MyBox fork of Agentrove.

## Startup

1. Read `AGENTS.md`.
2. Read this file.
3. Read `docs/mybox/product-blueprint.md` for product identity, navigation,
   harness scope, and future-plan compliance.
4. Read `docs/mybox/fork-policy.md`.
5. Read `docs/mybox/ui-visual-contract.md` for UI work.
6. Read `docs/mybox/adapter-architecture.md` for harness, provider, ACP, or
   OpenClaw work.
7. Read `docs/generated/repo-map.md`, then the generated map for the layer you
   are touching.
8. Read the Agentrove domain docs named by `AGENTS.md`.

Do not bulk-load the repo first. Use the maps to choose the smallest relevant
files.

## Authority

Agentrove upstream remains the base application. MyBox additions must be explicit,
isolated, and documented. The fork is allowed to become a product, but not by
scattering MyBox assumptions through unrelated Agentrove code.

Authority order:

1. Explicit user instruction for the current task.
2. MyBox docs under `docs/mybox/`.
3. Agentrove `AGENTS.md`, `docs/golden_principles.md`, and domain docs.
4. Existing local code patterns.

If these conflict, stop and surface the conflict instead of guessing.

## Work Rules

- Preserve Agentrove's existing UI and interaction style unless the task
  explicitly authorizes a replacement.
- Follow `docs/mybox/product-blueprint.md` for product identity, information
  architecture, user-facing terminology, and V1 harness boundaries.
- Prefer data-driven registries over hardcoded harness names in UI components.
- Do not invent live status. Mark incomplete integrations as `mock`, `planned`,
  `read-only`, or `not connected`.
- Do not edit `frontend/backend-sidecar/`; it is generated from backend source.
- Do not smuggle user-facing data through ACP `_meta` or `field_meta`.
- Do not touch OpenClaw, Workflow OS, or external runtime state from this fork
  unless the task explicitly grants that scope.
- Do not preserve a bad design just for compatibility. If the right fix changes
  an API or boundary, explain the reason and update the relevant docs.
- Temporary workarounds must be narrow, named temporary, tested, and paired with
  a retirement condition.

## Required Practice

For non-trivial work:

1. State the task boundary and surfaces touched.
2. Read the generated maps and relevant domain docs.
3. Identify prior local patterns before editing.
4. Make the smallest robust change that fits the architecture.
5. Run the relevant checks, unless the task explicitly says not to.
6. Record what changed, why, verification, and remaining risk.

For UI work:

1. Capture or inspect the current rendered state.
2. Preserve the native Agentrove/MyBox visual language.
3. Validate at desktop and one narrow/mobile width when practical.
4. Treat screenshot mismatch as a real bug.

For future plans that touch product behavior, UI, harnesses, permissions,
branding, or adapter boundaries, include a short blueprint compliance checklist:

1. Which blueprint sections apply.
2. Whether brand, information architecture, harness behavior, permissions,
   visual language, or truth labels are affected.
3. How the change avoids fake live data.
4. How the change avoids hardcoded harness lists in presentation components.
5. Whether existing screen inventory decisions need updates first.

## Stop Conditions

Stop and ask for direction when:

- a task crosses three or more domains and no plan exists,
- a requested change would edit OpenClaw or Workflow OS,
- a harness adapter cannot truthfully expose the requested data,
- the only obvious path is a hack,
- tests or browser QA reveal a regression outside the declared scope.
