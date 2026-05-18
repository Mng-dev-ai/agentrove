# MyBox Fork Policy

MyBox is a product fork of Agentrove. The goal is to keep upstream Agentrove
mergeable while building MyBox-specific harness control surfaces.

## Remotes

- `origin`: `https://github.com/TesterPen0812/agentrove.git`
- `upstream`: `https://github.com/Mng-dev-ai/agentrove.git`

Do not push directly to `main`. Use feature branches and PRs.

## Branches

- `main`: stable MyBox fork.
- `codex/*`: Codex implementation branches.
- `mybox/*`: product branches that may be shared across agents.
- `upstream-sync/*`: branches used only to merge or rebase upstream Agentrove.

Keep PRs short-lived. Split refactors from features.

## Upstream Strategy

Preserve upstream structure where possible:

- keep Agentrove's backend, stream, ACP, workspace, terminal, git, and diff
  contracts recognizable,
- isolate MyBox-specific UI, registries, adapter metadata, docs, and tests,
- avoid renaming upstream concepts unless the rename is part of a deliberate
  product migration.

Before an upstream sync:

1. Commit or stash local MyBox work.
2. Fetch `upstream`.
3. Merge or rebase from `upstream/main` on a dedicated branch.
4. Run the generated repo-map script after resolving conflicts.
5. Run relevant frontend/backend checks.

## MyBox Extension Points

Preferred locations for new MyBox code:

- `docs/mybox/` for product and fork authority.
- `docs/generated/` for generated maps.
- `frontend/src/mybox/` or `frontend/src/components/mybox/` for isolated MyBox UI.
- `frontend/src/config/mybox*.ts` for data-driven harness registries.
- `backend/app/mybox/` only when backend MyBox behavior becomes real.

Avoid adding MyBox behavior directly inside generic Agentrove components unless
the component already owns that extension point.

## Spike Policy

Spike work is not authority. Preserve only verdicts, screenshots, and decisions
that explain why a path was accepted or rejected. Do not copy experimental spike
code into the fork unless it is re-reviewed and explicitly approved.
