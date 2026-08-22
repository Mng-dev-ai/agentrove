from __future__ import annotations

import asyncio
import base64
import logging
import os
import shlex
import signal
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from acp.client.connection import ClientSideConnection
from acp.schema import (
    BlobResourceContents,
    ClientCapabilities,
    EmbeddedResourceContentBlock,
    ElicitationCapabilities,
    ElicitationFormCapabilities,
    EnvVariable,
    HttpHeader,
    ImageContentBlock,
    McpServerHttp,
    McpServerStdio,
    TextContentBlock,
)

from app.constants import SANDBOX_HOME_DIR, SANDBOX_WORKSPACE_DIR, TERMINAL_TYPE
from app.core.config import get_settings
from app.services.acp.adapters import (
    AGENT_ADAPTERS,
    NATIVE_FILE_TYPES,
    AgentKind,
    LaunchConfig,
)
from app.services.acp.client import AcpClientHandler
from app.services.exceptions import AgentException
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.base import SandboxProvider
from app.services.sandbox_providers.docker_provider import (
    DOCKER_SANDBOX_CONTAINER_PREFIX,
)

logger = logging.getLogger(__name__)
settings = get_settings()

ACP_PROTOCOL_VERSION = 1
# 100 MB — large enough for long-running agent sessions that produce extensive
# tool output (e.g. full file reads, large diffs) without hitting asyncio's
# default 64 KB stream buffer limit.
STDIO_BUFFER_LIMIT = 100 * 1024 * 1024

IMAGE_MIME_BY_EXT: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

NON_IMAGE_MIME: dict[str, str] = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

EMPTY_FROZENSET: frozenset[str] = frozenset()

# Claude's thinking budget is advertised as the "effort" session config
# option; value IDs are the supported Claude UI tiers.
CLAUDE_EFFORT_CONFIG_ID = "effort"
CLAUDE_MODEL_CONFIG_ID = "model"
COPILOT_EFFORT_CONFIG_ID = "reasoning_effort"

# codex-acp advertises Fast mode as a session config option (select on/off, or
# boolean when the client supports it). Values match FastModeConfig.ts.
CODEX_FAST_MODE_CONFIG_ID = "fast-mode"
CODEX_FAST_MODE_ON = "on"
CODEX_FAST_MODE_OFF = "off"


@dataclass
class AcpSessionConfig:
    # Config to spawn an ACP agent and open a session.
    # Built by AgentService._build_acp_config() from chat/user/model state.
    sandbox_id: str
    sandbox_provider: SandboxProviderType
    cwd: str
    # Owner of the chat's workspace — keys the per-user agent home that
    # host-mode processes get as HOME in web mode.
    user_id: str
    agent_kind: AgentKind = AgentKind.CLAUDE
    env: dict[str, str] = field(default_factory=dict)
    mcp_servers: list[dict[str, Any]] = field(default_factory=list)
    model: str = ""
    permission_mode: str = "default"
    resume_session_id: str | None = None
    workspace_path: str | None = None
    system_prompt: str | None = None
    system_prompt_is_full_replace: bool = False
    reasoning_effort: str | None = None
    session_meta: dict[str, Any] = field(default_factory=dict)
    # Codex-only: absolute path to a model_instructions_file written before spawn
    # when doing a full system prompt replacement (personas, one-shot text tasks).
    codex_instructions_file_path: str | None = None
    # Codex-only: 1.5x speed service tier via set_config_option("fast-mode").
    fast_mode: bool = False


class AcpSession:
    # One ACP agent process per chat: spawn, handshake, prompt, teardown.

    def __init__(
        self,
        handler: AcpClientHandler,
        conn: ClientSideConnection,
        process: asyncio.subprocess.Process,
        acp_session_id: str,
        agent_kind: AgentKind = AgentKind.CLAUDE,
        stderr_task: asyncio.Task[None] | None = None,
        exit_watch_task: asyncio.Task[None] | None = None,
    ) -> None:
        self._handler = handler
        self._conn = conn
        self._process = process
        self.acp_session_id = acp_session_id
        self._agent_kind = agent_kind
        self._stderr_task = stderr_task
        self._exit_watch_task = exit_watch_task

    @property
    def handler(self) -> AcpClientHandler:
        return self._handler

    def is_alive(self) -> bool:
        return self._process.returncode is None

    async def send_prompt(
        self,
        content: str,
        attachments: list[dict[str, Any]] | None = None,
        agent_kind: AgentKind = AgentKind.CLAUDE,
    ) -> None:
        self._handler.prepare_for_prompt()

        prompt_blocks: list[
            TextContentBlock | ImageContentBlock | EmbeddedResourceContentBlock
        ] = [
            TextContentBlock(type="text", text=content),
        ]
        if attachments:
            attachment_note = self._build_attachment_note(attachments, agent_kind)
            if attachment_note:
                prompt_blocks.append(
                    TextContentBlock(type="text", text=attachment_note)
                )
            prompt_blocks.extend(self._build_attachment_blocks(attachments, agent_kind))

        try:
            await self._conn.prompt(
                prompt=prompt_blocks,
                session_id=self.acp_session_id,
            )
            prompt_completed = True
        except BaseException:
            prompt_completed = False
            raise
        finally:
            self._handler.finish(prompt_completed=prompt_completed)

    @staticmethod
    def _build_attachment_note(
        attachments: list[dict[str, Any]],
        agent_kind: AgentKind,
    ) -> str:
        native_types = NATIVE_FILE_TYPES.get(agent_kind, EMPTY_FROZENSET)
        lines: list[str] = []
        for att in attachments:
            file_type = att.get("file_type", "")
            if file_type in native_types:
                continue
            file_path = att.get("file_path")
            if not isinstance(file_path, str) or not file_path:
                continue
            sandbox_path = SANDBOX_WORKSPACE_DIR + "/" + Path(file_path).name
            filename = att.get("filename")
            label = (
                filename
                if isinstance(filename, str) and filename
                else Path(file_path).name
            )
            lines.append("- " + label + " is available at " + sandbox_path)
        if not lines:
            return ""
        return (
            "<user_attachments>\n"
            + "User uploaded the following files. Read them from these sandbox paths when needed.\n"
            + "\n".join(lines)
            + "\n</user_attachments>"
        )

    @staticmethod
    def _build_attachment_blocks(
        attachments: list[dict[str, Any]],
        agent_kind: AgentKind,
    ) -> list[ImageContentBlock | EmbeddedResourceContentBlock]:
        storage_path = Path(settings.STORAGE_PATH)
        blocks: list[ImageContentBlock | EmbeddedResourceContentBlock] = []
        for att in attachments:
            file_path = att.get("file_path")
            if not file_path:
                continue
            file_type = att.get("file_type", "")
            # Only include file types this agent can consume natively in the prompt.
            if file_type not in NATIVE_FILE_TYPES.get(agent_kind, EMPTY_FROZENSET):
                continue
            full_path = storage_path / file_path
            try:
                raw = full_path.read_bytes()
            except OSError:
                logger.warning("Attachment file not found: %s", full_path)
                continue
            encoded = base64.standard_b64encode(raw).decode("ascii")
            filename = att.get("filename", full_path.name)

            if file_type == "image":
                ext = Path(filename).suffix.lower()
                mime = IMAGE_MIME_BY_EXT.get(ext, "image/png")
                blocks.append(
                    ImageContentBlock(
                        type="image",
                        data=encoded,
                        mimeType=mime,
                    )
                )
            else:
                mime = NON_IMAGE_MIME.get(file_type, "application/octet-stream")
                blocks.append(
                    EmbeddedResourceContentBlock(
                        type="resource",
                        resource=BlobResourceContents(
                            blob=encoded,
                            uri=f"file:///{filename}",
                            mimeType=mime,
                        ),
                    )
                )
        return blocks

    async def cancel(self) -> None:
        try:
            await self._conn.cancel(session_id=self.acp_session_id)
        except Exception:
            logger.warning("Failed to send ACP cancel", exc_info=True)

    async def set_model(
        self, model_id: str, reasoning_effort: str | None = None
    ) -> None:
        try:
            await self._set_model_on_conn(
                self._conn,
                self._agent_kind,
                self.acp_session_id,
                model_id,
                reasoning_effort,
            )
        except Exception:
            logger.warning("Failed to set ACP model: %s", model_id, exc_info=True)
        else:
            if self._agent_kind == AgentKind.COPILOT and reasoning_effort:
                try:
                    await self._conn.set_config_option(
                        config_id=COPILOT_EFFORT_CONFIG_ID,
                        session_id=self.acp_session_id,
                        value=reasoning_effort,
                    )
                except Exception:
                    logger.warning(
                        "Failed to set Copilot effort: %s",
                        reasoning_effort,
                        exc_info=True,
                    )

    async def set_mode(self, mode_id: str) -> None:
        try:
            await self._set_mode_on_conn(
                self._conn, self._agent_kind, self.acp_session_id, mode_id
            )
        except Exception:
            logger.warning("Failed to set ACP mode: %s", mode_id, exc_info=True)

    async def set_fast_mode(self, enabled: bool) -> None:
        try:
            await self._set_fast_mode_on_conn(
                self._conn, self._agent_kind, self.acp_session_id, enabled
            )
        except Exception:
            logger.warning("Failed to set Codex fast mode: %s", enabled, exc_info=True)

    async def close(self) -> None:
        # Orderly shutdown: cancel pending client RPCs, close the ACP connection, then
        # terminate the agent process with a SIGTERM grace period before SIGKILL.
        # The exit watcher is left running; it no-ops once the process is reaped.
        self._handler.cancel_pending_permissions()
        self._handler.cancel_pending_elicitations()
        if self._stderr_task and not self._stderr_task.done():
            self._stderr_task.cancel()
        try:
            await self._conn.close()
        except Exception:
            logger.debug("Error closing ACP connection", exc_info=True)

        if self._process.returncode is None:
            try:
                # Signal the whole process group, not just the direct child —
                # the codex-acp node shim doesn't forward SIGTERM to its native
                # binary, which would otherwise orphan to PID 1 and never exit.
                os.killpg(self._process.pid, signal.SIGTERM)
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                await self._force_kill_group(self._process)
            except Exception:
                logger.debug("Error killing ACP agent process", exc_info=True)

    @staticmethod
    async def _watch_process_exit(
        process: asyncio.subprocess.Process,
        conn: ClientSideConnection,
        handler: AcpClientHandler,
    ) -> None:
        # The SDK treats a dead agent's EOF as a clean end and never rejects
        # pending RPCs — close the connection so the turn fails instead of hanging.
        await process.wait()
        handler.cancel_pending_permissions()
        handler.cancel_pending_elicitations()
        try:
            await conn.close()
        except Exception:
            logger.debug("Error closing ACP connection after agent exit", exc_info=True)

    @staticmethod
    async def _force_kill_group(process: asyncio.subprocess.Process) -> None:
        # Group already gone (the child watcher thread can reap between our
        # returncode check and the signal) — nothing left to kill or wait on.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        await process.wait()

    @classmethod
    async def create(cls, config: AcpSessionConfig) -> AcpSession:
        handler = AcpClientHandler(agent_kind=config.agent_kind)
        # Resolve the workspace-relative cwd to a runtime-absolute path via the
        # provider — the single edge where relative → absolute translation lives.
        provider = SandboxProvider.create_provider(
            config.sandbox_provider,
            workspace_path=config.workspace_path,
        )
        spawn_config = replace(config, cwd=provider.resolve_workspace_path(config.cwd))

        # Codex ignores base_instructions for full system prompt replacement, so
        # we write the prompt to a file and point Codex at it via
        # model_instructions_file (emitted by the Codex adapter). The file goes to
        # a temp path outside the workspace — create() rewrites it on every spawn
        # (including resume), so nothing needs to persist in the user's project.
        if (
            config.system_prompt_is_full_replace
            and config.system_prompt
            and config.agent_kind == AgentKind.CODEX
        ):
            instructions_abs_path = await provider.write_temp_file(
                config.sandbox_id, config.system_prompt
            )
            spawn_config = replace(
                spawn_config,
                codex_instructions_file_path=instructions_abs_path,
            )

        process = await cls._spawn_process(spawn_config)

        if process.stdin is None or process.stdout is None:
            await cls._force_kill_group(process)
            raise RuntimeError("Failed to open stdio pipes to ACP agent process")

        conn = ClientSideConnection(
            handler,
            process.stdin,
            process.stdout,
            use_unstable_protocol=True,
        )

        stderr_task = asyncio.create_task(cls._read_stderr(process))
        # Started before the handshake so a crash there also unblocks.
        exit_watch_task = asyncio.create_task(
            cls._watch_process_exit(process, conn, handler)
        )

        try:
            await conn.initialize(
                protocol_version=ACP_PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(
                    elicitation=ElicitationCapabilities(
                        form=ElicitationFormCapabilities()
                    )
                ),
            )

            mcp_servers = cls._build_mcp_servers(config.mcp_servers)
            session_meta = config.session_meta

            if config.resume_session_id:
                # Mute the handler during load_session so replayed history
                # events don't leak onto the live stream.
                handler.muted = True
                try:
                    await conn.load_session(
                        cwd=spawn_config.cwd,
                        session_id=config.resume_session_id,
                        mcp_servers=mcp_servers,
                        **session_meta,
                    )
                finally:
                    handler.muted = False
                    handler.prepare_for_prompt()
                acp_session_id = config.resume_session_id
            else:
                response = await conn.new_session(
                    cwd=spawn_config.cwd,
                    mcp_servers=mcp_servers,
                    **session_meta,
                )
                acp_session_id = response.session_id

            model_set = False
            if config.model:
                try:
                    await cls._set_model_on_conn(
                        conn,
                        config.agent_kind,
                        acp_session_id,
                        config.model,
                        config.reasoning_effort,
                    )
                    model_set = True
                except Exception:
                    logger.warning(
                        "Failed to set initial model: %s", config.model, exc_info=True
                    )

            if config.permission_mode and config.permission_mode != "default":
                try:
                    await cls._set_mode_on_conn(
                        conn,
                        config.agent_kind,
                        acp_session_id,
                        config.permission_mode,
                    )
                except Exception:
                    logger.warning(
                        "Failed to set initial mode: %s",
                        config.permission_mode,
                        exc_info=True,
                    )

            # Claude receives thinking budget via the "effort" session config
            # option (not launch CLI args), so it must be applied after
            # new_session/load_session. Codex carries effort inside the
            # model[effort] ID set above, so it doesn't need this step.
            if config.agent_kind == AgentKind.CLAUDE and config.reasoning_effort:
                try:
                    await conn.set_config_option(
                        config_id=CLAUDE_EFFORT_CONFIG_ID,
                        session_id=acp_session_id,
                        value=config.reasoning_effort,
                    )
                except Exception:
                    logger.warning(
                        "Failed to set initial effort: %s",
                        config.reasoning_effort,
                        exc_info=True,
                    )

            if (
                config.agent_kind == AgentKind.COPILOT
                and config.reasoning_effort
                and model_set
            ):
                try:
                    await conn.set_config_option(
                        config_id=COPILOT_EFFORT_CONFIG_ID,
                        session_id=acp_session_id,
                        value=config.reasoning_effort,
                    )
                except Exception:
                    logger.warning(
                        "Failed to set initial Copilot effort: %s",
                        config.reasoning_effort,
                        exc_info=True,
                    )

            # Fast mode is per-turn service tier state inside codex-acp; default
            # is off so only enable when the user opted in.
            if config.fast_mode:
                try:
                    await cls._set_fast_mode_on_conn(
                        conn, config.agent_kind, acp_session_id, True
                    )
                except Exception:
                    logger.warning("Failed to enable Codex fast mode")

        except Exception as exc:
            stderr_output = ""
            if process.stderr:
                try:
                    stderr_bytes = await asyncio.wait_for(
                        process.stderr.read(8192), timeout=2.0
                    )
                    stderr_output = stderr_bytes.decode(errors="replace").strip()
                except (asyncio.TimeoutError, Exception):
                    pass
            stderr_task.cancel()
            exit_watch_task.cancel()

            error_data = getattr(exc, "data", None)
            error_code = getattr(exc, "code", None)
            logger.error(
                "ACP session creation failed: %s | code: %s | data: %s | stderr: %s | cwd: %s | sandbox: %s/%s | env_keys: %s",
                exc,
                error_code,
                error_data,
                stderr_output or "(empty)",
                config.cwd,
                config.sandbox_provider,
                config.sandbox_id,
                list(config.env.keys()),
            )

            await conn.close()
            if process.returncode is None:
                await cls._force_kill_group(process)
            raise

        return cls(
            handler=handler,
            conn=conn,
            process=process,
            acp_session_id=acp_session_id,
            agent_kind=config.agent_kind,
            stderr_task=stderr_task,
            exit_watch_task=exit_watch_task,
        )

    @staticmethod
    async def _set_mode_on_conn(
        conn: ClientSideConnection,
        agent_kind: AgentKind,
        session_id: str,
        mode_id: str,
    ) -> None:
        # Stable Grok ignores set_mode; always-approve is enforced at launch.
        # Keep the plan hop in case ACP modes return; no turn runs between calls.
        if agent_kind == AgentKind.GROK and mode_id != "plan":
            await conn.set_session_mode(mode_id="plan", session_id=session_id)
        await conn.set_session_mode(mode_id=mode_id, session_id=session_id)

    @staticmethod
    async def _set_model_on_conn(
        conn: ClientSideConnection,
        agent_kind: AgentKind,
        session_id: str,
        model_id: str,
        reasoning_effort: str | None = None,
    ) -> None:
        acp_model_id = AGENT_ADAPTERS[agent_kind].map_model_id(
            model_id, reasoning_effort
        )
        # codex-acp encodes reasoning effort inside the model ID and rejects
        # bare IDs ("modelId[effort]" is the required format).
        if agent_kind == AgentKind.CODEX and reasoning_effort:
            acp_model_id = f"{acp_model_id}[{reasoning_effort}]"
        await conn.set_config_option(
            config_id=CLAUDE_MODEL_CONFIG_ID,
            session_id=session_id,
            value=acp_model_id,
        )

    @staticmethod
    async def _set_fast_mode_on_conn(
        conn: ClientSideConnection,
        agent_kind: AgentKind,
        session_id: str,
        enabled: bool,
    ) -> None:
        # codex-acp only; no-op for other agents. Select values ("on"/"off")
        # work for clients without boolean configOptions capability.
        if agent_kind != AgentKind.CODEX:
            return
        await conn.set_config_option(
            config_id=CODEX_FAST_MODE_CONFIG_ID,
            session_id=session_id,
            value=CODEX_FAST_MODE_ON if enabled else CODEX_FAST_MODE_OFF,
        )

    @staticmethod
    async def _read_stderr(process: asyncio.subprocess.Process) -> None:
        if process.stderr is None:
            return
        while True:
            line = await process.stderr.readline()
            if not line:
                break
            logger.warning(
                "acp-agent stderr: %s", line.decode(errors="replace").rstrip()
            )

    @staticmethod
    def _build_launch_config(config: AcpSessionConfig) -> LaunchConfig:
        adapter = AGENT_ADAPTERS[config.agent_kind]
        return adapter.build_launch_config(
            system_prompt=config.system_prompt,
            system_prompt_is_full_replace=config.system_prompt_is_full_replace,
            instructions_file_path=config.codex_instructions_file_path,
            reasoning_effort=config.reasoning_effort,
            permission_mode=config.permission_mode,
        )

    @staticmethod
    async def _spawn_process(config: AcpSessionConfig) -> asyncio.subprocess.Process:
        if config.sandbox_provider is SandboxProviderType.DOCKER:
            return await AcpSession._spawn_docker(config)
        if config.sandbox_provider is SandboxProviderType.HOST:
            return await AcpSession._spawn_host(config)
        raise ValueError(f"Unknown sandbox provider: {config.sandbox_provider}")

    @staticmethod
    async def _spawn_docker(config: AcpSessionConfig) -> asyncio.subprocess.Process:
        container_name = f"{DOCKER_SANDBOX_CONTAINER_PREFIX}{config.sandbox_id}"
        launch = AcpSession._build_launch_config(config)

        cmd: list[str] = [
            "docker",
            "exec",
            "-i",
            "-u",
            "user",
            "-w",
            config.cwd,
        ]
        for key, value in {**config.env, **launch.env}.items():
            cmd.extend(["-e", f"{key}={value}"])

        # Run through bash login shell so .bashrc env vars are available
        agent_parts = [launch.binary, *launch.cli_args]
        agent_cmd = "exec " + shlex.join(agent_parts)
        cmd.extend([container_name, "bash", "-lc", agent_cmd])

        # New process group so close() can killpg without hitting the backend's
        # own group (the docker CLI has no host-side descendants, but teardown
        # signals the group unconditionally).
        return await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=STDIO_BUFFER_LIMIT,
            start_new_session=True,
        )

    @staticmethod
    async def _spawn_host(config: AcpSessionConfig) -> asyncio.subprocess.Process:
        launch = AcpSession._build_launch_config(config)

        # Inherit host env (auth, proxy, TLS, PATH).
        env = dict(os.environ)
        if config.sandbox_id and not settings.DESKTOP_MODE:
            # Web mode: HOME is the per-user agent home, shared by every
            # workspace of the user, so CLI logins/MCP/skills are configured
            # once — not once per workspace.
            home = settings.get_agent_home_dir(config.user_id)
            Path(home).mkdir(parents=True, exist_ok=True)
            # Rewrite virtual sandbox paths (/home/user/...) in env values to
            # the real home. GIT_ASKPASS is exempt by design: in host mode it
            # already points at a real API-filesystem path.
            for key, val in config.env.items():
                env[key] = val.replace(SANDBOX_HOME_DIR, home)
            env["HOME"] = home
        else:
            # Desktop mode keeps the real host env/HOME so existing auth resolves.
            env.update(config.env)
        # Launch env carries runtime-resolved values (e.g. Codex's CODEX_CONFIG
        # with an absolute instructions path), so it skips the sandbox-path rewrite.
        env.update(launch.env)
        env.setdefault("TERM", TERMINAL_TYPE)

        try:
            # New process group so close() can killpg the shim and its native
            # child together (codex-acp's shim doesn't forward signals).
            return await asyncio.create_subprocess_exec(
                launch.binary,
                *launch.cli_args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=STDIO_BUFFER_LIMIT,
                env=env,
                cwd=config.cwd,
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise AgentException(
                launch.binary
                + " is required for "
                + config.agent_kind.value
                + " host-mode sessions. Install it and restart Agentrove."
            ) from exc

    @staticmethod
    def _build_mcp_servers(
        mcp_configs: list[dict[str, Any]],
    ) -> list[McpServerStdio | McpServerHttp]:
        servers: list[McpServerStdio | McpServerHttp] = []
        for cfg in mcp_configs:
            mcp_type = cfg.get("type")
            if mcp_type in ("http", "sse"):
                url = cfg.get("url")
                if not url:
                    continue
                headers = [
                    HttpHeader(name=k, value=v)
                    for k, v in cfg.get("headers", {}).items()
                ]
                servers.append(
                    McpServerHttp(
                        name=cfg.get("name") or url,
                        url=url,
                        headers=headers,
                    )
                )
                continue
            command = cfg.get("command")
            if not command:
                continue
            env_list = [
                EnvVariable(name=k, value=v) for k, v in cfg.get("env", {}).items()
            ]
            servers.append(
                McpServerStdio(
                    name=cfg.get("name") or command,
                    command=command,
                    args=cfg.get("args", []),
                    env=env_list,
                )
            )
        return servers
