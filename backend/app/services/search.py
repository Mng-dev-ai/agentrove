import json
import logging
import shlex

from app.models.schemas.sandbox import (
    SearchFileResult,
    SearchMatch,
    SearchResponse,
)
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService
from app.utils.sandbox import normalize_relative_path

logger = logging.getLogger(__name__)

# Hard caps keep the payload bounded. max_file_matches is surfaced to the user
# by rg's --max-count; max_total_matches truncates in our parser once the
# overall budget is hit.
DEFAULT_MAX_FILE_MATCHES = 100
DEFAULT_MAX_TOTAL_MATCHES = 2000
# Truncate long lines server-side so a single minified line can't blow up the
# response. When the match sits past this offset we slide a window around
# the match so the UI always has visible match text.
MAX_LINE_LENGTH = 500
# Characters of context to keep before the match when windowing a long line.
CONTEXT_BEFORE = 40
# Cap length of error details surfaced to the client so a multi-kilobyte rg
# trace can't bloat the HTTP detail payload.
MAX_ERROR_LENGTH = 300


class SearchService:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self.sandbox_service = sandbox_service

    async def search(
        self,
        sandbox_id: str,
        query: str,
        cwd: str | None = None,
        *,
        case_sensitive: bool = False,
        regex: bool = False,
        whole_word: bool = False,
        include_glob: str | None = None,
        exclude_glob: str | None = None,
        max_file_matches: int = DEFAULT_MAX_FILE_MATCHES,
        max_total_matches: int = DEFAULT_MAX_TOTAL_MATCHES,
    ) -> SearchResponse:
        # rg --json (gitignore-aware); paths normalized to workspace-root-relative.
        rel_cwd = normalize_relative_path(cwd)
        cd_prefix = f"cd '{rel_cwd}' && " if rel_cwd else ""

        flags = ["--json", "-n", f"--max-count={max_file_matches}", "--max-columns=500"]
        if not regex:
            # -F treats the pattern as a fixed string so metacharacters are
            # safe without quoting the query for regex.
            flags.append("-F")
        if not case_sensitive:
            flags.append("-i")
        if whole_word:
            flags.append("-w")
        if include_glob:
            flags.extend(["-g", shlex.quote(include_glob)])
        if exclude_glob:
            flags.extend(["-g", shlex.quote(f"!{exclude_glob}")])

        cmd = f"{cd_prefix}rg " + " ".join(flags) + f" -- {shlex.quote(query)} ."
        result = await self.sandbox_service.execute_command(sandbox_id, cmd)

        # rg returns 1 when there are no matches — not an error for us.
        if result.exit_code not in (0, 1):
            # The Docker provider merges stderr into stdout, so fall back to
            # stdout when stderr is empty; otherwise rg parse errors surface
            # as a useless "unknown error".
            err_text = result.stderr.strip() or result.stdout.strip() or "unknown error"
            if len(err_text) > MAX_ERROR_LENGTH:
                err_text = err_text[:MAX_ERROR_LENGTH] + "…"
            raise SandboxException(f"Search failed: {err_text}")

        path_prefix = f"{rel_cwd}/" if rel_cwd else ""
        return self._parse_rg_json(
            result.stdout, max_total_matches, max_file_matches, path_prefix
        )

    @staticmethod
    def _parse_rg_json(
        output: str,
        max_total_matches: int,
        max_file_matches: int,
        path_prefix: str,
    ) -> SearchResponse:
        # Only "match" lines matter for the UI.
        results: list[SearchFileResult] = []
        file_index: dict[str, int] = {}
        total_matches = 0
        truncated = False

        for line in output.splitlines():
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") != "match":
                continue

            data = event.get("data", {})
            raw_path = data.get("path", {}).get("text")
            line_number = data.get("line_number")
            line_text = data.get("lines", {}).get("text", "")
            submatches = data.get("submatches", [])
            if not raw_path or line_number is None or not submatches:
                continue

            if total_matches >= max_total_matches:
                truncated = True
                break

            # Take the first submatch; multi-match-per-line is rare in practice
            # and the UI only highlights one span per result row.
            first = submatches[0]
            display_line, char_start, char_end = SearchService._prepare_match_line(
                line_text,
                first.get("start", 0),
                first.get("end", 0),
            )

            match = SearchMatch(
                line_number=line_number,
                line_text=display_line,
                match_start=char_start,
                match_end=char_end,
            )

            # rg can emit "./foo" depending on invocation; strip the prefix
            # before prepending the workspace-relative cwd so the final path
            # is clean (".worktrees/abc/src/App.tsx", not "./.worktrees/...").
            clean_path = raw_path[2:] if raw_path.startswith("./") else raw_path
            full_path = path_prefix + clean_path

            if full_path in file_index:
                results[file_index[full_path]].matches.append(match)
            else:
                file_index[full_path] = len(results)
                results.append(SearchFileResult(path=full_path, matches=[match]))

            total_matches += 1

        # Per-file truncation: rg's --max-count stops after N matches in any
        # single file but doesn't flag it in the JSON stream. Treat "exactly
        # N matches" as truncated — it's conservative (false positive for
        # files with exactly N real matches) but avoids silently misreporting
        # a clipped file as complete.
        if not truncated:
            for file_result in results:
                if len(file_result.matches) >= max_file_matches:
                    truncated = True
                    break

        return SearchResponse(results=results, truncated=truncated)

    @staticmethod
    def _prepare_match_line(
        line_text: str,
        byte_start: int,
        byte_end: int,
    ) -> tuple[str, int, int]:
        # rg reports submatch offsets as UTF-8 byte offsets into lines.text,
        # but the frontend slices a JS string by code units. Convert to
        # codepoint offsets so multi-byte characters (é, emoji, etc.) don't
        # shift the highlight span. Astral characters (outside BMP) can still
        # drift by one UTF-16 code unit per occurrence; acceptable for a
        # search UI, and avoiding it would require UTF-16 counting on the
        # server for marginal gain.
        raw = line_text.encode("utf-8", errors="replace")
        bs = max(0, byte_start)
        be = max(0, byte_end)
        char_start = len(raw[:bs].decode("utf-8", errors="replace"))
        char_end = char_start + len(raw[bs:be].decode("utf-8", errors="replace"))

        line = line_text.rstrip("\n\r")
        if char_end > len(line):
            char_end = len(line)
        if char_start > len(line):
            char_start = len(line)

        # Strip leading whitespace so deeply-indented code doesn't push the
        # match off-screen in the narrow sidebar. Shift offsets by the amount
        # trimmed; if the match sat inside the stripped whitespace (rare),
        # clamp to 0 so the highlight stays valid.
        trimmed = line.lstrip()
        leading = len(line) - len(trimmed)
        if leading:
            line = trimmed
            char_start = max(0, char_start - leading)
            char_end = max(char_start, char_end - leading)

        if len(line) <= MAX_LINE_LENGTH:
            return line, char_start, char_end

        # Line too long: slide a window so the match is inside it. Clamp the
        # window start so we always include MAX_LINE_LENGTH chars when
        # possible, and bracket with an ellipsis on whichever side we chopped.
        window_start = max(
            0, min(char_start - CONTEXT_BEFORE, len(line) - MAX_LINE_LENGTH)
        )
        window_end = window_start + MAX_LINE_LENGTH
        windowed = line[window_start:window_end]
        prefix = "…" if window_start > 0 else ""
        suffix = "…" if window_end < len(line) else ""
        adjusted_start = char_start - window_start + len(prefix)
        adjusted_end = min(
            char_end - window_start + len(prefix),
            len(prefix) + len(windowed),
        )
        return prefix + windowed + suffix, adjusted_start, adjusted_end
