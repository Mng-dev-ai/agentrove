# MyBox G0.5 Agentrove feature audit

**Status:** completed
**Owner:** Codex
**Created:** 2026-05-18
**Last updated:** 2026-05-18
**Related:** MyBox Agentrove fork setup

---

## Context

G0 created the clean MyBox Agentrove fork. Before implementing product changes,
the fork needs a clear feature-level audit so future agents do not accidentally
replace Agentrove's strongest surfaces or reintroduce out-of-place MyBox spike
UI.

The user likes Agentrove's existing look and wants MyBox to grow from that base.
The next step is therefore not a redesign. It is a keep/change/remove/defer
decision pass over the current product architecture.

## Goal

Produce a checked-in audit that identifies the Agentrove features MyBox should
keep, change, remove, or defer, with enough file-level evidence to guide future
implementation goals.

## Non-goals

- No product behavior changes.
- No UI edits.
- No dependency installation.
- No OpenClaw, Workflow OS, Atlas, active MyBox HTML, or bridge changes.
- No attempt to run the deleted spike server.

## Approach

- [x] Review generated repo maps and MyBox fork authority docs.
- [x] Inspect Agentrove domain docs for auth, chat, providers, streaming,
      workspace, sandbox, and git.
- [x] Inspect key frontend/backend surfaces from the generated maps.
- [x] Write a feature audit under `docs/mybox/`.
- [x] Regenerate generated maps.
- [x] Run lightweight checks.

## Decision log

- **2026-05-18:** decided to keep Agentrove's existing UI baseline rather than
  continue the custom MyBox shell work. The user prefers Agentrove's visual
  direction, and preserving the baseline reduces fork maintenance risk.
- **2026-05-18:** decided that auth should be changed, not deleted. Hosted auth
  may still matter later, but local desktop MyBox should not be blocked by
  account sign-in.
- **2026-05-18:** decided that OpenClaw should remain read-only for the first
  MyBox integration pass. Mutating OpenClaw belongs in a later safety-scoped
  goal.

## Verification

- `node --check scripts/generate-repo-map.mjs`
- `node scripts/generate-repo-map.mjs`
- `git diff --check`
- `git status --short --branch`

Frontend/backend dependency checks were intentionally not run because G0.5 only
changes documentation and generated maps.

## Done when

- [x] The G0.5 audit is checked into `docs/mybox/`.
- [x] The completed G0.5 plan is checked into `plans/completed/`.
- [x] Generated maps are refreshed.
- [x] Lightweight checks pass.
