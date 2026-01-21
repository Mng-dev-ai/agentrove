import asyncio
import base64
import io
import json
import logging
import secrets
import shlex
import uuid
import zipfile
from pathlib import Path
from typing import Any, Callable, Coroutine

from fastapi import WebSocket

from app.constants import PTY_OUTPUT_QUEUE_SIZE
from app.models.types import (
    CustomAgentDict,
    CustomEnvVarDict,
    CustomProviderDict,
    CustomSkillDict,
    CustomSlashCommandDict,
)
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import SandboxException
from app.services.sandbox_providers import (
    PtySize,
    SandboxProvider,
)
from app.services.sandbox_providers.types import CommandResult
from app.services.skill import SkillService
from app.utils.queue import drain_queue, put_with_overflow

logger = logging.getLogger(__name__)

OPENVSCODE_PORT = 8765
OPENVSCODE_SETTINGS_DIR = "/home/user/.openvscode-server/data/Machine"
OPENVSCODE_SETTINGS_PATH = f"{OPENVSCODE_SETTINGS_DIR}/settings.json"
OPENVSCODE_TOKEN_PATH = "/home/user/.ide_connection_token"
OPENVSCODE_DEFAULT_SETTINGS: dict[str, object] = {
    "workbench.colorTheme": "Default Dark Modern",
    "window.autoDetectColorScheme": True,
    "workbench.preferredDarkColorTheme": "Default Dark Modern",
    "workbench.preferredLightColorTheme": "Default Light Modern",
    "editor.fontSize": 12,
    "editor.minimap.enabled": True,
    "editor.wordWrap": "on",
    "telemetry.telemetryLevel": "off",
}


class SandboxService:
    def __init__(
        self,
        provider: SandboxProvider,
        session_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.provider = provider
        self.session_factory = session_factory
        self._active_pty_sessions: dict[str, dict[str, Any]] = {}
        self._ide_tokens: dict[str, str] = {}

    @staticmethod
    def _validate_message_id(message_id: str) -> None:
        try:
            uuid.UUID(message_id)
        except ValueError:
            raise SandboxException(f"Invalid message_id format: {message_id}")

    async def cleanup(self) -> None:
        for sandbox_id in list(self._active_pty_sessions.keys()):
            for session_id in list(self._active_pty_sessions[sandbox_id].keys()):
                try:
                    await self.cleanup_pty_session(sandbox_id, session_id)
                except Exception as e:
                    logger.warning(
                        "Failed to cleanup PTY session %s for sandbox %s: %s",
                        session_id,
                        sandbox_id,
                        e,
                    )
        await self.provider.cleanup()

    async def create_sandbox(self) -> str:
        return await self.provider.create_sandbox()

    async def delete_sandbox(self, sandbox_id: str) -> None:
        if not sandbox_id:
            return
        asyncio.create_task(self._delete_sandbox_deferred(sandbox_id))

    async def _delete_sandbox_deferred(self, sandbox_id: str) -> None:
        self._ide_tokens.pop(sandbox_id, None)
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

    async def get_or_connect_sandbox(self, sandbox_id: str) -> bool:
        return await self.provider.connect_sandbox(sandbox_id)

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        background: bool = False,
    ) -> CommandResult:
        sandbox_secrets = await self.provider.get_secrets(sandbox_id)
        envs = {s.key: s.value for s in sandbox_secrets}

        return await self.provider.execute_command(
            sandbox_id, command, background=background, envs=envs
        )

    async def write_file(self, sandbox_id: str, file_path: str, content: str) -> None:
        await self.provider.write_file(sandbox_id, file_path, content)

    async def get_preview_links(self, sandbox_id: str) -> list[dict[str, str | int]]:
        links = await self.provider.get_preview_links(sandbox_id)
        return [{"preview_url": link.preview_url, "port": link.port} for link in links]

    async def get_ide_url(self, sandbox_id: str) -> str | None:
        base_url = await self.provider.get_ide_url(sandbox_id)
        if not base_url:
            return None

        token = await self._get_ide_token(sandbox_id)
        if token:
            separator = "&" if "?" in base_url else "?"
            return f"{base_url}{separator}tkn={token}"
        return base_url

    async def _get_ide_token(self, sandbox_id: str) -> str | None:
        if sandbox_id in self._ide_tokens:
            return self._ide_tokens[sandbox_id]

        try:
            content = await self.provider.read_file(sandbox_id, OPENVSCODE_TOKEN_PATH)
            if not content.is_binary and content.content:
                token = content.content.strip()
                self._ide_tokens[sandbox_id] = token
                return token
        except Exception as e:
            logger.warning("Failed to read IDE token for sandbox %s: %s", sandbox_id, e)
        return None

    async def get_vnc_url(self, sandbox_id: str) -> str | None:
        return await self.provider.get_vnc_url(sandbox_id)

    async def start_browser(
        self, sandbox_id: str, url: str = "about:blank"
    ) -> dict[str, str]:
        escaped_url = shlex.quote(url)
        browser_cmd = (
            f"DISPLAY=:99 chromium --no-sandbox --disable-gpu "
            f"--disable-dev-shm-usage --window-size=1920,1080 --window-position=0,0 "
            f"--remote-debugging-port=9222 {escaped_url}"
        )

        try:
            await self.execute_command(sandbox_id, browser_cmd, background=True)
            logger.info("Browser started for sandbox %s with URL: %s", sandbox_id, url)
            return {"status": "starting", "url": url}
        except Exception as exc:
            logger.error("Failed to start browser for sandbox %s: %s", sandbox_id, exc)
            await self._cleanup_browser_resources(sandbox_id)
            raise

    async def _cleanup_browser_resources(self, sandbox_id: str) -> None:
        try:
            await self.execute_command(
                sandbox_id, "pkill -9 -f chromium", background=True
            )
        except Exception:
            pass

    async def stop_browser(self, sandbox_id: str) -> dict[str, str]:
        await self.execute_command(sandbox_id, "pkill -f chromium", background=True)
        logger.info("Browser stopped for sandbox %s", sandbox_id)
        return {"status": "stopped"}

    async def get_browser_status(self, sandbox_id: str) -> dict[str, bool]:
        result = await self.execute_command(
            sandbox_id, "pidof chromium >/dev/null 2>&1 && echo 'yes' || echo 'no'"
        )
        running = result.stdout.strip() == "yes"
        return {"running": running}

    async def create_pty_session(
        self, sandbox_id: str, rows: int = 24, cols: int = 80
    ) -> dict[str, Any]:
        output_queue: "asyncio.Queue[str]" = asyncio.Queue(
            maxsize=PTY_OUTPUT_QUEUE_SIZE
        )

        pty_session = await self.provider.create_pty(
            sandbox_id,
            rows,
            cols,
            on_data=lambda data: self._enqueue_pty_output(data, output_queue),
        )

        if sandbox_id not in self._active_pty_sessions:
            self._active_pty_sessions[sandbox_id] = {}

        self._active_pty_sessions[sandbox_id][pty_session.id] = {
            "pty_id": pty_session.id,
            "output_queue": output_queue,
            "size": {"rows": rows, "cols": cols},
        }

        return {"id": pty_session.id, "rows": rows, "cols": cols}

    async def send_pty_input(
        self, sandbox_id: str, pty_session_id: str, data: str | bytes
    ) -> None:
        session = self._get_pty_session_data(sandbox_id, pty_session_id)
        if not session:
            return

        data_bytes = data.encode() if isinstance(data, str) else data

        try:
            await self.provider.send_pty_input(sandbox_id, pty_session_id, data_bytes)
        except Exception as e:
            logger.error("Failed to send PTY input: %s", e)
            await self.cleanup_pty_session(sandbox_id, pty_session_id)

    async def resize_pty_session(
        self, sandbox_id: str, pty_session_id: str, rows: int, cols: int
    ) -> None:
        session = self._get_pty_session_data(sandbox_id, pty_session_id)
        if not session:
            return

        try:
            await self.provider.resize_pty(
                sandbox_id, pty_session_id, PtySize(rows=rows, cols=cols)
            )
            session["size"] = {"rows": rows, "cols": cols}
        except Exception as e:
            logger.error(
                "Failed to resize PTY for sandbox %s: %s", sandbox_id, e, exc_info=True
            )

    async def forward_pty_output(
        self, sandbox_id: str, pty_session_id: str, websocket: WebSocket
    ) -> None:
        session = self._get_pty_session_data(sandbox_id, pty_session_id)
        if not session:
            return

        output_queue = session["output_queue"]

        try:
            while True:
                buffer = await drain_queue(output_queue)
                payload = json.dumps({"type": "stdout", "data": "".join(buffer)})
                await websocket.send_text(payload)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(
                "Error forwarding PTY output for sandbox %s: %s",
                sandbox_id,
                e,
                exc_info=True,
            )

    async def cleanup_pty_session(self, sandbox_id: str, pty_session_id: str) -> None:
        session = self._get_pty_session_data(sandbox_id, pty_session_id)
        if not session:
            return

        try:
            del self._active_pty_sessions[sandbox_id][pty_session_id]
            if not self._active_pty_sessions[sandbox_id]:
                del self._active_pty_sessions[sandbox_id]
        except Exception as e:
            logger.error(
                "Error cleaning up PTY session %s: %s", pty_session_id, e, exc_info=True
            )

        try:
            await self.provider.kill_pty(sandbox_id, pty_session_id)
        except Exception as e:
            logger.error(
                "Error killing PTY process for session %s: %s",
                pty_session_id,
                e,
                exc_info=True,
            )

    async def get_files_metadata(self, sandbox_id: str) -> list[dict[str, Any]]:
        metadata = await self.provider.list_files(sandbox_id)
        return [
            {
                "path": m.path,
                "type": m.type,
                "size": m.size,
                "modified": m.modified,
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

    async def add_secret(
        self,
        sandbox_id: str,
        key: str,
        value: str,
    ) -> None:
        await self.provider.add_secret(sandbox_id, key, value)

    async def update_secret(
        self,
        sandbox_id: str,
        key: str,
        value: str,
    ) -> None:
        await self.provider.delete_secret(sandbox_id, key)
        await self.provider.add_secret(sandbox_id, key, value)

    async def delete_secret(
        self,
        sandbox_id: str,
        key: str,
    ) -> None:
        await self.provider.delete_secret(sandbox_id, key)

    async def get_secrets(
        self,
        sandbox_id: str,
    ) -> list[dict[str, Any]]:
        sandbox_secrets = await self.provider.get_secrets(sandbox_id)
        return [{"key": s.key, "value": s.value} for s in sandbox_secrets]

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

    async def _copy_all_resources_to_sandbox(
        self,
        sandbox_id: str,
        user_id: str,
        custom_skills: list[CustomSkillDict] | None,
        custom_slash_commands: list[CustomSlashCommandDict] | None,
        custom_agents: list[CustomAgentDict] | None,
    ) -> None:
        skill_service = SkillService()
        command_service = CommandService()
        agent_service = AgentService()

        enabled_skills = skill_service.get_enabled(user_id, custom_skills or [])
        enabled_commands = command_service.get_enabled(
            user_id, custom_slash_commands or []
        )
        enabled_agents = agent_service.get_enabled(user_id, custom_agents or [])

        if not enabled_skills and not enabled_commands and not enabled_agents:
            return

        zip_buffer = io.BytesIO()
        has_content = False

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for skill in enabled_skills:
                skill_name = skill["name"]
                local_zip_path = Path(skill["path"])

                if not local_zip_path.exists():
                    logger.warning(
                        "Skill ZIP not found: %s at %s", skill_name, local_zip_path
                    )
                    continue

                with zipfile.ZipFile(local_zip_path, "r") as skill_zip:
                    for item in skill_zip.namelist():
                        content = skill_zip.read(item)
                        zf.writestr(f".claude/skills/{skill_name}/{item}", content)
                        has_content = True

            for command in enabled_commands:
                command_name = command["name"]
                local_path = Path(command["path"])

                if not local_path.exists():
                    logger.warning(
                        "Command not found: %s at %s", command_name, local_path
                    )
                    continue

                command_content = local_path.read_text(encoding="utf-8")
                zf.writestr(f".claude/commands/{command_name}.md", command_content)
                has_content = True

            for agent in enabled_agents:
                agent_name = agent["name"]
                local_path = Path(agent["path"])

                if not local_path.exists():
                    logger.warning("Agent not found: %s at %s", agent_name, local_path)
                    continue

                agent_content = local_path.read_text(encoding="utf-8")
                zf.writestr(f".claude/agents/{agent_name}.md", agent_content)
                has_content = True

        if not has_content:
            return

        zip_buffer.seek(0)
        zip_content = zip_buffer.getvalue()
        encoded_content = base64.b64encode(zip_content).decode("utf-8")

        remote_zip_path = f"/home/user/_resources_{uuid.uuid4().hex[:8]}.zip"
        temp_b64_path = f"{remote_zip_path}.b64tmp"

        try:
            await self.write_file(sandbox_id, temp_b64_path, encoded_content)
            decode_and_extract_cmd = (
                f"base64 -d {shlex.quote(temp_b64_path)} > {shlex.quote(remote_zip_path)} && "
                f"unzip -q -o {shlex.quote(remote_zip_path)} -d /home/user && "
                f"rm -f {shlex.quote(remote_zip_path)} {shlex.quote(temp_b64_path)}"
            )
            await self.execute_command(sandbox_id, decode_and_extract_cmd)

            resource_count = (
                len(enabled_skills) + len(enabled_commands) + len(enabled_agents)
            )
            logger.info(
                "Copied %d resources to sandbox %s in single upload",
                resource_count,
                sandbox_id,
            )
        except Exception as e:
            logger.error("Failed to copy resources to sandbox %s: %s", sandbox_id, e)
            cleanup_cmd = (
                f"rm -f {shlex.quote(remote_zip_path)} {shlex.quote(temp_b64_path)}"
            )
            try:
                await self.execute_command(sandbox_id, cleanup_cmd)
            except Exception:
                pass
            raise SandboxException(f"Failed to copy resources to sandbox: {e}") from e

    async def _add_env_vars_parallel(
        self, sandbox_id: str, custom_env_vars: list[CustomEnvVarDict]
    ) -> None:
        if not custom_env_vars:
            return
        async with asyncio.TaskGroup() as tg:
            for env_var in custom_env_vars:
                tg.create_task(
                    self.provider.add_secret(
                        sandbox_id, env_var["key"], env_var["value"]
                    )
                )

    async def _setup_github_token(self, sandbox_id: str, github_token: str) -> None:
        script_content = '#!/bin/sh\\necho "$GITHUB_TOKEN"'
        async with asyncio.TaskGroup() as tg:
            tg.create_task(
                self.provider.add_secret(sandbox_id, "GITHUB_TOKEN", github_token)
            )
            tg.create_task(
                self.provider.add_secret(
                    sandbox_id, "GIT_ASKPASS", "/home/user/.git-askpass.sh"
                )
            )

        setup_cmd = (
            f"echo -e '{script_content}' > /home/user/.git-askpass.sh && "
            f"chmod +x /home/user/.git-askpass.sh"
        )
        await self.execute_command(sandbox_id, setup_cmd)

    async def _setup_anthropic_bridge(
        self,
        sandbox_id: str,
        openrouter_api_key: str | None = None,
        skip_secret: bool = False,
    ) -> None:
        if openrouter_api_key and not skip_secret:
            await self.provider.add_secret(
                sandbox_id, "OPENROUTER_API_KEY", openrouter_api_key
            )

        start_cmd = "anthropic-bridge --port 3456 --host 0.0.0.0"
        start_result = await self.execute_command(
            sandbox_id, start_cmd, background=True
        )
        logger.info("Anthropic Bridge started: %s", start_result.stdout)

    async def _start_openvscode_server(self, sandbox_id: str) -> None:
        connection_token = secrets.token_urlsafe(32)
        self._ide_tokens[sandbox_id] = connection_token

        await self.write_file(sandbox_id, OPENVSCODE_TOKEN_PATH, connection_token)

        settings_content = json.dumps(OPENVSCODE_DEFAULT_SETTINGS, indent=2)
        escaped_settings = settings_content.replace("'", "'\"'\"'")

        setup_and_start_cmd = (
            f"mkdir -p {OPENVSCODE_SETTINGS_DIR} && "
            f"echo '{escaped_settings}' > {OPENVSCODE_SETTINGS_PATH} && "
            f"openvscode-server --host 0.0.0.0 --port {OPENVSCODE_PORT} "
            f"--connection-token-file {OPENVSCODE_TOKEN_PATH} --disable-telemetry"
        )
        await self.execute_command(sandbox_id, setup_and_start_cmd, background=True)

    async def update_ide_theme(self, sandbox_id: str, theme: str) -> None:
        vscode_theme = (
            "Default Dark Modern" if theme == "dark" else "Default Light Modern"
        )
        settings = {
            **OPENVSCODE_DEFAULT_SETTINGS,
            "workbench.colorTheme": vscode_theme,
            "window.autoDetectColorScheme": False,
        }
        settings_content = json.dumps(settings, indent=2)
        await self.write_file(sandbox_id, OPENVSCODE_SETTINGS_PATH, settings_content)
        logger.info("IDE theme updated to: %s", vscode_theme)

    async def _setup_claude_config(
        self,
        sandbox_id: str,
        auto_compact_disabled: bool,
        attribution_disabled: bool,
    ) -> None:
        if not auto_compact_disabled and not attribution_disabled:
            return

        if auto_compact_disabled:
            claude_json_path = "/home/user/.claude.json"
            config: dict[str, Any] = {}
            try:
                existing = await self.provider.read_file(sandbox_id, claude_json_path)
                if not existing.is_binary and existing.content:
                    config = json.loads(existing.content)
            except Exception:
                pass
            config["autoCompactEnabled"] = False
            await self.write_file(
                sandbox_id, claude_json_path, json.dumps(config, indent=2)
            )

        if attribution_disabled:
            claude_dir = "/home/user/.claude"
            settings_path = f"{claude_dir}/settings.json"
            settings: dict[str, Any] = {}
            await self.execute_command(sandbox_id, f"mkdir -p {claude_dir}")
            try:
                existing = await self.provider.read_file(sandbox_id, settings_path)
                if not existing.is_binary and existing.content:
                    settings = json.loads(existing.content)
            except Exception:
                pass
            settings["attribution"] = {"commit": "", "pr": ""}
            await self.write_file(
                sandbox_id, settings_path, json.dumps(settings, indent=2)
            )

    async def _setup_openai_auth(self, sandbox_id: str, openai_auth_json: str) -> None:
        openai_dir = "/home/user/.codex"
        await self.execute_command(sandbox_id, f"mkdir -p {openai_dir}")
        await self.write_file(sandbox_id, f"{openai_dir}/auth.json", openai_auth_json)

    async def initialize_sandbox(
        self,
        sandbox_id: str,
        github_token: str | None = None,
        custom_env_vars: list[CustomEnvVarDict] | None = None,
        custom_skills: list[CustomSkillDict] | None = None,
        custom_slash_commands: list[CustomSlashCommandDict] | None = None,
        custom_agents: list[CustomAgentDict] | None = None,
        user_id: str | None = None,
        auto_compact_disabled: bool = False,
        attribution_disabled: bool = False,
        custom_providers: list[CustomProviderDict] | None = None,
        is_fork: bool = False,
    ) -> None:
        tasks: list[Coroutine[None, None, None]] = [
            self._start_openvscode_server(sandbox_id),
        ]

        # Forks skip filesystem-based setup (env vars in .bashrc, config files, skills/commands/agents)
        # since these are preserved when cloning the container. Only processes need restarting.
        if not is_fork:
            tasks.append(
                self._setup_claude_config(
                    sandbox_id, auto_compact_disabled, attribution_disabled
                )
            )

            if custom_env_vars:
                tasks.append(self._add_env_vars_parallel(sandbox_id, custom_env_vars))

            has_resources = (
                custom_skills or custom_slash_commands or custom_agents
            ) and user_id
            if has_resources:
                tasks.append(
                    self._copy_all_resources_to_sandbox(
                        sandbox_id,
                        user_id,  # type: ignore[arg-type]
                        custom_skills,
                        custom_slash_commands,
                        custom_agents,
                    )
                )

            if github_token:
                tasks.append(self._setup_github_token(sandbox_id, github_token))

        openai_auth = self._get_openai_auth_from_provider(custom_providers)
        if openai_auth:
            tasks.append(self._setup_openai_auth(sandbox_id, openai_auth))

        openrouter_api_key = self._get_openrouter_api_key(custom_providers)
        openai_enabled = self._has_openai_provider(custom_providers)
        if openrouter_api_key or openai_enabled:
            tasks.append(
                self._setup_anthropic_bridge(
                    sandbox_id,
                    openrouter_api_key=openrouter_api_key,
                    skip_secret=is_fork,
                )
            )

        async with asyncio.TaskGroup() as tg:
            for task in tasks:
                tg.create_task(task)

    @staticmethod
    def _get_openrouter_api_key(
        custom_providers: list[CustomProviderDict] | None,
    ) -> str | None:
        if not custom_providers:
            return None
        for provider in custom_providers:
            if (
                provider.get("provider_type") == "openrouter"
                and provider.get("enabled", True)
                and provider.get("auth_token")
            ):
                return provider["auth_token"]
        return None

    @staticmethod
    def _has_openai_provider(
        custom_providers: list[CustomProviderDict] | None,
    ) -> bool:
        if not custom_providers:
            return False
        return any(
            provider.get("provider_type") == "openai" and provider.get("enabled", True)
            for provider in custom_providers
        )

    @staticmethod
    def _get_openai_auth_from_provider(
        custom_providers: list[CustomProviderDict] | None,
    ) -> str | None:
        if not custom_providers:
            return None
        for provider in custom_providers:
            if (
                provider.get("provider_type") == "openai"
                and provider.get("enabled", True)
                and provider.get("auth_token")
            ):
                return provider["auth_token"]
        return None

    async def create_checkpoint(self, sandbox_id: str, message_id: str) -> str | None:
        self._validate_message_id(message_id)
        return await self.provider.create_checkpoint(sandbox_id, message_id)

    async def restore_checkpoint(self, sandbox_id: str, message_id: str) -> bool:
        self._validate_message_id(message_id)
        return await self.provider.restore_checkpoint(sandbox_id, message_id)

    async def list_checkpoints(self, sandbox_id: str) -> list[dict[str, Any]]:
        checkpoints = await self.provider.list_checkpoints(sandbox_id)
        return [
            {"message_id": c.message_id, "created_at": c.created_at}
            for c in checkpoints
        ]

    async def clone_sandbox(
        self, source_sandbox_id: str, checkpoint_id: str | None = None
    ) -> str:
        return await self.provider.clone_sandbox(source_sandbox_id, checkpoint_id)

    async def _enqueue_pty_output(
        self, data: bytes, output_queue: "asyncio.Queue[str]"
    ) -> None:
        # Handles PTY output with backpressure management.
        # When the queue is full (consumer not keeping up), we drop the oldest item
        # rather than blocking or losing the newest data. This prevents the PTY from
        # stalling while ensuring the most recent output is always available.
        try:
            decoded = data.decode("utf-8", errors="replace")
            put_with_overflow(output_queue, decoded)
        except Exception as e:
            logger.error("Error handling PTY output: %s", e, exc_info=True)

    def _get_pty_session_data(
        self, sandbox_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return self._active_pty_sessions.get(sandbox_id, {}).get(session_id)

    async def clean_session_thinking_blocks(
        self, sandbox_id: str, session_id: str
    ) -> bool:
        session_file = f"/home/user/.claude/projects/-home-user/{session_id}.jsonl"
        temp_file = f"{session_file}.tmp"

        # Valid Anthropic signatures are base64-encoded encrypted content, typically 200+ characters.
        # OpenRouter generates empty signatures (length 0).
        # ZAI generates short/fake signatures that pass basic checks but fail Anthropic validation.
        # Using 100 as threshold filters out both while keeping valid Anthropic signatures.
        min_signature_length = 100
        jq_filter = (
            'if .message.content and (.message.content | type) == "array" then '
            f'.message.content |= [.[] | select((.type | IN("thinking", "redacted_thinking") | not) or ((.signature // "") | length) >= {min_signature_length})] '
            "else . end"
        )

        try:
            cmd = (
                f"[ -f {shlex.quote(session_file)} ] && "
                f"jq -c '{jq_filter}' {shlex.quote(session_file)} > {shlex.quote(temp_file)} && "
                f"mv {shlex.quote(temp_file)} {shlex.quote(session_file)} && echo 'OK'"
            )
            result = await self.execute_command(sandbox_id, cmd)

            if "OK" in result.stdout:
                logger.info("Cleaned thinking blocks from session %s", session_id)
                return True

            return False
        except Exception as e:
            logger.error("Error cleaning session %s: %s", session_id, e)
            return False
