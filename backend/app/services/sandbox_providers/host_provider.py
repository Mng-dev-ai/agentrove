import asyncio
import contextlib
import fcntl
import logging
import os
import pty
import shlex
import signal
import subprocess
import tempfile
import termios
import uuid
from pathlib import Path
from typing import Any

from app.constants import (
    SANDBOX_BINARY_EXTENSIONS,
    SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    TERMINAL_TYPE,
)
from app.core.config import get_settings
from app.services.exceptions import SandboxException
from app.services.sandbox_providers.base import GIT_LS_FILES_CMD, SandboxProvider
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    FileMetadata,
    PtyDataCallbackType,
    PtyExitCallbackType,
    PtySize,
)
from app.utils.sandbox import normalize_relative_path

logger = logging.getLogger(__name__)
settings = get_settings()


class LocalHostProvider(SandboxProvider):
    def __init__(self, workspace_path: str) -> None:
        self._workspace = Path(workspace_path).expanduser().resolve()
        self._pty_sessions: dict[str, dict[str, Any]] = {}

    @property
    def workspace_root(self) -> str:
        return str(self._workspace)

    def _resolve_path(self, path: str) -> Path:
        # Turn a relative path from the frontend into an absolute host path,
        # rejecting anything that would escape the workspace via ../ or symlinks.
        if path.startswith("/"):
            raise SandboxException(f"Path must be relative: {path}")
        resolved = (self._workspace / path).resolve()
        if not resolved.is_relative_to(self._workspace):
            raise SandboxException(f"Path escapes workspace root: {path}")
        return resolved

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        envs: dict[str, str] | None = None,
        timeout: int = SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    ) -> CommandResult:
        # Run a shell command in the workspace directory via a login shell,
        # merging any caller-provided env vars into the host environment.
        workspace_dir_str = str(self._workspace)
        process_env = os.environ.copy()
        if envs:
            process_env.update(envs)

        process = await asyncio.create_subprocess_exec(
            "bash",
            "-lc",
            command,
            cwd=workspace_dir_str,
            env=process_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise TimeoutError(f"Command execution timed out after {timeout}s")

        return CommandResult(
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
            exit_code=process.returncode or 0,
        )

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        # Write a file to the workspace, creating parent directories as needed.
        # Path is validated by _resolve_path to prevent escaping the workspace.
        resolved = self._resolve_path(path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        payload = content.encode("utf-8") if isinstance(content, str) else content
        await asyncio.to_thread(resolved.write_bytes, payload)

    async def write_temp_file(self, sandbox_id: str, content: str) -> str:
        return await asyncio.to_thread(self._write_temp_file, content.encode("utf-8"))

    @staticmethod
    def _write_temp_file(payload: bytes) -> str:
        # Write through the fd mkstemp already opened — no close-and-reopen.
        fd, path = tempfile.mkstemp(prefix="agentrove-codex-", suffix=".md")
        with os.fdopen(fd, "wb") as f:
            f.write(payload)
        return path

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        # Read a file from the workspace, returning base64 for binary files
        # and UTF-8 text for everything else.
        resolved = self._resolve_path(path)
        if not resolved.exists() or not resolved.is_file():
            raise SandboxException(f"File not found: {path}")

        content_bytes = await asyncio.to_thread(resolved.read_bytes)
        content, is_binary = self.encode_file_content(path, content_bytes)
        return FileContent(path=path, content=content, type="file", is_binary=is_binary)

    # Directories to skip in the os.walk fallback (non-git repos).
    # Mirrors the most common .gitignore entries to avoid returning
    # thousands of files from dependency/build directories.
    WALK_SKIP_DIRS = frozenset(
        {
            ".git",
            "node_modules",
            ".venv",
            "venv",
            "__pycache__",
            ".next",
            ".nuxt",
            "dist",
            "build",
            ".pytest_cache",
            ".mypy_cache",
            ".ruff_cache",
            ".tox",
            ".eggs",
        }
    )

    @staticmethod
    def _walk_files(base_dir: Path) -> list[FileMetadata]:
        # Fallback for non-git directories. Skips common build/dependency
        # directories to avoid returning thousands of irrelevant files.
        items: list[FileMetadata] = []
        for root, dirnames, filenames in os.walk(base_dir, topdown=True):
            dirnames[:] = [
                d for d in dirnames if d not in LocalHostProvider.WALK_SKIP_DIRS
            ]
            root_path = Path(root)
            root_rel_path = root_path.relative_to(base_dir)
            root_rel = "" if root_rel_path == Path(".") else str(root_rel_path)

            for dirname in dirnames:
                rel = f"{root_rel}/{dirname}" if root_rel else dirname
                items.append(FileMetadata(path=rel, type="directory"))

            for filename in filenames:
                rel = f"{root_rel}/{filename}" if root_rel else filename
                ext = (root_path / filename).suffix.lstrip(".").lower()
                items.append(
                    FileMetadata(
                        path=rel,
                        type="file",
                        is_binary=ext in SANDBOX_BINARY_EXTENSIONS,
                    )
                )
        return items

    async def list_files(
        self,
        sandbox_id: str,
        path: str = "",
    ) -> list[FileMetadata]:
        # Use git ls-files for repos — handles .gitignore, global excludes,
        # and .git/info/exclude natively. Falls back to os.walk for non-git dirs.
        rel = normalize_relative_path(path)
        target_dir = self._workspace if not rel else self._resolve_path(rel)

        result = await self.execute_command(
            sandbox_id,
            f"cd {shlex.quote(str(target_dir))} && {GIT_LS_FILES_CMD}",
            timeout=10,
        )
        if result.exit_code == 0 and result.stdout:
            return await asyncio.to_thread(
                SandboxProvider.parse_git_ls_files, result.stdout
            )

        return await asyncio.to_thread(self._walk_files, target_dir)

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        cwd: str,
        on_data: PtyDataCallbackType,
        on_exit: PtyExitCallbackType,
    ) -> str:
        # Spawn a PTY-attached shell in the workspace directory (or a
        # workspace-relative cwd, e.g. a chat's worktree). Tries tmux
        # for session persistence across WebSocket reconnections, falls back
        # to the user's default shell if tmux is not installed.
        session_id = str(uuid.uuid4())
        master_fd, slave_fd = pty.openpty()
        # Set initial terminal size so the shell starts with the correct
        # dimensions (struct winsize: rows, cols, xpixel, ypixel).
        fcntl.ioctl(
            slave_fd,
            termios.TIOCSWINSZ,
            rows.to_bytes(2, "little") + cols.to_bytes(2, "little") + b"\x00" * 4,
        )

        env = os.environ.copy()
        if sandbox_id and not settings.DESKTOP_MODE:
            host_home = Path(settings.get_host_sandbox_base_dir()) / sandbox_id
            host_home.mkdir(parents=True, exist_ok=True)
            env["HOME"] = str(host_home)
        env["TERM"] = TERMINAL_TYPE
        shell = env.get("SHELL", "/bin/bash")
        cmd = (
            "command -v tmux >/dev/null && "
            f"tmux new -A -s {shlex.quote(tmux_session)} \\; set -g status off \\; set -g mouse off || exec {shlex.quote(shell)}"
        )
        process = await asyncio.to_thread(
            subprocess.Popen,
            ["bash", "-lc", cmd],
            cwd=self.resolve_workspace_path(cwd),
            env=env,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            start_new_session=True,
            close_fds=True,
        )
        os.close(slave_fd)

        reader_task = asyncio.create_task(
            self._pty_reader(session_id, master_fd, on_data, on_exit)
        )
        self.register_pty_session(
            sandbox_id,
            session_id,
            {
                "process": process,
                "master_fd": master_fd,
                "reader_task": reader_task,
            },
        )

        return session_id

    async def _pty_reader(
        self,
        session_id: str,
        master_fd: int,
        on_data: PtyDataCallbackType,
        on_exit: PtyExitCallbackType,
    ) -> None:
        # Continuously read PTY output and forward to the WebSocket via on_data.
        # Runs as a background task until the process exits or kill_pty cancels it.
        try:
            while True:
                chunk = await asyncio.to_thread(os.read, master_fd, 4096)
                if not chunk:
                    break
                await on_data(chunk)
        except asyncio.CancelledError:
            # kill_pty tearing us down — the owner already knows.
            return
        except OSError as e:
            # On Linux the master fd raises EIO instead of returning EOF when
            # the shell exits, so this path is also a normal termination.
            logger.info("PTY reader ended for session %s: %s", session_id, e)
        on_exit()

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        # Forward user keystrokes from the WebSocket to the PTY shell.
        session = self.get_pty_session(sandbox_id, pty_id)
        if not session:
            return
        await asyncio.to_thread(os.write, session["master_fd"], data)

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        # Update the PTY window size and signal the shell to redraw.
        session = self.get_pty_session(sandbox_id, pty_id)
        if not session:
            return
        winsize = (
            size.rows.to_bytes(2, "little")
            + size.cols.to_bytes(2, "little")
            + b"\x00" * 4
        )
        await asyncio.to_thread(
            fcntl.ioctl, session["master_fd"], termios.TIOCSWINSZ, winsize
        )
        process = session["process"]
        if process.pid:
            with contextlib.suppress(ProcessLookupError):
                os.kill(process.pid, signal.SIGWINCH)

    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        # Tear down a PTY session: cancel the reader task, terminate the
        # shell process (SIGTERM then SIGKILL), close the fd, and remove tracking.
        session = self.get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        session["reader_task"].cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await session["reader_task"]

        process = session["process"]
        if process.poll() is None:
            process.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                await asyncio.to_thread(process.wait, 2)
            if process.poll() is None:
                process.kill()

        with contextlib.suppress(OSError):
            os.close(session["master_fd"])

        self.cleanup_pty_session_tracking(sandbox_id, pty_id)

    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        return str(uuid.uuid4())[:12]

    async def delete_sandbox(self, sandbox_id: str) -> None:
        await self.cleanup()
