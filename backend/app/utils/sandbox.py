import re
from typing import Annotated

from pydantic import BeforeValidator

# Reject shell-injectable branch names / cwd paths passed to exec.
BRANCH_NAME_RE = re.compile(r"^[\w./-]+$")
BASE_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$")


def is_valid_base_ref(base_ref: str) -> bool:
    return bool(
        BASE_REF_RE.fullmatch(base_ref)
        and ".." not in base_ref
        and "//" not in base_ref
        and "@{" not in base_ref
        and not base_ref.endswith("/")
        and not base_ref.endswith(".lock")
    )


def normalize_base_branch(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not is_valid_base_ref(v):
        raise ValueError("Invalid base branch name")
    return v


BaseBranch = Annotated[str | None, BeforeValidator(normalize_base_branch)]


def normalize_relative_path(path: str | None) -> str:
    # Empty/None/"."/"./" = workspace root. Reject abs/`..`/quotes/controls so
    # the single-quoted `cd` in git_cd_prefix can't break out.
    if path is None:
        return ""
    if path.startswith("/"):
        raise ValueError(f"Path must be workspace-relative, got absolute: {path}")
    path = path.removeprefix("./")
    if path in ("", "."):
        return ""
    if any(c in path for c in "\x00\n\r'") or ".." in path.split("/"):
        raise ValueError(f"Invalid relative path: {path}")
    return path


def git_cd_prefix(cwd: str | None = None) -> str:
    # Providers exec from the workspace root, so an empty/root cwd needs no cd.
    rel = normalize_relative_path(cwd)
    if not rel:
        return ""
    return f"cd '{rel}' && "
