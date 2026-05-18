# MyBox G0 fork foundation

**Status:** completed
**Owner:** Codex
**Created:** 2026-05-18
**Last updated:** 2026-05-18
**Related:** MyBox Agentrove fork setup

---

## Context

The temporary Agentrove spike proved that Agentrove is a strong base for MyBox,
but the spike also showed that ad hoc UI edits create confusion. MyBox needs a
clean fork workspace, explicit operating rules, generated repo maps, and
preserved spike evidence before product work begins.

## Goal

Create a clean MyBox fork foundation that future agents can safely work in:
real fork remotes, MyBox operating docs, generated repo maps, preserved spike
evidence, and baseline verification that does not require installing heavy
dependencies on the MacBook Air.

## Non-goals

- No new product behavior.
- No UI redesign.
- No OpenClaw or Workflow OS edits.
- No dependency installation unless needed for G0.
- No desktop packaging work.

## Approach

- [x] Fork `Mng-dev-ai/agentrove` to `TesterPen0812/agentrove`.
- [x] Clone the fork to `/Users/user/mybox-agentrove`.
- [x] Preserve useful spike verdict/screenshots under `docs/mybox/spike-evidence/`.
- [x] Remove the old `/Users/user/mybox-agentrove-spike` workspace after preserving evidence.
- [x] Add MyBox operating docs under `docs/mybox/`.
- [x] Update `AGENTS.md` and `CLAUDE.md` to load the MyBox fork layer.
- [x] Add `scripts/generate-repo-map.mjs`.
- [x] Generate `docs/generated/*.md`.
- [x] Run lightweight baseline checks.
- [x] Move this plan to `plans/completed/` once G0 closes.

## Decision log

- **2026-05-18:** chose a real GitHub fork over continuing the spike. The spike
  had served its purpose and contained experimental UI changes that should not
  become authority.
- **2026-05-18:** chose generated Markdown maps over a dependency-heavy repo
  intelligence tool for G0. External tools such as Repomix or Aider can still be
  added later, but the fork needs a zero-dependency baseline first.
- **2026-05-18:** chose not to install frontend/backend dependencies during G0
  because the MacBook Air had limited disk headroom and this phase only changes
  docs/scripts.

## Verification

- `gh repo view TesterPen0812/agentrove --json nameWithOwner,url,isFork,parent`
- `git remote -v`
- `node --check scripts/generate-repo-map.mjs`
- `node scripts/generate-repo-map.mjs`
- `git diff --check`

Frontend/backend dependency checks were intentionally not run in G0. The fork
foundation changes are docs and a zero-dependency Node map generator, and the
MacBook Air had limited disk headroom.

## Done when

- [x] The fork workspace exists with correct remotes.
- [x] The spike is gone and useful evidence is preserved.
- [x] MyBox operating docs are present.
- [x] Generated repo maps exist and can be regenerated.
- [x] Lightweight checks pass.
