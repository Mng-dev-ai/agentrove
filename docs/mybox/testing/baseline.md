# MyBox G1 Testing Baseline

**Status:** G1 baseline
**Date:** 2026-05-18

G1 is docs and deterministic script work only. Full frontend/backend dependency
test suites are deferred until dependencies are installed and a product-code
phase requires them.

## G1 Required Commands

```bash
node scripts/generate-repo-map.mjs
node scripts/mybox/checks/check-mybox-inventory.mjs
node scripts/mybox/graph/build-codebase-graph.mjs
node scripts/mybox/checks/check-mybox-graph.mjs
git diff --check
```

Before closing G1, also run syntax checks:

```bash
node --check scripts/generate-repo-map.mjs
node --check scripts/mybox/graph/build-codebase-graph.mjs
node --check scripts/mybox/checks/check-mybox-inventory.mjs
node --check scripts/mybox/checks/check-mybox-graph.mjs
```

## Deferred Full Suites

These should run in the first product-code phase where dependencies are present:

```bash
cd frontend && npm run typecheck
cd frontend && npm run build
cd frontend && npm run lint
cd backend && pytest
```

If these commands fail because dependencies are unavailable on the MacBook Air,
record the failure and do not treat G1 as a product-code validation.

## Visual Baseline Requirements

Before future UI changes, capture screenshots for:

- landing/start screen,
- chat/workspace screen,
- terminal,
- diff/review,
- settings,
- permission prompt when available,
- narrow desktop/mobile-like width when practical.

G1 does not require screenshot capture unless the app is already running and
safe to inspect. Future UI changes must compare against Agentrove's existing
visual style and reject any addition that looks pasted on.

## Product-Code Gate

Before G2 or later product code merges, the branch should state:

- inventory row impacted,
- graph impact or no graph impact,
- contract impact,
- tests run,
- screenshots for UI changes,
- whether any data is `LIVE`, `LOCAL`, `OBSERVED`, `READ-ONLY`, `MOCK`,
  `PLANNED`, or `NOT CONNECTED`.
