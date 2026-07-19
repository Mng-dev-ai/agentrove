import re

# Reject shell-injectable branch names / cwd paths passed to exec.
BRANCH_NAME_RE = re.compile(r"^[\w./-]+$")


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
