from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import secrets
import shlex
import zipfile
from pathlib import Path
from typing import Any, Callable, Coroutine

from app.constants import (
    ANTHROPIC_BRIDGE_HOST,
    ANTHROPIC_BRIDGE_PORT,
    SANDBOX_CLAUDE_DIR,
    SANDBOX_CLAUDE_JSON_PATH,
    SANDBOX_GIT_ASKPASS_PATH,
    SANDBOX_HOME_DIR,
    SANDBOX_IDE_CONFIG_DIR,
    SANDBOX_IDE_SETTINGS_PATH,
    SANDBOX_IDE_TOKEN_PATH,
)
from app.models.types import (
    CustomEnvVarDict,
    CustomProviderDict,
)
from app.models.schemas.settings import ProviderType
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import SandboxException
from app.services.sandbox_providers import (
    PtyDataCallbackType,
    PtySize,
    SandboxProvider,
)
from app.services.claude_folder_sync import (
    CLAUDE_PLUGINS_CACHE_DIR,
    ClaudeFolderSync,
)
from app.services.sandbox_providers.types import CommandResult
from app.services.skill import SkillService

logger = logging.getLogger(__name__)

OPENVSCODE_PORT = 8765
MIN_SIGNATURE_LENGTH = 100

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
        self._ide_tokens: dict[str, str] = {}

    async def cleanup(self) -> None:
        await self.provider.cleanup()

    async def delete_sandbox(self, sandbox_id: str) -> None:
        if not sandbox_id:
            return
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
            content = await self.provider.read_file(sandbox_id, SANDBOX_IDE_TOKEN_PATH)
            if not content.is_binary and content.content:
                token = content.content.strip()
                self._ide_tokens[sandbox_id] = token
                return token
        except Exception as e:
            logger.warning("Failed to read IDE token for sandbox %s: %s", sandbox_id, e)
        return None

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
        except Exception as exc:
            logger.warning(
                "Failed to cleanup browser resources for sandbox %s: %s",
                sandbox_id,
                exc,
            )

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
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        on_data: PtyDataCallbackType,
    ) -> str:
        pty_session = await self.provider.create_pty(
            sandbox_id,
            rows,
            cols,
            tmux_session,
            on_data=on_data,
        )
        return pty_session.id

    async def send_pty_input(
        self, sandbox_id: str, pty_session_id: str, data: bytes
    ) -> None:
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

    async def update_secret(
        self,
        sandbox_id: str,
        key: str,
        value: str,
    ) -> None:
        try:
            sandbox_secrets = await self.provider.get_secrets(sandbox_id)
            secret_exists = any(secret.key == key for secret in sandbox_secrets)
        except Exception as e:
            raise SandboxException(f"Failed to read secrets for update: {str(e)}")

        if not secret_exists:
            await self.provider.add_secret(sandbox_id, key, value)
            return

        try:
            await self.provider.delete_secret(sandbox_id, key)
            await self.provider.add_secret(sandbox_id, key, value)
        except Exception as e:
            raise SandboxException(f"Failed to update secret {key}: {str(e)}")

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

    async def _deploy_resources(
        self,
        sandbox_id: str,
    ) -> None:
        # In desktop mode, resources already live at ~/.claude/ which the
        # sandbox reads directly — no need to copy anything.
        if ClaudeFolderSync.is_active():
            return

        skill_service = SkillService()
        command_service = CommandService()
        agent_service = AgentService()

        skill_paths = skill_service.get_all_skill_paths()
        command_paths = command_service.get_all_resource_paths()
        agent_paths = agent_service.get_all_resource_paths()

        writes: list[tuple[str, str | bytes]] = []

        for skill in skill_paths:
            skill_name = skill["name"]
            skill_dir = Path(skill["path"])

            if not skill_dir.is_dir():
                logger.warning(
                    "Skill directory not found: %s at %s", skill_name, skill_dir
                )
                continue

            for f in skill_dir.rglob("*"):
                if not f.is_file():
                    continue
                try:
                    file_bytes = f.read_bytes()
                except OSError:
                    continue
                rel = str(f.relative_to(skill_dir))
                writes.append(
                    (f"{SANDBOX_CLAUDE_DIR}/skills/{skill_name}/{rel}", file_bytes)
                )

        for command in command_paths:
            command_name = command["name"]
            local_path = Path(command["path"])

            if not local_path.exists():
                logger.warning("Command not found: %s at %s", command_name, local_path)
                continue

            command_content = local_path.read_text(encoding="utf-8")
            writes.append(
                (f"{SANDBOX_CLAUDE_DIR}/commands/{command_name}.md", command_content)
            )

        for agent in agent_paths:
            agent_name = agent["name"]
            local_path = Path(agent["path"])

            if not local_path.exists():
                logger.warning("Agent not found: %s at %s", agent_name, local_path)
                continue

            agent_content = local_path.read_text(encoding="utf-8")
            writes.append(
                (f"{SANDBOX_CLAUDE_DIR}/agents/{agent_name}.md", agent_content)
            )

        container_cache_dir = f"{SANDBOX_CLAUDE_DIR}/plugins/cache"
        plugins_data = ClaudeFolderSync.read_installed_plugins()
        plugin_paths = ClaudeFolderSync.get_active_plugin_paths(plugins_data)
        if plugin_paths:
            remapped_json = ClaudeFolderSync.rewrite_installed_plugins_for_container(
                container_cache_dir, plugins_data
            )
            if remapped_json:
                writes.append(
                    (
                        f"{SANDBOX_CLAUDE_DIR}/plugins/installed_plugins.json",
                        remapped_json,
                    )
                )
            for plugin_dir in plugin_paths:
                try:
                    rel_to_cache = plugin_dir.relative_to(CLAUDE_PLUGINS_CACHE_DIR)
                except ValueError:
                    continue
                for f in plugin_dir.rglob("*"):
                    if not f.is_file():
                        continue
                    try:
                        file_bytes = f.read_bytes()
                    except OSError:
                        continue
                    rel_file = f.relative_to(plugin_dir)
                    writes.append(
                        (
                            f"{container_cache_dir}/{rel_to_cache}/{rel_file}",
                            file_bytes,
                        )
                    )

        if not writes:
            return

        try:
            async with asyncio.TaskGroup() as tg:
                for remote_path, content in writes:
                    tg.create_task(
                        self.provider.write_file(sandbox_id, remote_path, content)
                    )

            resource_count = len(skill_paths) + len(command_paths) + len(agent_paths)
            logger.info(
                "Deployed %d resources (%d files) to sandbox %s",
                resource_count,
                len(writes),
                sandbox_id,
            )
        except Exception as e:
            logger.error("Failed to deploy resources to sandbox %s: %s", sandbox_id, e)
            raise SandboxException(f"Failed to deploy resources to sandbox: {e}") from e

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
                    sandbox_id, "GIT_ASKPASS", SANDBOX_GIT_ASKPASS_PATH
                )
            )

        setup_cmd = (
            f"echo -e '{script_content}' > {SANDBOX_GIT_ASKPASS_PATH} && "
            f"chmod +x {SANDBOX_GIT_ASKPASS_PATH}"
        )
        await self.execute_command(sandbox_id, setup_cmd)

    async def ensure_bridge_running(
        self,
        sandbox_id: str,
        openrouter_api_key: str | None = None,
        copilot_token: str | None = None,
    ) -> None:
        # Check if the bridge is already accepting connections; start it if not.
        # In host mode the bridge process dies when the API container restarts,
        # so we need to restart it lazily before the first chat session.
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", ANTHROPIC_BRIDGE_PORT),
                timeout=1.0,
            )
            writer.close()
            await writer.wait_closed()
            return  # already running
        except (OSError, asyncio.TimeoutError):
            pass

        await self._setup_anthropic_bridge(
            sandbox_id,
            openrouter_api_key=openrouter_api_key,
            copilot_token=copilot_token,
        )
        # Give the bridge a moment to bind the port before Claude CLI tries to connect.
        await asyncio.sleep(1.0)

    async def _setup_anthropic_bridge(
        self,
        sandbox_id: str,
        openrouter_api_key: str | None = None,
        copilot_token: str | None = None,
    ) -> None:
        if openrouter_api_key:
            await self.provider.add_secret(
                sandbox_id, "OPENROUTER_API_KEY", openrouter_api_key
            )
        if copilot_token:
            await self.provider.add_secret(
                sandbox_id, "GITHUB_COPILOT_TOKEN", copilot_token
            )

        start_cmd = f"anthropic-bridge --port {ANTHROPIC_BRIDGE_PORT} --host {ANTHROPIC_BRIDGE_HOST}"
        start_result = await self.execute_command(
            sandbox_id, start_cmd, background=True
        )
        logger.info("Anthropic Bridge started: %s", start_result.stdout)

    async def _start_openvscode_server(self, sandbox_id: str) -> None:
        connection_token = secrets.token_urlsafe(32)
        self._ide_tokens[sandbox_id] = connection_token

        await self.provider.write_file(
            sandbox_id, SANDBOX_IDE_TOKEN_PATH, connection_token
        )

        settings_content = json.dumps(OPENVSCODE_DEFAULT_SETTINGS, indent=2)
        escaped_settings = settings_content.replace("'", "'\"'\"'")

        setup_and_start_cmd = (
            f"mkdir -p {SANDBOX_IDE_CONFIG_DIR} && "
            f"echo '{escaped_settings}' > {SANDBOX_IDE_SETTINGS_PATH} && "
            f"openvscode-server --host 0.0.0.0 --port {OPENVSCODE_PORT} "
            f"--server-base-path /ide/ "
            f"--connection-token-file {SANDBOX_IDE_TOKEN_PATH} --disable-telemetry"
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
        await self.provider.write_file(
            sandbox_id, SANDBOX_IDE_SETTINGS_PATH, settings_content
        )
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
            config: dict[str, Any] = {}
            try:
                existing = await self.provider.read_file(
                    sandbox_id, SANDBOX_CLAUDE_JSON_PATH
                )
                if not existing.is_binary and existing.content:
                    config = json.loads(existing.content)
            except Exception:
                pass
            config["autoCompactEnabled"] = False
            await self.provider.write_file(
                sandbox_id, SANDBOX_CLAUDE_JSON_PATH, json.dumps(config, indent=2)
            )

        if attribution_disabled:
            settings_path = f"{SANDBOX_CLAUDE_DIR}/settings.json"
            settings: dict[str, Any] = {}
            await self.execute_command(sandbox_id, f"mkdir -p {SANDBOX_CLAUDE_DIR}")
            try:
                existing = await self.provider.read_file(sandbox_id, settings_path)
                if not existing.is_binary and existing.content:
                    settings = json.loads(existing.content)
            except Exception:
                pass
            settings["attribution"] = {"commit": "", "pr": ""}
            await self.provider.write_file(
                sandbox_id, settings_path, json.dumps(settings, indent=2)
            )

    async def _setup_openai_auth(self, sandbox_id: str, openai_auth_json: str) -> None:
        openai_dir = f"{SANDBOX_HOME_DIR}/.codex"
        await self.execute_command(sandbox_id, f"mkdir -p {openai_dir}")
        await self.provider.write_file(
            sandbox_id, f"{openai_dir}/auth.json", openai_auth_json
        )

    async def initialize_sandbox(
        self,
        sandbox_id: str,
        github_token: str | None = None,
        custom_env_vars: list[CustomEnvVarDict] | None = None,
        auto_compact_disabled: bool = False,
        attribution_disabled: bool = False,
        custom_providers: list[CustomProviderDict] | None = None,
    ) -> None:
        tasks: list[Coroutine[None, None, None]] = [
            self._start_openvscode_server(sandbox_id),
        ]

        tasks.append(
            self._setup_claude_config(
                sandbox_id, auto_compact_disabled, attribution_disabled
            )
        )

        if custom_env_vars:
            tasks.append(self._add_env_vars_parallel(sandbox_id, custom_env_vars))

        tasks.append(self._deploy_resources(sandbox_id))

        if github_token:
            tasks.append(self._setup_github_token(sandbox_id, github_token))

        openai_auth = self._get_openai_auth_from_provider(custom_providers)
        if openai_auth:
            tasks.append(self._setup_openai_auth(sandbox_id, openai_auth))

        openrouter_api_key = self._get_openrouter_api_key(custom_providers)
        openai_enabled = self._has_openai_provider(custom_providers)
        copilot_token = self._get_copilot_token(custom_providers)
        if openrouter_api_key or openai_enabled or copilot_token:
            tasks.append(
                self._setup_anthropic_bridge(
                    sandbox_id,
                    openrouter_api_key=openrouter_api_key,
                    copilot_token=copilot_token,
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
                provider.get("provider_type") == ProviderType.OPENROUTER.value
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
            provider.get("provider_type") == ProviderType.OPENAI.value
            and provider.get("enabled", True)
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
                provider.get("provider_type") == ProviderType.OPENAI.value
                and provider.get("enabled", True)
                and provider.get("auth_token")
            ):
                return provider["auth_token"]
        return None

    @staticmethod
    def _get_copilot_token(
        custom_providers: list[CustomProviderDict] | None,
    ) -> str | None:
        if not custom_providers:
            return None
        for provider in custom_providers:
            if (
                provider.get("provider_type") == ProviderType.COPILOT.value
                and provider.get("enabled", True)
                and provider.get("auth_token")
            ):
                return provider["auth_token"]
        return None

    async def clean_session_thinking_blocks(
        self, sandbox_id: str, session_id: str
    ) -> bool:
        session_file = f"{SANDBOX_CLAUDE_DIR}/projects/-home-user/{session_id}.jsonl"
        temp_file = f"{session_file}.tmp"

        jq_filter = (
            'if .message.content and (.message.content | type) == "array" then '
            f'.message.content |= [.[] | select((.type | IN("thinking", "redacted_thinking") | not) or ((.signature // "") | length) >= {MIN_SIGNATURE_LENGTH})] '
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
