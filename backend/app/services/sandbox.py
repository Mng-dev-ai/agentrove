from __future__ import annotations

import base64
import io
import logging
import zipfile
from typing import Any, Callable

from app.core.config import get_settings
from app.models.types import CustomEnvVarDict
from app.services.exceptions import SandboxException
from app.services.sandbox_providers import (
    PtyDataCallbackType,
    PtyExitCallbackType,
    PtySize,
    SandboxProvider,
    SandboxProviderType,
)
from app.services.sandbox_providers.types import CommandResult

settings = get_settings()
logger = logging.getLogger(__name__)


class SandboxService:
    def __init__(
        self,
        provider: SandboxProvider,
        env_vars: dict[str, str] | None = None,
        session_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.provider = provider
        self.env_vars = env_vars or {}
        self.session_factory = session_factory

    @staticmethod
    def build_env_vars(
        custom_env_vars: list[CustomEnvVarDict] | None,
        github_token: str | None,
        provider_type: SandboxProviderType | str,
    ) -> dict[str, str]:
        envs: dict[str, str] = {}
        if custom_env_vars:
            for ev in custom_env_vars:
                envs[ev["key"]] = ev["value"]
        # Desktop mode uses the host's native git credentials; only inject
        # token-based auth outside desktop mode. The askpass path depends on
        # the provider — container path for Docker, API filesystem for host.
        if github_token and not settings.DESKTOP_MODE:
            envs["GITHUB_TOKEN"] = github_token
            envs["GIT_ASKPASS"] = SandboxProvider.git_askpass_path(provider_type)
        return envs

    async def cleanup(self) -> None:
        await self.provider.cleanup()

    async def delete_sandbox(self, sandbox_id: str) -> None:
        # Best-effort container removal — logs but doesn't propagate failures,
        # since a failed delete is non-blocking for the user.
        if not sandbox_id:
            return
        try:
            await self.provider.delete_sandbox(sandbox_id)
        except Exception as e:
            logger.warning(
                "Failed to delete sandbox %s: %s",
                sandbox_id,
                e,
                exc_info=True,
                extra={"sandbox_id": sandbox_id},
            )

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
    ) -> CommandResult:
        # Every command gets the user's env vars (tokens, custom vars) so agents
        # and tools have access to credentials without explicit per-call wiring.
        return await self.provider.execute_command(
            sandbox_id, command, envs=self.env_vars
        )

    async def create_pty_session(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        cwd: str,
        on_data: PtyDataCallbackType,
        on_exit: PtyExitCallbackType,
    ) -> str:
        return await self.provider.create_pty(
            sandbox_id,
            rows,
            cols,
            tmux_session,
            cwd,
            on_data=on_data,
            on_exit=on_exit,
        )

    async def send_pty_input(
        self, sandbox_id: str, pty_session_id: str, data: bytes
    ) -> None:
        # Forward user keystrokes to the PTY; if the write fails the session
        # is likely dead, so clean it up rather than leaving a zombie.
        try:
            await self.provider.send_pty_input(sandbox_id, pty_session_id, data)
        except Exception as e:
            logger.error("Failed to send PTY input: %s", e)
            await self.cleanup_pty_session(sandbox_id, pty_session_id)

    async def resize_pty_session(
        self, sandbox_id: str, pty_session_id: str, rows: int, cols: int
    ) -> None:
        try:
            await self.provider.resize_pty(
                sandbox_id, pty_session_id, PtySize(rows=rows, cols=cols)
            )
        except Exception as e:
            logger.error(
                "Failed to resize PTY for sandbox %s: %s", sandbox_id, e, exc_info=True
            )

    async def cleanup_pty_session(self, sandbox_id: str, pty_session_id: str) -> None:
        try:
            await self.provider.kill_pty(sandbox_id, pty_session_id)
        except OSError as e:
            logger.error(
                "Error killing PTY process for session %s: %s",
                pty_session_id,
                e,
                exc_info=True,
            )

    async def get_files_metadata(
        self, sandbox_id: str, cwd: str | None = None
    ) -> list[dict[str, Any]]:
        metadata = await self.provider.list_files(sandbox_id, cwd or "")
        path_prefix = f"{cwd}/" if cwd else ""
        return [
            {
                "path": f"{path_prefix}{m.path}",
                "type": m.type,
                "is_binary": m.is_binary,
            }
            for m in metadata
        ]

    async def get_file_content(self, sandbox_id: str, file_path: str) -> dict[str, Any]:
        try:
            content = await self.provider.read_file(sandbox_id, file_path)
            return {
                "path": content.path,
                "content": content.content,
                "type": content.type,
                "is_binary": content.is_binary,
            }
        except Exception as e:
            raise SandboxException(f"Failed to read file {file_path}: {str(e)}")

    async def generate_zip_download(self, sandbox_id: str) -> bytes:
        metadata_items = await self.provider.list_files(sandbox_id)

        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for item in metadata_items:
                if item.type == "file":
                    file_path = item.path

                    try:
                        content = await self.provider.read_file(sandbox_id, file_path)

                        if content.is_binary:
                            zip_file.writestr(
                                file_path, base64.b64decode(content.content)
                            )
                        else:
                            zip_file.writestr(
                                file_path, content.content.encode("utf-8")
                            )
                    except Exception as e:
                        logger.warning(
                            "Failed to write file %s to zip: %s", file_path, e
                        )
                        continue

        zip_buffer.seek(0)
        return zip_buffer.read()
