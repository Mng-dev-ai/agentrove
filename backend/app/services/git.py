import logging
import posixpath
import re
import shlex
from string import Template
from typing import Literal, NamedTuple
from uuid import uuid4

from app.models.schemas.sandbox import (
    GitBranchesResponse,
    GitChangedPathsResponse,
    GitCheckoutResponse,
    GitCommandResponse,
    GitCreateBranchResponse,
    GitDiffResponse,
    GitDiffStatsResponse,
    GitFetchBaseResponse,
    GitDiffTotals,
    GitFileBaselineResponse,
    GitRemoteUrlResponse,
)
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.types import CommandResult
from app.utils.sandbox import BRANCH_NAME_RE, git_cd_prefix, is_valid_base_ref

logger = logging.getLogger(__name__)

GITHUB_REMOTE_RE = re.compile(
    r"(?:https?://github\.com/|git@github\.com:)([^/]+)/([^/]+?)(?:\.git)?$"
)
DIFF_CAPTURE_ATTEMPTS = 3
GIT_IS_REPO_CMD = "git rev-parse --is-inside-work-tree 2>/dev/null"
GIT_CURRENT_BRANCH_CMD = "git rev-parse --abbrev-ref HEAD 2>/dev/null"
# Best-effort, but inside the caller's `&&` chain so a failed `cd` still aborts.
# `--git-path` gives the common dir's info/exclude, which linked worktrees read.
GIT_ENSURE_EXCLUDES_CMD = (
    '{ excl="$(git rev-parse --git-path info/exclude)" && '
    'mkdir -p "${excl%/*}" && for p in '
    "'.worktrees/' '**/.claude/settings.local.json' "
    "'**/skills/system/run-workflow/SKILL.md'; do "
    'grep -qxF "$p" "$excl" || { [ -z "$(tail -c1 "$excl")" ] || echo; '
    'echo "$p"; } >> "$excl"; done || true; } 2>/dev/null && '
)
# Runs before the tree is captured so agent artifacts are already excluded.
GIT_CHECKPOINT_PROBE_CMD = (
    GIT_ENSURE_EXCLUDES_CMD + "git rev-parse HEAD 2>/dev/null && "
    'echo "$(git symbolic-ref -q HEAD)" && '
    '(test -z "$(git status --porcelain 2>/dev/null)" '
    "&& echo clean || echo dirty)"
)
GIT_PUSH_CMD = "git push -u origin HEAD"
GIT_PULL_CMD = "git pull"
GIT_REMOTE_URL_CMD = "git remote get-url origin 2>/dev/null"
GIT_DISCOVERY_ENV = "export GIT_DISCOVERY_ACROSS_FILESYSTEM=1 && "
# Detached HEAD: return to the previous branch so the UI has a named one.
GIT_CHECKOUT_PREV_CMD = "git checkout - 2>/dev/null"

GIT_LIST_BRANCHES_CMD = (
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    "git rev-parse --abbrev-ref HEAD 2>/dev/null; "
    "printf '__BRANCHES_LOCAL__\\n'; "
    "git for-each-ref --format='%(refname:short)' refs/heads; "
    "printf '__BRANCHES_REMOTE__\\n'; "
    "git for-each-ref --format='%(refname:short)' refs/remotes/origin"
)

GIT_CHECKOUT_TEMPLATE = Template("git checkout '$branch' 2>&1")
GIT_LOCAL_BRANCH_EXISTS_TEMPLATE = Template(
    "git show-ref --verify --quiet refs/heads/'$branch'"
)
GIT_CHECKOUT_FROM_REMOTE_TEMPLATE = Template(
    "git checkout -b '$branch' 'origin/$branch' 2>&1"
)
GIT_COMMIT_TEMPLATE = Template("git add -A && git commit -m $msg")
# $base is "" or " '<base_branch>'".
GIT_CREATE_BRANCH_TEMPLATE = Template("git checkout -b '$name'$base 2>&1")
GIT_CREATE_BRANCH_FROM_REMOTE_TEMPLATE = Template(
    "git checkout -b '$name' 'origin/$base' 2>&1"
)

# The dir-exists check lets a retried create skip a duplicate `worktree add`.
_WORKTREE_ADD_PREAMBLE = (
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    "if [ -e '$worktree_dir/.git' ]; then echo 'exists'; exit 0; fi; "
    "mkdir -p '$base_worktrees_dir' || exit $$?; "
)
# Create the branch separately so failure cleanup only owns a branch we created.
_WORKTREE_ADD_COMMAND = (
    'base_commit=$$(git rev-parse --verify "$$start_point^{commit}" 2>&1) '
    '|| { printf "Invalid base ref %s: %s\\n" "$$start_point" "$$base_commit"; exit 1; }; '
    "created=0; "
    "if git show-ref --verify --quiet 'refs/heads/$branch_name'; then "
    "git merge-base --is-ancestor 'refs/heads/$branch_name' \"$$base_commit\" "
    "|| { echo 'Existing worktree branch has commits outside the base'; exit 1; }; "
    "git branch -f '$branch_name' \"$$base_commit\" 2>&1 || exit $$?; "
    "else git branch '$branch_name' \"$$base_commit\" 2>&1 || exit $$?; "
    "created=1; fi; "
    "added=0; "
    "git worktree add --no-checkout '$worktree_dir' '$branch_name' 2>&1 && { "
    "added=1; "
    "common=$$(git rev-parse --path-format=absolute --git-common-dir) && "
    "worktree_git=$$(git -C '$worktree_dir' rev-parse --absolute-git-dir) && "
    # git-crypt resolves keys through the per-worktree git dir, not the common dir.
    'if [ -d "$$common/git-crypt" ]; then '
    'ln -s "$$common/git-crypt" "$$worktree_git/git-crypt"; fi && '
    "git -C '$worktree_dir' checkout -f --no-recurse-submodules '$branch_name' 2>&1; }; status=$$?; "
    'if [ "$$status" -ne 0 ] && [ "$$added" -eq 1 ]; then '
    "git worktree remove --force '$worktree_dir' 2>&1; fi; "
    'if [ "$$status" -ne 0 ] && [ "$$created" -eq 1 ] '
    "&& ! git worktree list --porcelain | grep -qxF 'branch refs/heads/$branch_name'; then "
    "git update-ref -d 'refs/heads/$branch_name' \"$$base_commit\"; fi; "
    'exit "$$status"'
)
GIT_WORKTREE_ADD_TEMPLATE = Template(
    _WORKTREE_ADD_PREAMBLE + "start_point=HEAD; " + _WORKTREE_ADD_COMMAND
)
GIT_WORKTREE_ADD_FROM_BASE_TEMPLATE = Template(
    _WORKTREE_ADD_PREAMBLE + "start_point='$base_ref'; " + _WORKTREE_ADD_COMMAND
)
GIT_WORKTREE_ADD_FROM_REMOTE_BASE_TEMPLATE = Template(
    _WORKTREE_ADD_PREAMBLE + "start_point='origin/$base_ref'; " + _WORKTREE_ADD_COMMAND
)

# No --force and `-d`, so dirty trees and unmerged branches are never destroyed.
GIT_WORKTREE_REMOVE_TEMPLATE = Template(
    "git worktree remove '$worktree_dir' 2>&1 && git branch -d '$branch_name' 2>&1"
)

# The empty-tree diff is for an unborn HEAD only: after any other failure it
# would show every tracked file as added.
GIT_DIFF_ALL_TEMPLATE = Template(
    ' GIT_INDEX_FILE="$$tmp" git diff$ctx HEAD 2>/dev/null'
    " || { git rev-parse -q --verify HEAD >/dev/null 2>&1 && exit 1;"
    ' GIT_INDEX_FILE="$$tmp" git diff$ctx'
    " $$(git hash-object -t tree /dev/null) 2>/dev/null; }"
)
GIT_DETECT_BASE_CMD = (
    "base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/||');"
    # Exact refs in priority order: main wins over develop, and origin/mainline
    # never matches origin/main.
    ' [ -z "$base" ] && for b in main master develop trunk; do'
    ' git rev-parse --verify -q "refs/remotes/origin/$b" >/dev/null && base=origin/$b && break; done;'
    ' [ -z "$base" ] && for b in main master develop trunk; do'
    " git rev-parse --verify $b >/dev/null 2>&1 && base=$b && break; done;"
)
# `timeout` only when present: stock macOS lacks it.
GIT_FETCH_BASE_CMD = (
    ' case "$base" in origin/*)'
    " t=; command -v timeout >/dev/null 2>&1 && t='timeout 15';"
    " GIT_TERMINAL_PROMPT=0"
    ' GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=10}"'
    " $t git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10"
    ' fetch --quiet --no-tags origin "${base#origin/}" >/dev/null 2>&1 && printf fetched;;'
    " esac;"
)

# The stamp lives in the common dir because FETCH_HEAD is per-worktree.
GIT_FETCH_BASE_THROTTLED_CMD = (
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    'cd "$(git rev-parse --show-toplevel)"; '
    + GIT_DETECT_BASE_CMD
    + ' fp="$(git rev-parse --git-common-dir)/agentrove-fetch-base";'
    ' if [ -z "$(find "$fp" -mmin -1 2>/dev/null)" ]; then touch "$fp" 2>/dev/null;'
    + GIT_FETCH_BASE_CMD
    + " fi; true"
)

# Exits 2 when no base branch is found.
GIT_DIFF_BRANCH_TEMPLATE = Template(
    "$detect_base"
    ' if [ -z "$$base" ]; then exit 2; fi;'
    ' merge_base=$$(git merge-base "$$base" HEAD 2>/dev/null || echo "$$base");'
    ' git diff$ctx "$$merge_base" HEAD 2>/dev/null'
)

# Not `git add -N`: one nested repo, out-of-cone or deleted path fails every file.
# A failed index copy must exit: an empty one diffs every tracked file as deleted.
GIT_UNTRACKED_INDEX_CMD = (
    " tmp=$(mktemp 2>/dev/null) || exit 1; trap 'rm -f \"$tmp\"' EXIT;"
    " idx=$(git rev-parse --git-path index);"
    ' if [ -e "$idx" ]; then cp -p "$idx" "$tmp" 2>/dev/null || exit 1;'
    ' else rm -f "$tmp"; fi;'
    ' (cd "$(git rev-parse --show-toplevel)" && export GIT_INDEX_FILE="$tmp" &&'
    " blob=$(git hash-object -t blob /dev/null) &&"
    " git ls-files --others --exclude-standard -z |"
    " xargs -0 sh -c 'blob=$1; shift; for f; do case $f in */) continue;; esac;"
    """ if [ -L "$f" ] || [ -r "$f" ]; then"""
    """ printf "100644 %s\\t%s\\0" "$blob" "$f"; fi; done' sh "$blob" |"""
    " git update-index -z --add --replace --index-info) >/dev/null 2>&1"
    " || exit 1;"
)
# Default context: restore applies onto exactly base_head.
# Restore deletes whatever this diff omits, so every failure above must exit.
GIT_CHECKPOINT_DIFF_CMD = (
    GIT_UNTRACKED_INDEX_CMD
    + ' GIT_INDEX_FILE="$tmp" git diff --binary HEAD 2>/dev/null'
)
GIT_MERGE_BASE_CMD = (
    ' merge_base=$(git merge-base "$base" HEAD 2>/dev/null || echo "$base");'
)
GIT_DIFF_TOTAL_TEMPLATE = Template(
    ' GIT_INDEX_FILE="$$tmp" git diff$flags "$$merge_base" 2>/dev/null;'
)
GIT_DIFF_STATS_CMD = (
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    'cd "$(git rev-parse --show-toplevel)"; '
    "head=$(git rev-parse --verify -q HEAD || git hash-object -t tree /dev/null);"
    + GIT_UNTRACKED_INDEX_CMD
    + " printf '__HEAD__\\n'; git rev-parse --verify -q HEAD 2>/dev/null;"
    " printf '__UNCOMMITTED__\\n';"
    ' GIT_INDEX_FILE="$tmp" git diff --numstat "$head" 2>/dev/null;'
    " printf '__BRANCH__\\n'; "
    + GIT_DETECT_BASE_CMD
    + ' if [ -n "$base" ]; then'
    + GIT_MERGE_BASE_CMD
    + ' git diff --numstat "$merge_base" HEAD 2>/dev/null; fi;'
    " printf '__TOTAL__\\n'; if [ -n \"$base\" ]; then"
    + GIT_DIFF_TOTAL_TEMPLATE.substitute(flags=" --numstat")
    + " fi; true"
)

# Exit 2 tells "not a repo" from "path not in HEAD"; `git show` fails alike.
GIT_SHOW_HEAD_TEMPLATE = Template(
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    "git show $spec 2>/dev/null"
)

# `--untracked-files=all`: the default collapses untracked dirs to `dir/`.
# Paths are root-relative; `--show-prefix` lets the parser re-base them to cwd.
GIT_STATUS_PORCELAIN_CMD = (
    "git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 2; "
    "git rev-parse --show-prefix; "
    "git status --porcelain --no-renames --untracked-files=all -z 2>/dev/null"
)

# Pathspecs are root-relative and `git clean -fd` only cleans below the cwd.
GIT_CD_REPO_ROOT = 'cd "$(git rev-parse --show-toplevel)" && '

# `reset --hard`, not `checkout HEAD -- .`, so added files leave the index for clean.
RESTORE_ALL_CMD = (
    GIT_CD_REPO_ROOT + "if git rev-parse --verify HEAD >/dev/null 2>&1; then "
    "git reset --hard HEAD && git clean -fd; "
    "else "
    "git rm --cached -rf --ignore-unmatch -q . >/dev/null 2>&1; "
    "git clean -fd; "
    "fi"
)

# `&&`, not `;`: a failed checkout of the old path must not delete the new one.
RESTORE_RENAME_TEMPLATE = Template(
    "git checkout HEAD -- $op && { git reset -- $fp >/dev/null 2>&1; rm -f -- $fp; }"
)

# `git checkout HEAD --` fails for paths not in HEAD.
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
    "fi; index=''; trap 'rm -f \"$$tmp\" \"$$index\"' EXIT; "
    '[ "$$(git symbolic-ref -q HEAD)" = $head_ref ] || { echo $msg; exit 1; }; '
    'cd "$$(git rev-parse --show-toplevel)" || exit; '
    'if [ -n "$$tmp" ]; then '
    'index=$$(mktemp) && rm -f "$$index" || exit; '
    "GIT_INDEX_FILE=\"$$index\" git read-tree '$base_head' && "
    'GIT_INDEX_FILE="$$index" git apply --cached --check --whitespace=nowarn "$$tmp" 2>&1 || exit; '
    "fi; git reset --hard '$base_head' >/dev/null 2>&1 && "
    "git clean -fd >/dev/null 2>&1 || exit; "
    'if [ -n "$$tmp" ]; then git apply --whitespace=nowarn "$$tmp" 2>&1; fi'
)


class Checkpoint(NamedTuple):
    base_head: str
    head_ref: str
    pre_run_diff: str


class GitService:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self.sandbox_service = sandbox_service

    @staticmethod
    def git_command_prefix(cwd: str | None = None) -> str:
        return f"{git_cd_prefix(cwd)}{GIT_DISCOVERY_ENV}"

    @staticmethod
    def _validate_base_ref(base_ref: str) -> None:
        if not is_valid_base_ref(base_ref):
            raise SandboxException("Invalid base branch name")

    async def _capture_diff(self, sandbox_id: str, command: str) -> CommandResult:
        # `git diff` aborts when a file is deleted while it reads the tree.
        for _ in range(DIFF_CAPTURE_ATTEMPTS):
            result = await self.sandbox_service.execute_command(sandbox_id, command)
            if result.exit_code in (0, 2):
                break
        return result

    async def get_diff(
        self,
        sandbox_id: str,
        mode: Literal["all", "branch", "total"] = "all",
        full_context: bool = False,
        cwd: str | None = None,
    ) -> GitDiffResponse:
        git_prefix = self.git_command_prefix(cwd)
        check = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_IS_REPO_CMD}",
        )
        if check.exit_code != 0:
            return GitDiffResponse(diff="", has_changes=False, is_git_repo=False)

        # Whole-file context for the full-file diff view.
        ctx = " -U99999" if full_context else ""

        if mode == "branch":
            cmd = GIT_DIFF_BRANCH_TEMPLATE.substitute(
                ctx=ctx, detect_base=GIT_DETECT_BASE_CMD
            )
        elif mode == "total":
            cmd = (
                GIT_DETECT_BASE_CMD
                + ' if [ -z "$base" ]; then exit 2; fi;'
                + GIT_MERGE_BASE_CMD
                + GIT_UNTRACKED_INDEX_CMD
                + GIT_DIFF_TOTAL_TEMPLATE.substitute(flags=ctx)
            )
        else:
            cmd = GIT_UNTRACKED_INDEX_CMD + GIT_DIFF_ALL_TEMPLATE.substitute(ctx=ctx)

        result = await self._capture_diff(sandbox_id, f"{git_prefix}{cmd}")
        if result.exit_code != 0:
            return GitDiffResponse(
                diff="",
                has_changes=False,
                is_git_repo=True,
                error="Could not determine base branch"
                if mode != "all" and result.exit_code == 2
                else "Could not read the working tree changes",
            )
        diff_output = result.stdout
        return GitDiffResponse(
            diff=diff_output,
            has_changes=bool(diff_output.strip()),
            is_git_repo=True,
        )

    async def get_diff_stats(
        self,
        sandbox_id: str,
        cwd: str | None = None,
    ) -> GitDiffStatsResponse:
        git_prefix = self.git_command_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{git_prefix}{GIT_DIFF_STATS_CMD}"
        )
        if result.exit_code == 2:
            return GitDiffStatsResponse(
                uncommitted=GitDiffTotals(),
                branch=GitDiffTotals(),
                total=GitDiffTotals(),
                is_git_repo=False,
                head_sha=None,
            )
        if result.exit_code != 0:
            detail = (result.stderr or result.stdout).strip()
            raise ValueError(
                f"Failed to compute diff stats: {detail}"
                if detail
                else "Failed to compute diff stats"
            )
        _, _, rest = result.stdout.partition("__HEAD__\n")
        head_sha, _, rest = rest.partition("__UNCOMMITTED__\n")
        uncommitted, _, rest = rest.partition("__BRANCH__\n")
        branch, _, total = rest.partition("__TOTAL__\n")
        return GitDiffStatsResponse(
            uncommitted=self._sum_numstat(uncommitted),
            branch=self._sum_numstat(branch),
            total=self._sum_numstat(total),
            is_git_repo=True,
            head_sha=head_sha.strip() or None,
        )

    async def fetch_base(
        self, sandbox_id: str, cwd: str | None = None
    ) -> GitFetchBaseResponse:
        git_prefix = self.git_command_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{git_prefix}{GIT_FETCH_BASE_THROTTLED_CMD}"
        )
        if result.exit_code == 2:
            return GitFetchBaseResponse(fetched=False)
        if result.exit_code != 0:
            detail = (result.stderr or result.stdout).strip()
            raise ValueError(
                f"Failed to fetch base branch: {detail}"
                if detail
                else "Failed to fetch base branch"
            )
        return GitFetchBaseResponse(fetched=result.stdout.strip() == "fetched")

    async def get_file_baseline(
        self,
        sandbox_id: str,
        path: str,
        cwd: str | None = None,
    ) -> GitFileBaselineResponse:
        # `HEAD:./path` resolves against the cwd, which may sit below the repo root.
        self._validate_relative_path(path)
        git_prefix = self.git_command_prefix(cwd)
        cmd = GIT_SHOW_HEAD_TEMPLATE.substitute(spec=shlex.quote(f"HEAD:./{path}"))
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{git_prefix}{cmd}"
        )
        if result.exit_code == 2:
            return GitFileBaselineResponse(path=path, content="", is_git_repo=False)
        # Any other failure: the path isn't in HEAD, so the file renders as added.
        content = result.stdout if result.exit_code == 0 else ""
        return GitFileBaselineResponse(path=path, content=content, is_git_repo=True)

    async def get_changed_paths(
        self,
        sandbox_id: str,
        cwd: str | None = None,
    ) -> GitChangedPathsResponse:
        git_prefix = self.git_command_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id, f"{git_prefix}{GIT_STATUS_PORCELAIN_CMD}"
        )
        if result.exit_code == 2:
            return GitChangedPathsResponse(paths=[], is_git_repo=False)
        # First line is the cwd's prefix inside the repo; files outside it are dropped.
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
        # Called often and needs no auth, so no secret injection.
        git_prefix = self.git_command_prefix(cwd)
        result = await self.sandbox_service.provider.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_LIST_BRANCHES_CMD}",
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

        # origin/HEAD is only the remote's default-branch pointer.
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
        git_prefix = self.git_command_prefix(cwd)

        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_CHECKOUT_TEMPLATE.substitute(branch=branch)}",
        )
        if result.exit_code != 0:
            local_result = await self.sandbox_service.execute_command(
                sandbox_id,
                f"{git_prefix}{GIT_LOCAL_BRANCH_EXISTS_TEMPLATE.substitute(branch=branch)}",
            )
            if local_result.exit_code == 1:
                result = await self.sandbox_service.execute_command(
                    sandbox_id,
                    f"{git_prefix}{GIT_CHECKOUT_FROM_REMOTE_TEMPLATE.substitute(branch=branch)}",
                )

        head_result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_CURRENT_BRANCH_CMD}",
        )
        current = head_result.stdout.strip()
        if result.exit_code != 0 and current != branch:
            return GitCheckoutResponse(
                success=False,
                current_branch="",
                error=result.stdout.strip() or result.stderr.strip(),
            )
        if current == "HEAD":
            await self.sandbox_service.execute_command(
                sandbox_id,
                f"{git_prefix}{GIT_CHECKOUT_PREV_CMD}",
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
        git_prefix = self.git_command_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{command} 2>&1",
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
        git_prefix = self.git_command_prefix(cwd)
        probe = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_CHECKPOINT_PROBE_CMD}",
        )
        if probe.exit_code != 0:
            return None
        lines = probe.stdout.splitlines()
        head = lines[0].strip() if lines else ""
        head_ref = lines[1].strip() if len(lines) > 1 else ""
        marker = lines[2].strip() if len(lines) > 2 else ""
        if not head:
            return None
        if marker == "clean":
            return Checkpoint(base_head=head, head_ref=head_ref, pre_run_diff="")

        result = await self._capture_diff(
            sandbox_id, f"{git_prefix}{GIT_CD_REPO_ROOT}{GIT_CHECKPOINT_DIFF_CMD}"
        )
        if result.exit_code != 0:
            return None
        return Checkpoint(base_head=head, head_ref=head_ref, pre_run_diff=result.stdout)

    async def restore_checkpoint_all(
        self,
        sandbox_id: str,
        *,
        base_head: str,
        head_ref: str,
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
            head_ref=shlex.quote(head_ref),
            msg=shlex.quote(self._checkpoint_ref_mismatch_error(head_ref)),
            patch_file=patch_file,
        )
        return await self.run_command(sandbox_id, cmd, cwd)

    @staticmethod
    def _checkpoint_ref_mismatch_error(head_ref: str) -> str:
        if not head_ref:
            return (
                "This checkpoint was taken on a detached HEAD; "
                "detach HEAD to restore it."
            )
        branch = head_ref.removeprefix("refs/heads/")
        return (
            f"This checkpoint was taken on branch {branch}; "
            f"switch to {branch} to restore it."
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
        git_prefix = self.git_command_prefix(cwd)

        base = f" '{base_branch}'" if base_branch else ""
        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_CREATE_BRANCH_TEMPLATE.substitute(name=name, base=base)}",
        )
        if result.exit_code != 0 and base_branch:
            # Base branch might only exist as a remote tracking branch
            remote_cmd = GIT_CREATE_BRANCH_FROM_REMOTE_TEMPLATE.substitute(
                name=name, base=base_branch
            )
            result = await self.sandbox_service.execute_command(
                sandbox_id,
                f"{git_prefix}{remote_cmd}",
            )
        if result.exit_code != 0:
            return GitCreateBranchResponse(
                success=False,
                current_branch="",
                error=result.stdout.strip() or result.stderr.strip(),
            )

        head_result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_CURRENT_BRANCH_CMD}",
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
        git_prefix = self.git_command_prefix(cwd)
        result = await self.sandbox_service.execute_command(
            sandbox_id,
            f"{git_prefix}{GIT_REMOTE_URL_CMD}",
        )
        if result.exit_code != 0:
            raise SandboxException("No git remote origin found", status_code=404)

        remote_url = result.stdout.strip()
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

    @staticmethod
    def chat_worktree_path(chat_id: str) -> str:
        # A worktree dir is named after the short id of the chat that created it.
        return posixpath.join(".worktrees", chat_id[:8])

    async def create_worktree(
        self,
        sandbox_id: str,
        base_cwd: str,
        chat_id: str,
        *,
        base_ref: str | None = None,
        user_id: str = "",
    ) -> str:
        # Worktree isolation was requested explicitly, so setup failures must surface.
        short_id = chat_id[:8]
        rel_base_worktrees = posixpath.join(base_cwd, ".worktrees")
        rel_worktree = posixpath.join(base_cwd, self.chat_worktree_path(chat_id))
        branch_name = f"worktree-{short_id}"
        git_prefix = self.git_command_prefix(base_cwd) + GIT_ENSURE_EXCLUDES_CMD
        if base_ref is None:
            command = GIT_WORKTREE_ADD_TEMPLATE.substitute(
                worktree_dir=rel_worktree,
                base_worktrees_dir=rel_base_worktrees,
                branch_name=branch_name,
            )
        else:
            self._validate_base_ref(base_ref)
            command = GIT_WORKTREE_ADD_FROM_BASE_TEMPLATE.substitute(
                worktree_dir=rel_worktree,
                base_worktrees_dir=rel_base_worktrees,
                branch_name=branch_name,
                base_ref=base_ref,
            )
        cmd = git_prefix + command
        # No user secrets needed, so the provider is called directly; user_id gives
        # checkout hooks the agent's HOME.
        result = await self.sandbox_service.provider.execute_command(
            sandbox_id,
            cmd,
            user_id=user_id,
        )
        first_error = (result.stdout or result.stderr).strip()
        if result.exit_code != 0 and base_ref:
            remote_command = GIT_WORKTREE_ADD_FROM_REMOTE_BASE_TEMPLATE.substitute(
                worktree_dir=rel_worktree,
                base_worktrees_dir=rel_base_worktrees,
                branch_name=branch_name,
                base_ref=base_ref,
            )
            result = await self.sandbox_service.provider.execute_command(
                sandbox_id,
                git_prefix + remote_command,
                user_id=user_id,
            )
        if result.exit_code == 0:
            return rel_worktree
        error_output = (result.stdout or result.stderr).strip()
        if first_error and first_error != error_output:
            error_output = f"{first_error}\n{error_output}".strip()
        if not error_output:
            error_output = "Worktree mode requires a git workspace"
        raise SandboxException(error_output)

    async def remove_worktree(self, sandbox_id: str, worktree_cwd: str) -> None:
        # Best-effort, fire-and-forget from chat deletion: failures are logged.
        short_id = posixpath.basename(worktree_cwd)
        cmd = GIT_DISCOVERY_ENV + GIT_WORKTREE_REMOVE_TEMPLATE.substitute(
            worktree_dir=worktree_cwd,
            branch_name=f"worktree-{short_id}",
        )
        try:
            result = await self.sandbox_service.provider.execute_command(
                sandbox_id, cmd
            )
        except (SandboxException, TimeoutError, OSError) as exc:
            logger.info("Worktree cleanup skipped for %s: %s", worktree_cwd, exc)
            return
        if result.exit_code != 0:
            logger.info(
                "Worktree cleanup skipped for %s: %s",
                worktree_cwd,
                (result.stdout or result.stderr).strip(),
            )

    @staticmethod
    def _sum_numstat(output: str) -> GitDiffTotals:
        totals = GitDiffTotals()
        for line in output.splitlines():
            parts = line.split("\t", 2)
            if len(parts) != 3:
                continue
            totals.files_changed += 1
            # Binary files report "-" for both counts.
            if parts[0].isdigit():
                totals.additions += int(parts[0])
            if parts[1].isdigit():
                totals.deletions += int(parts[1])
        return totals

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
        # Reject absolutes, `..`, a `-` prefix (option injection) and newlines/NULs.
        if (
            not path
            or path.startswith("/")
            or path.startswith("-")
            or ".." in path.split("/")
            or "\n" in path
            or "\x00" in path
        ):
            raise ValueError("Invalid file path")
