import posixpath
import re
import shlex
from string import Template
from typing import Literal, NamedTuple
from uuid import uuid4

from app.models.schemas.sandbox import (
    ChangedFile,
    FileDiffResponse,
    GitBranchesResponse,
    GitChangedPathsResponse,
    GitCheckoutResponse,
    GitCommandResponse,
    GitCreateBranchResponse,
    GitDiffResponse,
    GitFileBaselineResponse,
    GitRemoteUrlResponse,
)
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService
from app.utils.sandbox import BRANCH_NAME_RE, git_cd_prefix


class Checkpoint(NamedTuple):
    base_head: str
    pre_run_diff: str


GITHUB_REMOTE_RE = re.compile(
    r"(?:https?://github\.com/|git@github\.com:)([^/]+)/([^/]+?)(?:\.git)?$"
)

GIT_IS_REPO_CMD = "git rev-parse --is-inside-work-tree 2>/dev/null"
GIT_CURRENT_BRANCH_CMD = "git rev-parse --abbrev-ref HEAD 2>/dev/null"
# One round-trip so a clean tree (the common case) avoids the diff capture.
GIT_CHECKPOINT_PROBE_CMD = (
    "git rev-parse HEAD 2>/dev/null && "
    '(test -z "$(git status --porcelain 2>/dev/null)" '
    "&& echo clean || echo dirty)"
)
GIT_PUSH_CMD = "git push -u origin HEAD"
GIT_PULL_CMD = "git pull"
GIT_REMOTE_URL_CMD = "git remote get-url origin 2>/dev/null"
# Detached HEAD (e.g. checking out a tag/SHA) — revert to the previous branch
# so the UI always has a named branch to display.
GIT_CHECKOUT_PREV_CMD = "git checkout - 2>/dev/null"

# Segmented with explicit markers so one exec result can be parsed
# deterministically without depending on `git branch` output formatting.
GIT_LIST_BRANCHES_CMD = (
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    "git rev-parse --abbrev-ref HEAD 2>/dev/null; "
    "printf '__BRANCHES_LOCAL__\\n'; "
    "git for-each-ref --format='%(refname:short)' refs/heads; "
    "printf '__BRANCHES_REMOTE__\\n'; "
    "git for-each-ref --format='%(refname:short)' refs/remotes/origin"
)

GIT_CHECKOUT_TEMPLATE = Template("git checkout '$branch' 2>&1")
GIT_CHECKOUT_FROM_REMOTE_TEMPLATE = Template(
    "git checkout -b '$branch' 'origin/$branch' 2>&1"
)
GIT_COMMIT_TEMPLATE = Template("git add -A && git commit -m $msg")
# $base expands to either "" or " '<base_branch>'" so a single template covers
# both the "create from current HEAD" and "create from base" call shapes.
GIT_CREATE_BRANCH_TEMPLATE = Template("git checkout -b '$name'$base 2>&1")
GIT_CREATE_BRANCH_FROM_REMOTE_TEMPLATE = Template(
    "git checkout -b '$name' 'origin/$base' 2>&1"
)

# Idempotent: a previous attempt may have created the worktree but failed to
# persist it; the dir-exists check lets us skip `git worktree add` instead of
# failing on a duplicate branch or path.
GIT_WORKTREE_ADD_TEMPLATE = Template(
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 && "
    "if [ -e '$worktree_dir/.git' ]; then echo 'exists'; exit 0; fi && "
    "mkdir -p '$base_worktrees_dir' && "
    "git worktree add '$worktree_dir' -b '$branch_name' 2>&1"
)

# Build two trees and diff them so the result reflects only the assistant's
# turn. The base tree is base_head + pre_run_diff applied via a temp index
# (otherwise pre-existing dirty changes captured by the checkpoint would be
# attributed to the assistant). The current tree is the working tree captured
# by copying the real index then `git add -A` into a temp index — this folds
# untracked files into the comparison, so pre-existing untracked files stay
# silent and assistant-created files surface as additions.
# `--no-renames` collapses renames to add+delete so the parser stays simple.
# Builds `base_tree` (HEAD-or-`$base` with optional `$patch_file` applied) and
# `cur_tree` (current working tree staged via temp index) so callers can diff
# them with `git diff "$base_tree" "$cur_tree"`. Closes with `}` in the caller.
GIT_BUILD_TREES_PREFIX = (
    "{ base_tree='$base'; "
    'if [ -n "$patch_file" ]; then '
    "tmp_b=$$(mktemp); "
    "if GIT_INDEX_FILE=\"$$tmp_b\" git read-tree '$base' 2>/dev/null "
    '&& GIT_INDEX_FILE="$$tmp_b" git apply --cached --whitespace=nowarn '
    "$patch_file 2>/dev/null; then "
    'base_tree=$$(GIT_INDEX_FILE="$$tmp_b" git write-tree); '
    "fi; "
    'rm -f "$$tmp_b" $patch_file; '
    "fi; "
    "tmp_c=$$(mktemp); "
    'cp "$$(git rev-parse --git-path index)" "$$tmp_c" 2>/dev/null '
    '|| GIT_INDEX_FILE="$$tmp_c" git read-tree HEAD 2>/dev/null; '
    'GIT_INDEX_FILE="$$tmp_c" git add -A 2>/dev/null; '
    'cur_tree=$$(GIT_INDEX_FILE="$$tmp_c" git write-tree 2>/dev/null); '
    'rm -f "$$tmp_c"; '
)

GIT_CHANGED_FILES_TEMPLATE = Template(
    GIT_BUILD_TREES_PREFIX + "git diff --numstat --no-renames "
    '"$$base_tree" "$$cur_tree" -- . '
    "':(exclude).agentrove-changed-*.patch' "
    "':(exclude,glob)**/.agentrove-changed-*.patch' 2>/dev/null; "
    "printf '__STATUS__\\n'; "
    "git diff --name-status --no-renames "
    '"$$base_tree" "$$cur_tree" -- . '
    "':(exclude).agentrove-changed-*.patch' "
    "':(exclude,glob)**/.agentrove-changed-*.patch' 2>/dev/null; "
    "}"
)

GIT_FILE_DIFF_TEMPLATE = Template(
    GIT_BUILD_TREES_PREFIX + "git diff --no-renames "
    '"$$base_tree" "$$cur_tree" -- $path 2>/dev/null; '
    "}"
)

GIT_DIFF_STAGED_TEMPLATE = Template("git diff$ctx --cached 2>/dev/null")
GIT_DIFF_UNSTAGED_TEMPLATE = Template("git diff$ctx 2>/dev/null;$untracked")
# "all" mode: try `git diff HEAD` first (combined staged+unstaged in one pass);
# falls back to separate staged + unstaged when HEAD doesn't exist (initial
# commit).
GIT_DIFF_ALL_TEMPLATE = Template(
    "{ git diff$ctx HEAD 2>/dev/null"
    " || { git diff$ctx --cached 2>/dev/null; git diff$ctx 2>/dev/null; }; };"
    "$untracked"
)
# Default context (no -U flag): restore resets --hard to base_head before
# applying, and changed-files builds its temp index from exactly base_head, so
# the patch base is always byte-identical — full-file context would only bloat
# every checkpoint row stored in the DB.
GIT_CHECKPOINT_DIFF_ALL_TEMPLATE = Template(
    "{ git diff --binary HEAD 2>/dev/null"
    " || { git diff --binary --cached 2>/dev/null; "
    "git diff --binary 2>/dev/null; }; };"
    "$untracked"
)
GIT_UNTRACKED_DIFF_TEMPLATE = Template(
    " git ls-files --others --exclude-standard -z"
    " | xargs -0 -I{} git diff$ctx --no-index -- /dev/null {} 2>/dev/null"
)
GIT_CHECKPOINT_UNTRACKED_DIFF_TEMPLATE = (
    " git ls-files --others --exclude-standard -z"
    " | xargs -0 -I{} "
    "git diff --binary --no-index -- /dev/null {} 2>/dev/null"
)
# Diff HEAD against the merge-base with the default branch. Default branch is
# detected via the remote HEAD symref, falling back to main/master/develop/
# trunk. Exits 2 when no base can be determined so the caller can surface a
# distinct error. `$$` escapes literal `$` (shell vars and command subs) so
# `string.Template` only substitutes the `$ctx` placeholder.
GIT_DIFF_BRANCH_TEMPLATE = Template(
    "base=$$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/||');"
    " [ -z \"$$base\" ] && base=$$(git branch -r 2>/dev/null | grep -oE 'origin/(main|master|develop|trunk)' | head -1 | tr -d ' ');"
    ' [ -z "$$base" ] && for b in main master develop trunk; do'
    " git rev-parse --verify $$b >/dev/null 2>&1 && base=$$b && break; done;"
    ' if [ -z "$$base" ]; then exit 2; fi;'
    ' merge_base=$$(git merge-base "$$base" HEAD 2>/dev/null || echo "$$base");'
    ' git diff$ctx "$$merge_base" HEAD 2>/dev/null'
)

# Exit 2 distinguishes "not a repo" from "path not in HEAD" — `git show`
# alone fails identically for both, and the editor renders them differently.
GIT_SHOW_HEAD_TEMPLATE = Template(
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    "git show $spec 2>/dev/null"
)

# `--no-renames` keeps every record a plain `XY <path>` pair (renames split
# into D + A), `-z` avoids quoting so paths with spaces parse cleanly, and
# `--untracked-files=all` lists files inside untracked dirs (default collapses
# them to `?? dir/`, which would never match a file path). Porcelain paths are
# always repo-root-relative; `--show-prefix` (cwd relative to the repo root,
# first line) lets the parser re-base them to cwd for the response contract.
GIT_STATUS_PORCELAIN_CMD = (
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    "git rev-parse --show-prefix; "
    "git status --porcelain --no-renames --untracked-files=all -z 2>/dev/null"
)

# Diff pathspecs are repo-root-relative and `git clean -fd` only cleans below
# the current directory, so restore commands hop to the repo root before
# running to keep pathspecs resolving and clean sweeps workspace-wide.
GIT_CD_REPO_ROOT = 'cd "$(git rev-parse --show-toplevel)" && '

# `git reset --hard` (not `git checkout HEAD -- .`) is required so newly-added
# files drop out of the index and become untracked for `git clean` to sweep.
# Initial repo has no HEAD to reset to, so we empty the index directly and let
# `git clean` do the same job. Gitignored files (.env, etc.) are preserved.
RESTORE_ALL_CMD = (
    GIT_CD_REPO_ROOT + "if git rev-parse --verify HEAD >/dev/null 2>&1; then "
    "git reset --hard HEAD && git clean -fd; "
    "else "
    "git rm --cached -rf --ignore-unmatch -q . >/dev/null 2>&1; "
    "git clean -fd; "
    "fi"
)

# Rename: restore the original path, drop the new one. Cleanup of `new` is
# gated on the checkout of `old` with `&&` — not `;` — so a failed checkout
# (old_path not in HEAD) doesn't silently turn a committed rename into a
# fresh deletion.
RESTORE_RENAME_TEMPLATE = Template(
    "git checkout HEAD -- $op && { git reset -- $fp >/dev/null 2>&1; rm -f -- $fp; }"
)

# Branch on HEAD membership: `git checkout HEAD --` fails for paths not in
# HEAD, so untracked/new-staged files need an unstage + rm instead.
RESTORE_FILE_TEMPLATE = Template(
    "if git cat-file -e HEAD:$fp 2>/dev/null; then "
    "git checkout HEAD -- $fp; "
    "else "
    "git reset -- $fp >/dev/null 2>&1; "
    "rm -f -- $fp; "
    "fi"
)

GIT_RESTORE_CHECKPOINT_ALL_TEMPLATE = Template(
    "tmp=''; "
    'if [ -n "$patch_file" ]; then '
    'tmp=$$(mktemp) && cp $patch_file "$$tmp"; '
    "status=$$?; rm -f $patch_file; "
    'if [ $$status -ne 0 ]; then rm -f "$$tmp"; exit $$status; fi; '
    'fi; cd "$$(git rev-parse --show-toplevel)" && '
    "git reset --hard '$base_head' >/dev/null 2>&1; "
    "status=$$?; "
    "if [ $$status -eq 0 ]; then git clean -fd >/dev/null 2>&1; status=$$?; fi; "
    'if [ $$status -eq 0 ] && [ -n "$$tmp" ]; then '
    'git apply --whitespace=nowarn "$$tmp" 2>&1; status=$$?; '
    "fi; "
    'rm -f "$$tmp"; exit $$status'
)


class GitService:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self.sandbox_service = sandbox_service

    async def get_diff(
        self,
        sandbox_id: str,
        mode: Literal["all", "staged", "unstaged", "branch"] = "all",
        full_context: bool = False,
        cwd: str | None = None,
    ) -> GitDiffResponse:
        cd_prefix = git_cd_prefix(cwd)
        check = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_IS_REPO_CMD}",
        )
        if check.exit_code != 0:
            return GitDiffResponse(diff="", has_changes=False, is_git_repo=False)

        # Large context window so the patch includes the entire file,
        # enabling full-file diff view
        ctx = " -U99999" if full_context else ""
        untracked_diff = GIT_UNTRACKED_DIFF_TEMPLATE.substitute(ctx=ctx)

        if mode == "branch":
            cmd = GIT_DIFF_BRANCH_TEMPLATE.substitute(ctx=ctx)
        elif mode == "staged":
            cmd = GIT_DIFF_STAGED_TEMPLATE.substitute(ctx=ctx)
        elif mode == "unstaged":
            cmd = GIT_DIFF_UNSTAGED_TEMPLATE.substitute(
                ctx=ctx, untracked=untracked_diff
            )
        else:
            cmd = GIT_DIFF_ALL_TEMPLATE.substitute(ctx=ctx, untracked=untracked_diff)

        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{cd_prefix}{cmd}"
        )
        if mode == "branch" and result.exit_code == 2:
            return GitDiffResponse(
                diff="",
                has_changes=False,
                is_git_repo=True,
                error="Could not determine base branch",
            )
        diff_output = result.stdout
        return GitDiffResponse(
            diff=diff_output,
            has_changes=bool(diff_output.strip()),
            is_git_repo=True,
        )

    async def get_file_baseline(
        self,
        sandbox_id: str,
        path: str,
        cwd: str | None = None,
    ) -> GitFileBaselineResponse:
        # `HEAD:./<path>` resolves relative to the directory git runs in, so
        # cwd-relative editor paths work even when the repo root sits above cwd.
        self._validate_relative_path(path)
        cd_prefix = git_cd_prefix(cwd)
        cmd = GIT_SHOW_HEAD_TEMPLATE.substitute(spec=shlex.quote(f"HEAD:./{path}"))
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{cd_prefix}{cmd}"
        )
        if result.exit_code == 2:
            return GitFileBaselineResponse(path=path, content="", is_git_repo=False)
        # Any other failure means the path isn't in HEAD (new/untracked file or
        # unborn branch) — an empty baseline renders the whole file as added.
        content = result.stdout if result.exit_code == 0 else ""
        return GitFileBaselineResponse(path=path, content=content, is_git_repo=True)

    async def get_changed_paths(
        self,
        sandbox_id: str,
        cwd: str | None = None,
    ) -> GitChangedPathsResponse:
        # Cheap existence check for change indicators — the diff endpoints stay
        # the source of the actual content.
        cd_prefix = git_cd_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{cd_prefix}{GIT_STATUS_PORCELAIN_CMD}"
        )
        if result.exit_code == 2:
            return GitChangedPathsResponse(paths=[], is_git_repo=False)
        # First line is cwd's path inside the repo ("" at the repo root); the
        # rest are -z records of `XY <path>` — strip the status chars + space,
        # then re-base repo-root paths to cwd, dropping files outside it (the
        # editor tree can't display them anyway).
        prefix, _, status_out = result.stdout.partition("\n")
        paths = []
        for entry in status_out.split("\0"):
            if len(entry) <= 3:
                continue
            path = entry[3:]
            if prefix:
                if not path.startswith(prefix):
                    continue
                path = path[len(prefix) :]
            paths.append(path)
        return GitChangedPathsResponse(paths=paths, is_git_repo=True)

    async def get_branches(
        self,
        sandbox_id: str,
        cwd: str | None = None,
    ) -> GitBranchesResponse:
        # Branch selectors call this frequently while the user moves around the
        # workspace, so keep the request to one sandbox exec and avoid secret
        # injection, which is only needed for auth-sensitive git commands.
        cd_prefix = git_cd_prefix(cwd)
        result = await self.sandbox_service.provider.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_LIST_BRANCHES_CMD}",
        )
        if result.exit_code != 0:
            return GitBranchesResponse(
                branches=[], current_branch="", is_git_repo=False
            )

        lines = result.stdout.splitlines()
        try:
            local_marker = lines.index("__BRANCHES_LOCAL__")
            remote_marker = lines.index("__BRANCHES_REMOTE__")
        except ValueError:
            raise SandboxException("Failed to parse git branches output")
        current_branch = "\n".join(lines[:local_marker]).strip()

        local_branches: set[str] = set()
        for line in lines[local_marker + 1 : remote_marker]:
            name = line.strip()
            if name:
                local_branches.add(name)

        # Include remote-only branches so the UI can offer checkout targets the
        # user has not created locally yet, but skip the origin/HEAD symref
        # because it is just the remote default-branch pointer.
        all_branches = set(local_branches)
        for line in lines[remote_marker + 1 :]:
            name = line.strip()
            if not name or name == "origin/HEAD" or not name.startswith("origin/"):
                continue
            short = name.removeprefix("origin/")
            if short not in all_branches:
                all_branches.add(short)

        return GitBranchesResponse(
            branches=sorted(all_branches),
            current_branch=current_branch,
            is_git_repo=True,
        )

    async def checkout(
        self,
        sandbox_id: str,
        branch: str,
        cwd: str | None = None,
    ) -> GitCheckoutResponse:
        self._validate_branch_name(branch)
        cd_prefix = git_cd_prefix(cwd)

        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_CHECKOUT_TEMPLATE.substitute(branch=branch)}",
        )
        if result.exit_code != 0:
            # Branch might only exist as a remote tracking branch
            result = await self.sandbox_service.execute_command(
                sandbox_id,
                f"{cd_prefix}{GIT_CHECKOUT_FROM_REMOTE_TEMPLATE.substitute(branch=branch)}",
            )

        if result.exit_code != 0:
            return GitCheckoutResponse(
                success=False,
                current_branch="",
                error=result.stdout.strip() or result.stderr.strip(),
            )

        head_result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_CURRENT_BRANCH_CMD}",
        )
        current = head_result.stdout.strip()
        if current == "HEAD":
            await self.sandbox_service.execute_command(
                sandbox_id,
                f"{cd_prefix}{GIT_CHECKOUT_PREV_CMD}",
            )
            return GitCheckoutResponse(
                success=False,
                current_branch="",
                error="Cannot checkout: would result in detached HEAD",
            )
        return GitCheckoutResponse(success=True, current_branch=current)

    async def run_command(
        self,
        sandbox_id: str,
        command: str,
        cwd: str | None = None,
    ) -> GitCommandResponse:
        cd_prefix = git_cd_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{command} 2>&1",
        )
        if result.exit_code != 0:
            return GitCommandResponse(
                success=False,
                output="",
                error=result.stdout.strip() or result.stderr.strip(),
            )
        return GitCommandResponse(success=True, output=result.stdout.strip())

    async def push(self, sandbox_id: str, cwd: str | None = None) -> GitCommandResponse:
        return await self.run_command(sandbox_id, GIT_PUSH_CMD, cwd)

    async def pull(self, sandbox_id: str, cwd: str | None = None) -> GitCommandResponse:
        return await self.run_command(sandbox_id, GIT_PULL_CMD, cwd)

    async def commit(
        self, sandbox_id: str, message: str, cwd: str | None = None
    ) -> GitCommandResponse:
        cmd = GIT_COMMIT_TEMPLATE.substitute(msg=shlex.quote(message))
        return await self.run_command(sandbox_id, cmd, cwd)

    async def restore_file(
        self,
        sandbox_id: str,
        file_path: str,
        old_path: str | None = None,
        cwd: str | None = None,
    ) -> GitCommandResponse:
        self._validate_relative_path(file_path)
        if old_path:
            self._validate_relative_path(old_path)
        fp = shlex.quote(file_path)
        if old_path and old_path != file_path:
            op = shlex.quote(old_path)
            tail = RESTORE_RENAME_TEMPLATE.substitute(fp=fp, op=op)
        else:
            tail = RESTORE_FILE_TEMPLATE.substitute(fp=fp)
        return await self.run_command(sandbox_id, GIT_CD_REPO_ROOT + tail, cwd)

    async def restore_all(
        self,
        sandbox_id: str,
        cwd: str | None = None,
    ) -> GitCommandResponse:
        return await self.run_command(sandbox_id, RESTORE_ALL_CMD, cwd)

    async def create_checkpoint(
        self,
        sandbox_id: str,
        cwd: str | None = None,
    ) -> Checkpoint | None:
        # Single probe avoids a separate diff round-trip when the tree is clean
        # — the common case for the first turn of a fresh chat.
        cd_prefix = git_cd_prefix(cwd)
        probe = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_CHECKPOINT_PROBE_CMD}",
        )
        if probe.exit_code != 0:
            return None
        lines = probe.stdout.splitlines()
        head = lines[0].strip() if lines else ""
        marker = lines[1].strip() if len(lines) > 1 else ""
        if not head:
            return None
        if marker == "clean":
            return Checkpoint(base_head=head, pre_run_diff="")

        cmd = GIT_CHECKPOINT_DIFF_ALL_TEMPLATE.substitute(
            untracked=GIT_CHECKPOINT_UNTRACKED_DIFF_TEMPLATE
        )
        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{cmd}",
        )
        return Checkpoint(base_head=head, pre_run_diff=result.stdout)

    async def restore_checkpoint_all(
        self,
        sandbox_id: str,
        *,
        base_head: str,
        pre_run_diff: str,
        cwd: str | None = None,
    ) -> GitCommandResponse:
        if not re.fullmatch(r"[0-9a-fA-F]{40}", base_head):
            raise ValueError("Invalid checkpoint commit")
        patch_file = await self._write_patch_file(
            sandbox_id, pre_run_diff, cwd, ".agentrove-checkpoint-"
        )
        cmd = GIT_RESTORE_CHECKPOINT_ALL_TEMPLATE.substitute(
            base_head=base_head,
            patch_file=patch_file,
        )
        return await self.run_command(sandbox_id, cmd, cwd)

    async def get_changed_files(
        self,
        sandbox_id: str,
        base_head: str,
        pre_run_diff: str = "",
        cwd: str | None = None,
    ) -> list[ChangedFile]:
        if not re.fullmatch(r"[0-9a-fA-F]{40}", base_head):
            raise ValueError("Invalid checkpoint commit")
        patch_file = await self._write_patch_file(
            sandbox_id, pre_run_diff, cwd, ".agentrove-changed-"
        )
        cd_prefix = git_cd_prefix(cwd)
        cmd = GIT_CHANGED_FILES_TEMPLATE.substitute(
            base=base_head, patch_file=patch_file
        )
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{cd_prefix}{cmd}"
        )
        if result.exit_code != 0:
            return []
        return self._parse_changed_files(result.stdout)

    async def get_file_diff(
        self,
        sandbox_id: str,
        base_head: str,
        path: str,
        pre_run_diff: str = "",
        cwd: str | None = None,
    ) -> FileDiffResponse:
        if not re.fullmatch(r"[0-9a-fA-F]{40}", base_head):
            raise ValueError("Invalid checkpoint commit")
        self._validate_relative_path(path)
        patch_file = await self._write_patch_file(
            sandbox_id, pre_run_diff, cwd, ".agentrove-changed-"
        )
        cd_prefix = git_cd_prefix(cwd)
        cmd = GIT_FILE_DIFF_TEMPLATE.substitute(
            base=base_head,
            patch_file=patch_file,
            path=shlex.quote(path),
        )
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{cd_prefix}{cmd}"
        )
        return FileDiffResponse(
            path=path, diff=result.stdout if result.exit_code == 0 else ""
        )

    async def _write_patch_file(
        self,
        sandbox_id: str,
        pre_run_diff: str,
        cwd: str | None,
        name_prefix: str,
    ) -> str:
        if not pre_run_diff:
            return ""
        name = f"{name_prefix}{uuid4().hex}.patch"
        patch_path = posixpath.join(cwd, name) if cwd else name
        await self.sandbox_service.provider.write_file(
            sandbox_id, patch_path, pre_run_diff
        )
        return shlex.quote(
            self.sandbox_service.provider.resolve_workspace_path(patch_path)
        )

    @staticmethod
    def _parse_changed_files(output: str) -> list[ChangedFile]:
        numstat_section, _, status_section = output.partition("__STATUS__\n")

        # Binary files render as `-\t-\t<path>` in numstat — keep the path with
        # zeroed counts so the panel still lists the file.
        stats: dict[str, tuple[int, int]] = {}
        for line in numstat_section.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            add_str, del_str, path = parts[0], parts[1], parts[2]
            additions = int(add_str) if add_str.isdigit() else 0
            deletions = int(del_str) if del_str.isdigit() else 0
            stats[path] = (additions, deletions)

        statuses: dict[str, Literal["M", "A", "D"]] = {}
        for line in status_section.splitlines():
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            code, path = parts[0], parts[1]
            letter = code[:1]
            if letter == "M":
                statuses[path] = "M"
            elif letter == "A":
                statuses[path] = "A"
            elif letter == "D":
                statuses[path] = "D"

        files = [
            ChangedFile(
                path=path,
                status=statuses.get(path, "M"),
                additions=additions,
                deletions=deletions,
            )
            for path, (additions, deletions) in stats.items()
        ]
        files.sort(key=lambda f: f.path)
        return files

    async def create_branch(
        self,
        sandbox_id: str,
        name: str,
        base_branch: str | None = None,
        cwd: str | None = None,
    ) -> GitCreateBranchResponse:
        self._validate_branch_name(name)
        if base_branch:
            self._validate_branch_name(base_branch, label="base branch")
        cd_prefix = git_cd_prefix(cwd)

        base = f" '{base_branch}'" if base_branch else ""
        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_CREATE_BRANCH_TEMPLATE.substitute(name=name, base=base)}",
        )
        if result.exit_code != 0 and base_branch:
            # Base branch might only exist as a remote tracking branch
            remote_cmd = GIT_CREATE_BRANCH_FROM_REMOTE_TEMPLATE.substitute(
                name=name, base=base_branch
            )
            result = await self.sandbox_service.execute_command(
                sandbox_id,
                f"{cd_prefix}{remote_cmd}",
            )
        if result.exit_code != 0:
            return GitCreateBranchResponse(
                success=False,
                current_branch="",
                error=result.stdout.strip() or result.stderr.strip(),
            )

        head_result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_CURRENT_BRANCH_CMD}",
        )
        return GitCreateBranchResponse(
            success=True,
            current_branch=head_result.stdout.strip(),
        )

    async def get_remote_url(
        self,
        sandbox_id: str,
        cwd: str | None = None,
    ) -> GitRemoteUrlResponse:
        cd_prefix = git_cd_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}{GIT_REMOTE_URL_CMD}",
        )
        if result.exit_code != 0:
            raise SandboxException("No git remote origin found", status_code=404)

        remote_url = result.stdout.strip()
        # Only parse GitHub remotes — other forges (GitLab, Gitea, etc.) are
        # not supported
        match = GITHUB_REMOTE_RE.match(remote_url)
        if not match:
            raise SandboxException(
                "No GitHub remote detected — only github.com remotes are supported"
            )
        return GitRemoteUrlResponse(
            owner=match.group(1),
            repo=match.group(2),
            remote_url=remote_url,
        )

    async def create_worktree(
        self,
        sandbox_id: str,
        base_cwd: str,
        chat_id: str,
    ) -> str:
        # The caller only opts into this path when it explicitly requested
        # worktree isolation, so setup failures must surface instead of
        # silently reusing the shared workspace. Returned cwd stays
        # workspace-relative so it slots straight into chat.worktree_cwd.
        short_id = chat_id[:8]
        rel_base_worktrees = posixpath.join(base_cwd, ".worktrees")
        rel_worktree = posixpath.join(rel_base_worktrees, short_id)
        branch_name = f"worktree-{short_id}"
        cd_prefix = git_cd_prefix(base_cwd)
        cmd = cd_prefix + GIT_WORKTREE_ADD_TEMPLATE.substitute(
            worktree_dir=rel_worktree,
            base_worktrees_dir=rel_base_worktrees,
            branch_name=branch_name,
        )
        # Local git operation — no user secrets needed, so bypass
        # SandboxService.execute_command and call the provider directly.
        result = await self.sandbox_service.provider.execute_command(
            sandbox_id,
            cmd,
        )
        if result.exit_code == 0:
            return rel_worktree
        error_output = (result.stdout or result.stderr).strip()
        if not error_output:
            error_output = "Worktree mode requires a git workspace"
        raise SandboxException(error_output)

    @staticmethod
    def _validate_branch_name(name: str, label: str = "branch") -> None:
        if (
            not BRANCH_NAME_RE.match(name)
            or ".." in name
            or name.strip(".") == ""
            or name.startswith("-")
        ):
            raise ValueError(f"Invalid {label} name")

    @staticmethod
    def _validate_relative_path(path: str) -> None:
        # Defense-in-depth against shell interpolation escape even after the
        # `--` separator: reject absolutes (escape cwd), `..` (escape repo),
        # `-` prefix (option injection), and newlines/NULs (command chaining).
        if (
            not path
            or path.startswith("/")
            or path.startswith("-")
            or ".." in path.split("/")
            or "\n" in path
            or "\x00" in path
        ):
            raise ValueError("Invalid file path")
