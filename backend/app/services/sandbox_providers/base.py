import base64
import logging
import posixpath
import shlex
from pathlib import Path
from typing import Any

from app.constants import SANDBOX_BINARY_EXTENSIONS, SANDBOX_GIT_ASKPASS_PATH
from app.core.config import get_settings
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    FileMetadata,
    PtyDataCallbackType,
    PtyExitCallbackType,
    PtySize,
    SandboxProviderType,
)
from app.utils.sandbox import normalize_relative_path

logger = logging.getLogger(__name__)
settings = get_settings()

GIT_LS_FILES_CMD = "git ls-files --cached --others --exclude-standard -z"


class SandboxProvider:
    _pty_sessions: dict[str, dict[str, Any]]

    @property
    def workspace_root(self) -> str:
        # Container path (Docker) or host path (local); used to ground relative paths.
        raise NotImplementedError

    def resolve_workspace_path(self, rel_path: str | None) -> str:
        # Workspace-relative → runtime-absolute under this provider's root.
        rel = normalize_relative_path(rel_path)
        return posixpath.join(self.workspace_root, rel) if rel else self.workspace_root

    @staticmethod
    def git_askpass_path(provider_type: "SandboxProviderType | str") -> str:
        # Docker bakes the script into the sandbox image; host mode runs git in
        # the API process's filesystem, where /home/user doesn't exist — so
        # provision a shared script under the storage dir on first use (the
        # content is static, one file serves every sandbox).
        if SandboxProviderType(provider_type) == SandboxProviderType.DOCKER:
            return SANDBOX_GIT_ASKPASS_PATH
        script = Path(settings.get_host_sandbox_base_dir()) / "git-askpass.sh"
        if not script.exists():
            script.parent.mkdir(parents=True, exist_ok=True)
            script.write_text('#!/bin/sh\necho "$GITHUB_TOKEN"\n')
            script.chmod(0o700)
        return str(script)

    @staticmethod
    def create_provider(
        provider_type: SandboxProviderType | str,
        workspace_path: str | None = None,
    ) -> "SandboxProvider":
        # Inline import avoids circular dependency (providers import base).
        from app.services.sandbox_providers.docker_provider import (
            DockerConfig,
            LocalDockerProvider,
        )
        from app.services.sandbox_providers.host_provider import LocalHostProvider

        if isinstance(provider_type, str):
            provider_type = SandboxProviderType(provider_type)

        if provider_type == SandboxProviderType.DOCKER:
            return LocalDockerProvider(
                config=DockerConfig(
                    image=settings.DOCKER_IMAGE,
                    network=settings.DOCKER_NETWORK,
                    host=settings.DOCKER_HOST,
                    mem_limit=settings.DOCKER_MEM_LIMIT,
                    shm_size=settings.DOCKER_SHM_SIZE,
                    cpu_period=settings.DOCKER_CPU_PERIOD,
                    cpu_quota=settings.DOCKER_CPU_QUOTA,
                    pids_limit=settings.DOCKER_PIDS_LIMIT,
                )
            )

        if not workspace_path:
            raise ValueError("workspace_path is required for host provider")
        return LocalHostProvider(workspace_path=workspace_path)

    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        raise NotImplementedError

    async def delete_sandbox(self, sandbox_id: str) -> None:
        raise NotImplementedError

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        envs: dict[str, str] | None = None,
        timeout: int = 120,
    ) -> CommandResult:
        raise NotImplementedError

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        raise NotImplementedError

    async def write_temp_file(self, sandbox_id: str, content: str) -> str:
        # Temp path outside the workspace (Codex model_instructions_file must not pollute the project).
        raise NotImplementedError

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        raise NotImplementedError

    async def list_files(
        self,
        sandbox_id: str,
        path: str = "",
    ) -> list[FileMetadata]:
        # path is workspace-relative; "" = workspace root.
        raise NotImplementedError

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        cwd: str,
        on_data: PtyDataCallbackType,
        on_exit: PtyExitCallbackType,
        user_id: str = "",
    ) -> str:
        # cwd workspace-relative ("" = default). on_exit is natural exit only, not kill_pty.
        # user_id keys per-user agent HOME in web host mode (unused by Docker).
        raise NotImplementedError

    @staticmethod
    def build_pty_shell_command(
        tmux_session: str,
        fallback_shell: str,
        session_env: dict[str, str] | None = None,
    ) -> str:
        # Shared tmux launch for every provider's PTY, falling back to a bare
        # shell when tmux isn't installed. session_env entries are passed with
        # new-session -e: the tmux server is shared per OS user and hands its
        # own (first-start) environment to new shells, so vars like the
        # per-user agent HOME must be pinned at the session level — the
        # spawning client's env never reaches shells on an existing server.
        # history-limit and the smcup@/rmcup@
        # override precede new -A: they only apply to panes/clients created
        # after they're set (tmux applies them fine with no server running).
        # smcup@/rmcup@ keep tmux off the alternate screen so output lands in
        # xterm's own scrollback — native wheel scroll, drag selection, and
        # find-in-terminal. indn@ too: with it tmux scrolls via CSI S, which
        # xterm.js splices away instead of archiving; without it tmux falls
        # back to linefeeds, the only path that feeds xterm scrollback.
        # Mouse off for the same reason (an explicit off so
        # servers started before this change lose the old mouse-on); tmux still
        # forwards mouse-mode requests from inner TUIs. set-clipboard plus the
        # Ms override forward inner-app/copy-mode copies as OSC 52 to the
        # frontend clipboard addon.
        env_flags = "".join(
            f" -e {shlex.quote(key + '=' + value)}"
            for key, value in (session_env or {}).items()
        )
        return (
            "command -v tmux >/dev/null && "
            "tmux set -g history-limit 10000"
            " \\; set -as terminal-overrides ',xterm-256color:smcup@:rmcup@:indn@'"
            f" \\; new -A{env_flags} -s {shlex.quote(tmux_session)}"
            " \\; set -g status off"
            " \\; set -g mouse off"
            " \\; set -s set-clipboard on"
            " \\; set -as terminal-overrides ',xterm-256color:Ms=\\E]52;%p1%s;%p2%s\\007'"
            f" || exec {shlex.quote(fallback_shell)}"
        )

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        raise NotImplementedError

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        raise NotImplementedError

    async def kill_pty(self, sandbox_id: str, pty_id: str) -> None:
        raise NotImplementedError

    @staticmethod
    def parse_git_ls_files(git_output: str) -> list[FileMetadata]:
        # git only tracks files — synthesize parent directories from paths.
        items: list[FileMetadata] = []
        seen_dirs: set[str] = set()

        for rel_path in filter(None, git_output.split("\0")):
            parts = rel_path.split("/")
            for i in range(1, len(parts)):
                dir_rel = "/".join(parts[:i])
                if dir_rel in seen_dirs:
                    continue
                seen_dirs.add(dir_rel)
                items.append(FileMetadata(path=dir_rel, type="directory"))

            ext = Path(rel_path).suffix.lstrip(".").lower()
            items.append(
                FileMetadata(
                    path=rel_path,
                    type="file",
                    is_binary=ext in SANDBOX_BINARY_EXTENSIONS,
                )
            )

        return items

    @staticmethod
    def encode_file_content(path: str, content_bytes: bytes) -> tuple[str, bool]:
        is_binary = Path(path).suffix.lstrip(".").lower() in SANDBOX_BINARY_EXTENSIONS
        if is_binary:
            content = base64.b64encode(content_bytes).decode("utf-8")
        else:
            content = content_bytes.decode("utf-8", errors="replace")
        return content, is_binary

    def get_pty_session(
        self, sandbox_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return self._pty_sessions.get(sandbox_id, {}).get(session_id)

    def register_pty_session(
        self, sandbox_id: str, session_id: str, session_data: dict[str, Any]
    ) -> None:
        self._pty_sessions.setdefault(sandbox_id, {})[session_id] = session_data

    def cleanup_pty_session_tracking(self, sandbox_id: str, session_id: str) -> None:
        # Drop empty sandbox keys after the last session is removed.
        sandbox_sessions = self._pty_sessions.get(sandbox_id)
        if not sandbox_sessions:
            return

        sandbox_sessions.pop(session_id, None)
        if not sandbox_sessions:
            self._pty_sessions.pop(sandbox_id, None)

    async def cleanup(self) -> None:
        # Subclasses call super() then free their own resources.
        for sandbox_id in list(self._pty_sessions.keys()):
            for session_id in list(self._pty_sessions[sandbox_id].keys()):
                try:
                    await self.kill_pty(sandbox_id, session_id)
                except Exception as e:
                    logger.warning(
                        "Failed to cleanup PTY session %s for sandbox %s: %s",
                        session_id,
                        sandbox_id,
                        e,
                    )
