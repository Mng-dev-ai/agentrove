from __future__ import annotations

import json
from abc import ABC, abstractmethod
from enum import Enum
from dataclasses import dataclass, field
from typing import Any

from app.models.types import PermissionMode


class AgentKind(str, Enum):
    CLAUDE = "claude"
    CODEX = "codex"
    COPILOT = "copilot"
    CURSOR = "cursor"
    OPENCODE = "opencode"


# File types each agent can consume inline in the ACP prompt (base64-embedded as
# ImageContentBlock/EmbeddedResourceContentBlock). For these, the agent never
# reads from the sandbox path, so a sandbox-side copy of the upload is dead data.
# Copilot advertises ACP `embeddedContext: true` but routes to multiple backend
# models (Claude, GPT, etc.) — PDF parsing depends on the runtime model, so we
# stay conservative and only declare image as guaranteed-inline for Copilot.
NATIVE_FILE_TYPES: dict[AgentKind, frozenset[str]] = {
    AgentKind.CLAUDE: frozenset({"image", "pdf"}),
    AgentKind.CODEX: frozenset({"image"}),
    AgentKind.COPILOT: frozenset({"image"}),
    AgentKind.CURSOR: frozenset({"image"}),
    AgentKind.OPENCODE: frozenset({"image"}),
}


# Maps UI permission modes to codex-acp session mode IDs. Each mode bundles
# an approval policy and sandbox policy inside the adapter: "agent" =
# on-request approvals + workspace write, "agent-full-access" = no approvals
# + full disk/network access.
CODEX_SESSION_MODES: dict[str, str] = {
    "auto": "agent",
    "read-only": "read-only",
    "full-access": "agent-full-access",
}
COPILOT_SESSION_MODES = frozenset({"agent", "plan", "autopilot"})
COPILOT_SESSION_MODE_BASE_URL = "https://agentclientprotocol.com/protocol/session-modes"
COPILOT_SESSION_MODE_IDS: dict[str, str] = {
    mode: f"{COPILOT_SESSION_MODE_BASE_URL}#{mode}" for mode in COPILOT_SESSION_MODES
}

CLAUDE_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "max"})
CLAUDE_XHIGH_VALID_THINKING_MODES = CLAUDE_VALID_THINKING_MODES | {"xhigh"}
CLAUDE_XHIGH_MODEL_IDS = frozenset({"opus", "claude-fable-5"})
CODEX_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "xhigh"})
CODEX_MAX_VALID_THINKING_MODES = CODEX_VALID_THINKING_MODES | {"max"}
CODEX_MAX_MODEL_IDS = frozenset({"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"})
# Per Codex's model registry, `ultra` (max reasoning + automatic task
# delegation) is supported by Sol/Terra but not Luna.
CODEX_ULTRA_VALID_THINKING_MODES = CODEX_MAX_VALID_THINKING_MODES | {"ultra"}
CODEX_ULTRA_MODEL_IDS = frozenset({"gpt-5.6-sol", "gpt-5.6-terra"})
COPILOT_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "xhigh"})

# Cursor CLI exposes three ACP session modes (see https://cursor.com/docs/cli/acp).
CURSOR_SESSION_MODES = frozenset({"agent", "plan", "ask"})

# OpenCode's built-in primary agents double as ACP session modes; `plan`
# restricts edits to `.opencode/plans/*.md`, `build` has full tool access.
OPENCODE_SESSION_MODES = frozenset({"build", "plan"})

# Each agent's normal (full-execution) session mode. Used for permission-
# irrelevant background calls — one-shot text generation makes no tool calls, so
# we just need a mode the adapter accepts (Codex rejects unknown modes) and that
# isn't a plan/read-only mode that could distort the response.
NORMAL_SESSION_MODE: dict[AgentKind, PermissionMode] = {
    AgentKind.CLAUDE: "default",
    AgentKind.CODEX: "auto",
    AgentKind.COPILOT: "agent",
    AgentKind.CURSOR: "agent",
    AgentKind.OPENCODE: "build",
}

# Agents that can have their base system prompt replaced by a persona.
# Claude/Codex expose a first-class mechanism (ACP _meta.systemPrompt for
# Claude; model_instructions_file via CODEX_CONFIG for Codex). OpenCode uses a custom
# primary agent injected through OPENCODE_CONFIG_CONTENT. Cursor and Copilot
# ignore system prompt replacement over ACP, so personas would have no effect.
PERSONAS_SUPPORTED_AGENTS: frozenset[AgentKind] = frozenset(
    {AgentKind.CLAUDE, AgentKind.CODEX, AgentKind.OPENCODE}
)


def coerce_thinking_mode(mode: str | None, valid_modes: frozenset[str]) -> str:
    # Normalises the UI's named thinking tier to one the agent actually accepts,
    # falling back to "medium" for None or unrecognised values.
    return mode if mode in valid_modes else "medium"


def build_system_prompt_meta(
    system_prompt: str | None, is_full_replace: bool
) -> dict[str, Any]:
    # Builds the _meta systemPrompt payload shared by Claude and Copilot:
    # a plain string replaces the default prompt; {"append": ...} appends to it.
    if not system_prompt:
        return {}
    if is_full_replace:
        return {"systemPrompt": system_prompt}
    return {"systemPrompt": {"append": system_prompt}}


@dataclass(frozen=True)
class PermissionConfig:
    # ACP session mode ID sent via set_session_mode() after session creation.
    session_mode: str


@dataclass(frozen=True)
class LaunchConfig:
    # Everything needed to spawn the agent process: the binary to exec,
    # CLI flags to pass, and launch-only env vars (e.g. Codex's CODEX_CONFIG).
    binary: str
    cli_args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SessionConfig:
    # Everything needed to configure the ACP session: env overrides to
    # inject before spawning, metadata for new_session/load_session,
    # mapped reasoning effort, and the permission model.
    meta: dict[str, Any] = field(default_factory=dict)
    env_overrides: dict[str, str] = field(default_factory=dict)
    reasoning_effort: str | None = None
    permission: PermissionConfig = field(
        default_factory=lambda: PermissionConfig(session_mode="default")
    )


class AgentAdapter(ABC):
    # Each agent binary (claude-agent-acp, codex-acp) speaks ACP over stdio but
    # differs in CLI flags, env vars, session metadata, and permission models.
    # Adapters encapsulate those differences so the rest of the codebase works
    # with a uniform AcpSessionConfig regardless of which agent is running.

    def __init__(self, kind: AgentKind) -> None:
        self.kind = kind

    @abstractmethod
    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
    ) -> LaunchConfig:
        raise NotImplementedError

    @abstractmethod
    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        raise NotImplementedError

    @abstractmethod
    def map_session_mode(self, permission_mode: str) -> str:
        # Maps a UI permission mode string to the ACP session mode ID.
        # Used mid-stream for plan-mode transitions where only the mode
        # string is needed, not the full SessionConfig.
        raise NotImplementedError

    def map_model_id(self, model_id: str) -> str:
        # Translates the internal model registry key (e.g., "copilot:claude-sonnet-4.6")
        # to the model ID the ACP agent expects. Default: passthrough.
        return model_id


class ClaudeAgentAdapter(AgentAdapter):
    def __init__(self) -> None:
        super().__init__(kind=AgentKind.CLAUDE)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
    ) -> LaunchConfig:
        # Claude doesn't use CLI args — all config is via env vars and session meta.
        return LaunchConfig(binary="claude-agent-acp")

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        meta = build_system_prompt_meta(system_prompt, system_prompt_is_full_replace)
        # Effort controls depth; visible thinking requires the SDK display option.
        meta["claudeCode"] = {
            "options": {"thinking": {"type": "adaptive", "display": "summarized"}}
        }

        # Claude exposes thinking budget as the "effort" session config option,
        # applied post-handshake via set_config_option; the UI's named tiers
        # are passed through directly as effort level IDs. `xhigh` is only
        # valid for selected Claude models, so others keep the narrower tier set.
        valid_modes = (
            CLAUDE_XHIGH_VALID_THINKING_MODES
            if model_id in CLAUDE_XHIGH_MODEL_IDS
            else CLAUDE_VALID_THINKING_MODES
        )
        reasoning_effort = coerce_thinking_mode(thinking_mode, valid_modes)

        return SessionConfig(
            meta=meta,
            env_overrides={"ANTHROPIC_MODEL": model_id},
            reasoning_effort=reasoning_effort,
            permission=PermissionConfig(session_mode=permission_mode),
        )

    def map_session_mode(self, permission_mode: str) -> str:
        # Claude session modes are a direct passthrough from the UI.
        return permission_mode


class CodexAgentAdapter(AgentAdapter):
    def __init__(self) -> None:
        super().__init__(kind=AgentKind.CODEX)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
    ) -> LaunchConfig:
        # codex-acp ignores CLI args entirely — customization goes through the
        # CODEX_CONFIG env var, a JSON object merged into the Codex session
        # config. Approval/sandbox policy and reasoning effort no longer belong
        # here: modes bundle approval+sandbox, and effort rides on the model ID.
        config: dict[str, Any] = {}
        if system_prompt:
            if system_prompt_is_full_replace and instructions_file_path:
                # Codex ignores base_instructions for replacing the full system
                # prompt, so the caller writes the prompt to a file we point
                # Codex at via model_instructions_file, and we disable the
                # default personality so the file is the sole instruction set.
                config["features"] = {"personality": False}
                config["personality"] = "none"
                config["model_instructions_file"] = instructions_file_path
            else:
                config["developer_instructions"] = system_prompt
        env = {"CODEX_CONFIG": json.dumps(config)} if config else {}
        return LaunchConfig(binary="codex-acp", env=env)

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        # GPT-5.6 adds `max` (and `ultra` on Sol/Terra); older Codex models
        # keep the narrower tier set.
        if model_id in CODEX_ULTRA_MODEL_IDS:
            valid_modes = CODEX_ULTRA_VALID_THINKING_MODES
        elif model_id in CODEX_MAX_MODEL_IDS:
            valid_modes = CODEX_MAX_VALID_THINKING_MODES
        else:
            valid_modes = CODEX_VALID_THINKING_MODES
        reasoning_effort = coerce_thinking_mode(thinking_mode, valid_modes)

        # Codex config rides on the CODEX_CONFIG launch env var and the model
        # ID, not session meta.
        return SessionConfig(
            reasoning_effort=reasoning_effort,
            permission=PermissionConfig(
                session_mode=self.map_session_mode(permission_mode)
            ),
        )

    def map_session_mode(self, permission_mode: str) -> str:
        # Invalid modes indicate a caller bug; fail here so the session
        # doesn't silently start with broader or different permissions.
        if permission_mode not in CODEX_SESSION_MODES:
            raise ValueError("Invalid Codex session mode: " + permission_mode)
        return CODEX_SESSION_MODES[permission_mode]


class CopilotCliAdapter(AgentAdapter):
    # Copilot CLI reuses the same ACP transport, but its ACP session modes and
    # reasoning controls differ from Claude. Keep that mapping explicit here so
    # we only send values the Copilot ACP server actually advertises.

    def __init__(self) -> None:
        super().__init__(kind=AgentKind.COPILOT)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
    ) -> LaunchConfig:
        return LaunchConfig(binary="copilot", cli_args=["--acp", "--stdio"])

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        meta = build_system_prompt_meta(system_prompt, system_prompt_is_full_replace)

        # Copilot ACP exposes reasoning effort as a CLI/ACP value directly.
        reasoning_effort = coerce_thinking_mode(
            thinking_mode, COPILOT_VALID_THINKING_MODES
        )

        return SessionConfig(
            meta=meta,
            reasoning_effort=reasoning_effort,
            permission=PermissionConfig(
                session_mode=self.map_session_mode(permission_mode)
            ),
        )

    def map_session_mode(self, permission_mode: str) -> str:
        # Existing chats may still carry Claude/Codex mode strings in persisted
        # settings. Default those to Copilot's normal agent mode so agent
        # switches do not fail.
        if permission_mode not in COPILOT_SESSION_MODES:
            return COPILOT_SESSION_MODE_IDS["agent"]
        return COPILOT_SESSION_MODE_IDS[permission_mode]

    def map_model_id(self, model_id: str) -> str:
        # Internal keys use "copilot:" prefix to namespace; the CLI expects
        # the raw model name (e.g., "claude-sonnet-4.6" not "copilot:claude-sonnet-4.6").
        return model_id.removeprefix("copilot:")


class CursorAgentAdapter(AgentAdapter):
    # Cursor CLI runs as an ACP server via `cursor-agent acp` and speaks the
    # same ACP transport as Claude/Codex/Copilot. Unlike the others, Cursor
    # bakes reasoning effort into the model ID itself (e.g. `-low`, `-high`,
    # `-thinking-max`), so there is no separate thinking-mode CLI flag or env
    # var — the UI's thinking selector is hidden for this adapter.

    def __init__(self) -> None:
        super().__init__(kind=AgentKind.CURSOR)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
    ) -> LaunchConfig:
        return LaunchConfig(binary="cursor-agent", cli_args=["acp"])

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        meta = build_system_prompt_meta(system_prompt, system_prompt_is_full_replace)
        return SessionConfig(
            meta=meta,
            permission=PermissionConfig(
                session_mode=self.map_session_mode(permission_mode)
            ),
        )

    def map_session_mode(self, permission_mode: str) -> str:
        # Persisted settings may still carry Claude/Codex/Copilot mode strings
        # from a previous agent. Default to Cursor's normal agent mode so
        # agent switches don't fail.
        if permission_mode not in CURSOR_SESSION_MODES:
            return "agent"
        return permission_mode

    def map_model_id(self, model_id: str) -> str:
        # Internal keys use the "cursor:" prefix to namespace models in the
        # shared registry; the CLI expects the raw Cursor model name.
        return model_id.removeprefix("cursor:")


class OpencodeAgentAdapter(AgentAdapter):
    # OpenCode CLI runs as an ACP server via `opencode acp` and speaks the same
    # ACP transport as the other adapters. OpenCode's "primary agents" (build,
    # plan) map to ACP session modes; reasoning effort is controlled per-model
    # by the underlying provider (opencode itself doesn't expose a uniform
    # reasoning dial via ACP), so there's no separate thinking-mode control —
    # the UI's thinking selector is hidden for this adapter.

    def __init__(self) -> None:
        super().__init__(kind=AgentKind.OPENCODE)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
    ) -> LaunchConfig:
        return LaunchConfig(binary="opencode", cli_args=["acp"])

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        if system_prompt and system_prompt_is_full_replace:
            # OpenCode ignores ACP _meta.systemPrompt, so inject the persona as
            # a custom primary agent via OPENCODE_CONFIG_CONTENT and select it
            # as the session mode.
            mode = self.map_session_mode(permission_mode)
            agent_name = f"agentrove-persona-{mode}"
            permission: dict[str, Any] = (
                {"question": "allow", "plan_enter": "allow"}
                if mode == "build"
                else {
                    "question": "allow",
                    "plan_exit": "allow",
                    "edit": {
                        "*": "deny",
                        ".opencode/plans/*.md": "allow",
                    },
                }
            )
            config_content = json.dumps(
                {
                    "agent": {
                        agent_name: {
                            "description": "Agentrove persona",
                            "mode": "primary",
                            "prompt": system_prompt,
                            "permission": permission,
                        }
                    },
                    "default_agent": agent_name,
                }
            )
            return SessionConfig(
                env_overrides={"OPENCODE_CONFIG_CONTENT": config_content},
                permission=PermissionConfig(session_mode=agent_name),
            )

        return SessionConfig(
            permission=PermissionConfig(
                session_mode=self.map_session_mode(permission_mode)
            ),
        )

    def map_session_mode(self, permission_mode: str) -> str:
        # Persisted settings may still carry mode strings from a different
        # previous agent. Default to the restrictive mode (plan) so switching
        # agents never silently widens permissions — e.g. a chat left in
        # Codex's read-only mode shouldn't become opencode full-access just
        # because the string doesn't map.
        if permission_mode not in OPENCODE_SESSION_MODES:
            return "plan"
        return permission_mode

    def map_model_id(self, model_id: str) -> str:
        # Internal keys use "opencode:" prefix to namespace; opencode expects
        # the raw provider/model ID (e.g. "openai/gpt-5.4" not
        # "opencode:openai/gpt-5.4").
        return model_id.removeprefix("opencode:")


AGENT_ADAPTERS: dict[AgentKind, AgentAdapter] = {
    AgentKind.CLAUDE: ClaudeAgentAdapter(),
    AgentKind.CODEX: CodexAgentAdapter(),
    AgentKind.COPILOT: CopilotCliAdapter(),
    AgentKind.CURSOR: CursorAgentAdapter(),
    AgentKind.OPENCODE: OpencodeAgentAdapter(),
}
