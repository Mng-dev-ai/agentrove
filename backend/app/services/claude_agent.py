import logging
import sys
from collections.abc import AsyncIterator, Callable
from functools import partial
from pathlib import Path
from typing import Any, Literal, NamedTuple

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ClaudeSDKError,
    ResultMessage,
)

from app.constants import (
    SANDBOX_GIT_ASKPASS_PATH,
    SANDBOX_HOME_DIR,
    SANDBOX_WORKSPACE_DIR,
)
from app.core.config import get_settings
from app.core.security import create_chat_scoped_token
from app.db.session import SessionLocal
from app.models.db_models.chat import Chat
from app.models.db_models.enums import MessageRole
from app.models.db_models.user import User, UserSettings
from app.models.schemas.settings import ProviderType
from app.prompts.enhance_prompt import ENHANCE_PROMPT
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.prompts.generate_title import (
    GENERATE_TITLE_SYSTEM_PROMPT,
    GENERATE_TITLE_USER_TEMPLATE,
)
from app.services.exceptions import ClaudeAgentException
from app.services.provider import ProviderService
from app.services.sandbox_providers import SandboxProviderType
from app.services.streaming.processor import StreamProcessor
from app.services.streaming.types import StreamEvent
from app.services.tool_handler import ToolHandlerRegistry
from app.services.transports import SandboxTransport
from app.services.transports.factory import create_sandbox_transport
from app.services.user import UserService

settings = get_settings()
logger = logging.getLogger(__name__)

THINKING_MODE_TOKENS = {
    "low": 4000,
    "medium": 10000,
    "high": 15000,
    "ultra": 32000,
}
ALLOWED_SLASH_COMMANDS = [
    "/context",
    "/compact",
    "/pr-comments",
    "/review",
    "/init",
    "/debug",
    "/security-review",
    "/insights",
    "/simplify",
    "/loop",
    "/batch",
]
SDK_PERMISSION_MODE_MAP: dict[str, Literal["default", "acceptEdits", "plan"]] = {
    "plan": "plan",
    "ask": "default",
    "auto": "acceptEdits",
}
PLAN_MODE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("tool_completed", "ExitPlanMode"): "auto",
    ("tool_completed", "EnterPlanMode"): "plan",
    ("tool_failed", "ExitPlanMode"): "plan",
    ("tool_failed", "EnterPlanMode"): "auto",
}
MCP_TYPE_CONFIGS: dict[str, dict[str, Any]] = {
    "npx": {
        "command": "npx",
        "required_field": "package",
        "args_prefix": ("-y",),
    },
    "bunx": {
        "command": "bunx",
        "required_field": "package",
        "args_prefix": (),
    },
    "uvx": {
        "command": "uvx",
        "required_field": "package",
        "args_prefix": (),
    },
    "http": {
        "type": "http",
        "required_field": "url",
        "is_http": True,
    },
}


class StreamResult:
    __slots__ = ("total_cost_usd", "usage")

    def __init__(self) -> None:
        self.total_cost_usd: float = 0.0
        self.usage: dict[str, Any] | None = None


class SessionParams(NamedTuple):
    options: ClaudeAgentOptions
    transport_factory: Callable[[], SandboxTransport]


class ClaudeAgentService:
    def __init__(self, session_factory: Callable[..., Any] | None = None) -> None:
        self.tool_registry = ToolHandlerRegistry()
        self.session_factory = session_factory or SessionLocal
        self._provider_service = ProviderService()

    async def build_session_params(
        self,
        *,
        user: User,
        chat: Chat,
        system_prompt: str,
        model_id: str,
        permission_mode: str,
        session_id: str | None,
        thinking_mode: str | None,
        worktree: bool = False,
        selected_persona_name: str = DEFAULT_PERSONA_NAME,
    ) -> SessionParams:
        # Resolve chat + user settings into everything needed to launch a Claude
        # SDK session: agent options, sandbox identity, and a transport factory.
        chat_id = str(chat.id)
        user_settings = await UserService(
            session_factory=self.session_factory
        ).get_user_settings(user.id)

        sandbox_provider = chat.sandbox_provider or SandboxProviderType.DOCKER.value
        sandbox_id: str = chat.sandbox_id or ""
        workspace_path = chat.workspace_path
        claude_cwd = SANDBOX_HOME_DIR
        if workspace_path:
            claude_cwd = SANDBOX_WORKSPACE_DIR

        options = await self._build_claude_options(
            user_settings=user_settings,
            system_prompt=system_prompt,
            permission_mode=permission_mode,
            model_id=model_id,
            session_id=session_id,
            thinking_mode=thinking_mode,
            worktree=worktree,
            chat_id=chat_id,
            selected_persona_name=selected_persona_name,
            cwd=claude_cwd,
            sandbox_provider=sandbox_provider,
        )

        transport_factory = partial(
            create_sandbox_transport,
            sandbox_provider=sandbox_provider,
            sandbox_id=sandbox_id,
            workspace_path=workspace_path,
            options=options,
        )

        return SessionParams(
            options=options,
            transport_factory=transport_factory,
        )

    async def stream_response(
        self,
        client: ClaudeSDKClient,
        prompt: str,
        custom_instructions: str | None,
        session_id: str | None,
        result: StreamResult,
        session_callback: Callable[[str, str | None], None] | None = None,
        attachments: list[dict[str, Any]] | None = None,
        attachment_base_dir: str = SANDBOX_HOME_DIR,
    ) -> AsyncIterator[StreamEvent]:
        # Send a prompt to the Claude SDK client and yield processed stream
        # events, handling plan mode transitions on tool success/failure.
        user_prompt = self.prepare_user_prompt(
            prompt, custom_instructions, attachments, attachment_base_dir
        )

        prompt_message = {
            "type": "user",
            "message": {"role": MessageRole.USER.value, "content": user_prompt},
            "parent_tool_use_id": None,
            "session_id": session_id,
        }
        prompt_iterable = self._create_prompt_iterable(prompt_message)

        processor = StreamProcessor(
            tool_registry=self.tool_registry,
            session_handler=session_callback,
        )

        try:
            await client.query(prompt_iterable)
            async for message in client.receive_response():
                prev_usage = processor.usage
                for event in processor.emit_events_for_message(message):
                    if event:
                        yield event
                        event_type = event.get("type", "")
                        tool_name = event.get("tool", {}).get("name", "")
                        mode = PLAN_MODE_TRANSITIONS.get((event_type, tool_name))
                        if mode:
                            sdk_mode = SDK_PERMISSION_MODE_MAP.get(mode, "acceptEdits")
                            await client.set_permission_mode(sdk_mode)
                if processor.usage is not prev_usage:
                    result.usage = processor.usage

            result.total_cost_usd = processor.total_cost_usd
            result.usage = processor.usage

        except ClaudeSDKError as e:
            raise ClaudeAgentException(f"Claude SDK error: {str(e)}") from e

    def _build_auth_env(
        self, model_id: str, user_settings: UserSettings
    ) -> tuple[dict[str, str], str | None, str]:
        # Build env vars that authenticate the SDK against the user's configured
        # provider (Anthropic, OpenRouter, Copilot, etc.). Returns the env dict,
        # the provider type, and the resolved model ID.
        provider, actual_model_id = self._provider_service.get_provider_for_model(
            user_settings, model_id
        )

        env: dict[str, str] = {}
        if not provider:
            return env, None, actual_model_id

        provider_type = provider.get("provider_type", "custom")
        auth_token = provider.get("auth_token")

        if provider_type == ProviderType.ANTHROPIC.value:
            # Direct Anthropic API — in host mode the CLI uses the user's
            # existing login; in Docker mode an explicit token is needed.
            # sk-ant-api03- = real API key → ANTHROPIC_API_KEY
            # sk-ant-oat01- = OAuth Access Token → CLAUDE_CODE_OAUTH_TOKEN
            # anything else (claude setup-token output) → CLAUDE_CODE_OAUTH_TOKEN
            if auth_token:
                if auth_token.startswith("sk-ant-api03-"):
                    env["ANTHROPIC_API_KEY"] = auth_token
                else:
                    env["CLAUDE_CODE_OAUTH_TOKEN"] = auth_token
        elif provider_type in (
            ProviderType.OPENROUTER.value,
            ProviderType.OPENAI.value,
            ProviderType.COPILOT.value,
        ):
            # Non-Anthropic providers route through our local bridge
            # (https://github.com/Mng-dev-ai/anthropic-bridge) that translates
            # Anthropic API calls to the provider's format.
            if auth_token and provider_type == ProviderType.OPENROUTER.value:
                env["OPENROUTER_API_KEY"] = auth_token
            elif auth_token and provider_type == ProviderType.COPILOT.value:
                env["GITHUB_COPILOT_TOKEN"] = auth_token
            # Point the SDK at our local bridge instead of the real Anthropic API
            env["ANTHROPIC_BASE_URL"] = "http://127.0.0.1:3456"
            # Placeholder token — the bridge handles real auth via provider keys
            env["ANTHROPIC_AUTH_TOKEN"] = "placeholder"
            # Tell subagents which model to use on this provider
            env["CLAUDE_CODE_SUBAGENT_MODEL"] = actual_model_id
        elif provider_type == ProviderType.CUSTOM.value:
            # Custom provider — user supplies their own base URL and token
            if provider.get("base_url"):
                env["ANTHROPIC_BASE_URL"] = provider["base_url"]
            if auth_token:
                env["ANTHROPIC_AUTH_TOKEN"] = auth_token

        return env, provider_type, actual_model_id

    async def enhance_prompt(self, prompt: str, model_id: str, user: User) -> str:
        # Use the SDK to rewrite the user's prompt into a more effective version.
        user_settings = await UserService(
            session_factory=self.session_factory
        ).get_user_settings(user.id)

        env, _, actual_model_id = self._build_auth_env(model_id, user_settings)

        options = ClaudeAgentOptions(
            system_prompt=ENHANCE_PROMPT,
            permission_mode="default",
            model=actual_model_id,
            max_turns=1,
            env=env,
        )

        enhanced_text = ""
        try:
            async with ClaudeSDKClient(options=options) as client:
                await client.query(f"Enhance this prompt: {prompt}")
                async for message in client.receive_response():
                    if isinstance(message, ResultMessage) and message.result:
                        enhanced_text = message.result

            return enhanced_text or prompt

        except ClaudeSDKError as e:
            raise ClaudeAgentException(f"Failed to enhance prompt: {str(e)}") from e

    async def generate_title(self, prompt: str, user: User) -> str | None:
        # Ask Sonnet to produce a short chat title from the first user message.
        user_settings = await UserService(
            session_factory=self.session_factory
        ).get_user_settings(user.id)

        model_id = "claude-sonnet-4-6"
        env, _, actual_model_id = self._build_auth_env(model_id, user_settings)

        options = ClaudeAgentOptions(
            system_prompt=GENERATE_TITLE_SYSTEM_PROMPT,
            permission_mode="default",
            model=actual_model_id,
            max_turns=1,
            env=env,
        )

        try:
            title = ""
            async with ClaudeSDKClient(options=options) as client:
                await client.query(GENERATE_TITLE_USER_TEMPLATE.format(message=prompt))
                async for message in client.receive_response():
                    if isinstance(message, ResultMessage) and message.result:
                        title = message.result

            title = title.strip().strip('"').strip("'")
            return title or None
        except ClaudeSDKError:
            logger.debug("Title generation SDK call failed for user %s", user.id)
            return None

    @staticmethod
    def _build_permission_server(
        permission_mode: str, chat_id: str, sandbox_provider: str = "docker"
    ) -> dict[str, Any]:
        # Build the MCP server config for the permission prompt sidecar
        # (backend/permission_server.py) that intercepts Claude's tool calls
        # and routes them to our API for approval.
        # CHAT_TOKEN is a short-lived JWT scoped to this chat_id — the permission
        # server sends it back to our API on each tool approval request so the API
        # can verify the request belongs to this chat without exposing user credentials.
        # CHAT_ID tells the permission server which chat the approval belongs to.
        chat_token = create_chat_scoped_token(chat_id)

        if sandbox_provider == SandboxProviderType.HOST.value:
            # Host mode: run the script from the backend repo using the current Python
            permission_server_command = sys.executable
            permission_server_script = str(
                Path(__file__).resolve().parents[2] / "permission_server.py"
            )
            api_base_url = settings.HOST_PERMISSION_API_URL.rstrip("/")
        else:
            # Docker mode: the script is baked into the sandbox image
            permission_server_command = "python3"
            permission_server_script = "/usr/local/bin/permission_server.py"
            api_base_url = settings.DOCKER_PERMISSION_API_URL.rstrip("/")

        return {
            "command": permission_server_command,
            "args": ["-u", permission_server_script],
            "env": {
                "PYTHONUNBUFFERED": "1",
                "PERMISSION_MODE": permission_mode,
                "API_BASE_URL": api_base_url,
                "CHAT_TOKEN": chat_token,
                "CHAT_ID": chat_id,
            },
        }

    async def _get_mcp_servers(
        self,
        user_settings: UserSettings,
        permission_mode: str,
        chat_id: str,
        sandbox_provider: str,
    ) -> dict[str, Any]:
        # Assemble the MCP servers dict passed to the SDK: the permission
        # server is always included, plus any user-configured MCPs.
        servers: dict[str, Any] = {}
        servers["permission"] = self._build_permission_server(
            permission_mode, chat_id, sandbox_provider
        )

        for mcp in user_settings.custom_mcps or []:
            if not mcp.get("enabled", True):
                continue
            mcp_name = mcp.get("name")
            command_type = mcp.get("command_type")
            if not mcp_name or not command_type:
                continue
            try:
                servers[mcp_name] = self._build_mcp_config(mcp, command_type)
            except ClaudeAgentException:
                logger.error("Failed to configure MCP '%s'", mcp_name, exc_info=True)

        return servers

    @staticmethod
    def _build_mcp_config(mcp: dict[str, Any], command_type: str) -> dict[str, Any]:
        # Turn a user-defined MCP entry into the SDK server config format.
        # HTTP MCPs become {type, url, headers}, command MCPs become
        # {command, args, env}.
        type_config = MCP_TYPE_CONFIGS.get(command_type)
        if not type_config:
            raise ClaudeAgentException(f"Unknown MCP command type: {command_type}")

        mcp_name = mcp.get("name", "unknown")
        required_field = type_config["required_field"]

        if not mcp.get(required_field):
            raise ClaudeAgentException(
                f"{command_type.upper()} MCP '{mcp_name}' requires '{required_field}' field"
            )

        if type_config.get("is_http"):
            config: dict[str, Any] = {
                "type": type_config["type"],
                "url": mcp[required_field],
            }
            # For HTTP MCPs, env_vars are sent as HTTP headers (e.g. auth tokens)
            if mcp.get("env_vars"):
                config["headers"] = mcp["env_vars"]
        else:
            args = list(type_config["args_prefix"]) + [mcp[required_field]]
            if mcp.get("args"):
                args.extend(mcp["args"])
            config = {
                "command": type_config["command"],
                "args": args,
            }
            # For command MCPs, env_vars are passed as process environment variables
            if mcp.get("env_vars"):
                config["env"] = mcp["env_vars"]

        return config

    async def _build_claude_options(
        self,
        *,
        user_settings: UserSettings,
        system_prompt: str,
        permission_mode: str,
        model_id: str,
        session_id: str | None,
        thinking_mode: str | None,
        worktree: bool = False,
        chat_id: str,
        selected_persona_name: str = DEFAULT_PERSONA_NAME,
        cwd: str = SANDBOX_HOME_DIR,
        sandbox_provider: str = "docker",
    ) -> ClaudeAgentOptions:
        # Assemble the full ClaudeAgentOptions passed to the SDK client,
        # combining auth, env vars, MCP servers, and prompt configuration.
        env, provider_type, actual_model_id = self._build_auth_env(
            model_id, user_settings
        )

        # Set up git credentials inside the sandbox — GIT_ASKPASS points to a
        # helper script that echoes the PAT so git never prompts interactively.
        if user_settings.github_personal_access_token:
            env["GITHUB_TOKEN"] = user_settings.github_personal_access_token
            env["GIT_ASKPASS"] = SANDBOX_GIT_ASKPASS_PATH
        if settings.GIT_AUTHOR_NAME and settings.GIT_AUTHOR_EMAIL:
            env["GIT_AUTHOR_NAME"] = settings.GIT_AUTHOR_NAME
            env["GIT_AUTHOR_EMAIL"] = settings.GIT_AUTHOR_EMAIL
            env["GIT_COMMITTER_NAME"] = settings.GIT_AUTHOR_NAME
            env["GIT_COMMITTER_EMAIL"] = settings.GIT_AUTHOR_EMAIL

        if user_settings.custom_env_vars:
            for env_var in user_settings.custom_env_vars:
                env[env_var["key"]] = env_var["value"]

        # WebSearch is an Anthropic-only tool — non-Anthropic providers don't support it
        disallowed_tools: list[str] = []
        if provider_type != ProviderType.ANTHROPIC.value:
            disallowed_tools.append("WebSearch")

        sdk_permission_mode = SDK_PERMISSION_MODE_MAP.get(
            permission_mode, "acceptEdits"
        )

        # Personas override the system prompt entirely; otherwise use the SDK's
        # built-in claude_code preset and append our system prompt to it.
        system_prompt_config: str | dict[str, str]
        if selected_persona_name != DEFAULT_PERSONA_NAME:
            system_prompt_config = system_prompt
        else:
            system_prompt_config = {
                "type": "preset",
                "preset": "claude_code",
                "append": system_prompt,
            }

        options = ClaudeAgentOptions(
            system_prompt=system_prompt_config,
            permission_mode=sdk_permission_mode,
            model=actual_model_id,
            disallowed_tools=disallowed_tools,
            mcp_servers=await self._get_mcp_servers(
                user_settings,
                permission_mode,
                chat_id,
                sandbox_provider,
            ),
            cwd=cwd,
            # OS user inside the sandbox container
            user="user",
            resume=session_id,
            env=env,
            # Load .claude config from local dir, user home, and project root
            setting_sources=["local", "user", "project"],
            # Route permission prompts through our MCP permission server
            permission_prompt_tool_name="mcp__permission__approval_prompt",
            include_partial_messages=True,
            max_thinking_tokens=THINKING_MODE_TOKENS.get(thinking_mode or "") or 0,
            worktree=worktree,
            # Log Claude CLI stderr so crashes are visible in API logs
            stderr=lambda line: logger.warning("claude stderr: %s", line.rstrip()),
        )
        return options

    @staticmethod
    def prepare_user_prompt(
        prompt: str,
        custom_instructions: str | None,
        attachments: list[dict[str, Any]] | None = None,
        attachment_base_dir: str = SANDBOX_HOME_DIR,
    ) -> str:
        # Wrap the raw user prompt with XML-tagged context (instructions,
        # attachments) so the SDK can distinguish each section.

        # Slash commands (e.g. /compact, /review) are SDK builtins —
        # pass them through unmodified so the SDK handles them directly.
        if any(prompt.startswith(cmd) for cmd in ALLOWED_SLASH_COMMANDS):
            return prompt

        parts = []

        if custom_instructions and custom_instructions.strip():
            parts.append(
                f"<user_instructions>\n{custom_instructions.strip()}\n</user_instructions>\n\n"
            )

        if attachments:
            # Uploaded files are copied to the sandbox home dir with their
            # UUID-based filename — reference the correct base path so Claude
            # can find them (host mode uses the real workspace path, Docker
            # uses /home/user).
            files_list = "\n".join(
                f"- {attachment_base_dir}/{attachment['file_path'].split('/')[-1]}"
                for attachment in attachments
            )
            parts.append(
                f"<user_attachments>\nUser uploaded the following files\n{files_list}\n</user_attachments>\n\n"
            )

        parts.append(f"<user_prompt>{prompt}</user_prompt>")
        return "".join(parts)

    @staticmethod
    async def _create_prompt_iterable(
        prompt_message: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        # client.query() expects an async iterable of messages.
        yield prompt_message
