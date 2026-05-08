# Git

Git operations executed inside the sandbox: branches, diff, commit, push, pull, worktrees, per-message checkpoints. Owns the `GitService` (split out of `SandboxService`) and the `ChatCheckpoint` model. *Does not* own GitHub API access (`docs/domains/github.md` lives inline in `services/github.py` for now).

## Entry points

- Service: `backend/app/services/git.py` — `GitService` (branches, diff, commit, push, pull, worktrees, restore).
- Model: `ChatCheckpoint` in `backend/app/models/db_models/chat.py`.
- Endpoint: `backend/app/api/endpoints/sandbox.py` — git routes (branches, diff, commit, ...).
- Frontend: `frontend/src/components/sandbox/git/` (DiffView, branch UI), `frontend/src/components/chat/message-bubble/ChangedFilesPanel.tsx`.
- Frontend services: `frontend/src/services/sandboxService.ts` (git ops are scoped under sandbox).

## Vocabulary

- **Worktree** — chat-scoped git worktree, path stored as `Chat.worktree_cwd`. Worktree names are UUIDs (`str(chat.id)`); creation is idempotent (existence check first).
- **Checkpoint** (`ChatCheckpoint`) — captured per assistant message. Stores `base_head` (commit SHA before the run) and `pre_run_diff` (unified diff of dirty state at run start). Restore replays both to isolate the agent's changes.
- **Detached HEAD** — checkout of a tag or SHA. `checkout_branch()` reverts to the previous *named* branch on detached state, never strands the user.
- **`cwd`** — git operations are cwd-scoped (worktree-aware). All routes must propagate `cwd`.

## GitService surface

- `list_branches(sandbox_id, cwd)` → `GitBranchesResponse` (current + local + remote).
- `checkout_branch(sandbox_id, cwd, branch)` — switch; reverts from detached if needed.
- `commit(sandbox_id, cwd, message)` — `git add -A && git commit -m ...`.
- `push(sandbox_id, cwd)` — `git push -u origin HEAD`.
- `pull(sandbox_id, cwd)` — fetch + merge.
- `get_diff(sandbox_id, cwd, base_head)` — diff trees, supports patching pre-run state for checkpoint reconstruction.
- `restore_file(sandbox_id, cwd, file_path, from_checkpoint)` — checkout from checkpoint or HEAD.
- `create_worktree(sandbox_id, cwd, name)` → new worktree path (idempotent).
- `create_checkpoint(sandbox_id, cwd, message_id)` — captures `base_head` + `pre_run_diff`.

All commands template through `string.Template` to avoid injection (per `golden_principles.md` §7); output is parsed line-by-line (no JSON).

## Cross-domain edges

- → **sandbox**: every git command runs through `SandboxService.execute_command(...)`. See `sandbox.md`.
- → **chat**: `ChatCheckpoint.message_id` FK ties checkpoints to assistant messages.
- → **frontend cache**: cwd-scoped queries use the prefix-key pattern (`gitBranchesAll(id)` for broad invalidation). See `data-fetching.md`.
- → **integrations.github**: `git push` uses `GIT_ASKPASS` script (written during `initialize_sandbox`) to inject the user's GitHub PAT.

## Gotchas

- **Checkpoints capture both `base_head` and `pre_run_diff`** — restoring requires reconstructing both trees to isolate the agent's changes from pre-existing dirty state.
- **Worktree mode requires diff fetching to use the worktree cwd**, not the workspace root. PR #402 fixed an empty-diff bug from this.
- **Branch UI must sync with HEAD on focus and turn-end events** — agents can change branches mid-run. PR #527 added the sync.
- **Cwd format consistency**: cwd-relative vs. workspace-root-relative paths miss each other in invalidation. When formats can diverge, invalidate a prefix key (e.g., `fileContentAll`). (See `data-fetching.md`.)
- **Cloning in web mode** must fetch all branches, not just the default — PR #596.
- **Don't shell-template untrusted content with f-strings.** Use `string.Template` or argv lists. (`golden_principles.md` §7.)

## Recent prior art

- **PR #592** — Add per-message git checkpoints with restore. Defining PR for `ChatCheckpoint`.
- **PR #594** — Expand per-file diffs inline in changed files panel.
- **PR #593** — Add changed files panel under assistant messages.
- **PR #596** — Fetch all branches when cloning workspaces in web mode.
- **PR #527** — Sync branch UI with HEAD on focus and agent turn end.
- **PR #398** — Add worktree mode support with diff view integration.
- **PR #402** — Fix diff view empty in worktree mode until page refresh.
