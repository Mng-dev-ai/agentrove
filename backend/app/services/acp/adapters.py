from __future__ import annotations

import json
from abc import ABC, abstractmethod
from enum import Enum
from dataclasses import dataclass, field
from typing import Any

from app.models.types import PermissionMode


class AgentKind(str, Enum):
    ANTIGRAVITY = "antigravity"
    CLAUDE = "claude"
    CODEX = "codex"
    COPILOT = "copilot"
    CURSOR = "cursor"
    GROK = "grok"
    OPENCODE = "opencode"


# File types each agent can consume inline in the ACP prompt (base64-embedded as
# ImageContentBlock/EmbeddedResourceContentBlock). For these, the agent never
# reads from the sandbox path, so a sandbox-side copy of the upload is dead data.
# Copilot advertises ACP `embeddedContext: true` but routes to multiple backend
# models (Claude, GPT, etc.) — PDF parsing depends on the runtime model, so we
# stay conservative and only declare image as guaranteed-inline for Copilot.
NATIVE_FILE_TYPES: dict[AgentKind, frozenset[str]] = {
    AgentKind.ANTIGRAVITY: frozenset({"image"}),
    AgentKind.CLAUDE: frozenset({"image", "pdf"}),
    AgentKind.CODEX: frozenset({"image"}),
    AgentKind.COPILOT: frozenset({"image"}),
    AgentKind.CURSOR: frozenset({"image"}),
    # Grok advertises ACP promptCapabilities image: false — attachments are
    # referenced via sandbox paths instead.
    AgentKind.GROK: frozenset(),
    AgentKind.OPENCODE: frozenset({"image"}),
}


# UI permission mode → codex-acp session mode (each bundles approval + sandbox policy).
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
CLAUDE_XHIGH_MODEL_IDS = frozenset(
    {"claude-fable-5-1", "claude-fable-5", "claude-opus-5"}
)
# claude-agent-acp only advertises the "effort" config option for models that
# report supportsEffort — Haiku doesn't, so set_config_option("effort") fails
# with "Unknown config option: effort". Empty set = no effort dial for these.
CLAUDE_NO_EFFORT_MODEL_IDS = frozenset({"haiku"})
CODEX_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "xhigh"})
CODEX_MAX_VALID_THINKING_MODES = CODEX_VALID_THINKING_MODES | {"max"}
CODEX_MAX_MODEL_IDS = frozenset({"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"})
# Per Codex's model registry, `ultra` (max reasoning + automatic task
# delegation) is supported by Sol/Terra but not Luna.
CODEX_ULTRA_VALID_THINKING_MODES = CODEX_MAX_VALID_THINKING_MODES | {"ultra"}
CODEX_ULTRA_MODEL_IDS = frozenset({"gpt-5.6-sol", "gpt-5.6-terra"})
COPILOT_MAX_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "xhigh", "max"})
COPILOT_MAX_MODEL_IDS = frozenset(
    {
        "copilot:claude-sonnet-5",
        "copilot:claude-fable-5",
        "copilot:claude-opus-5",
        "copilot:claude-opus-4.8",
        "copilot:claude-opus-4.8-fast",
        "copilot:claude-opus-4.7",
        "copilot:gpt-5.6-sol",
        "copilot:gpt-5.6-terra",
        "copilot:gpt-5.6-luna",
    }
)
COPILOT_NO_XHIGH_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "max"})
COPILOT_NO_XHIGH_MODEL_IDS = frozenset(
    {"copilot:claude-sonnet-4.6", "copilot:claude-opus-4.6"}
)
COPILOT_XHIGH_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "xhigh"})
COPILOT_XHIGH_MODEL_IDS = frozenset(
    {
        "copilot:gpt-5.5",
        "copilot:gpt-5.4",
        "copilot:gpt-5.4-mini",
        "copilot:gpt-5.3-codex",
    }
)
COPILOT_VALID_THINKING_MODES = frozenset({"low", "medium", "high"})
COPILOT_REASONING_MODEL_IDS = frozenset(
    {
        "copilot:gpt-5-mini",
        "copilot:mai-code-1-flash-picker",
        "copilot:gemini-3.8-flash",
        "copilot:gemini-3.6-flash",
        "copilot:gemini-3.5-flash",
        "copilot:gemini-3.1-pro-preview",
        "copilot:grok-4.5",
    }
)
COPILOT_KIMI_K3_VALID_THINKING_MODES = frozenset({"low", "high", "max"})

# Cursor CLI exposes three ACP session modes (see https://cursor.com/docs/cli/acp).
CURSOR_SESSION_MODES = frozenset({"agent", "plan", "ask"})

ANTIGRAVITY_SESSION_MODES = frozenset({"default", "auto_edit", "yolo"})
ANTIGRAVITY_VALID_THINKING_MODES = frozenset({"low", "medium", "high"})
ANTIGRAVITY_PRO_VALID_THINKING_MODES = frozenset({"low", "high"})
ANTIGRAVITY_PRO_MODEL_ID = "antigravity:gemini-3.1-pro"

# Current stable Grok advertises no ACP session modes and silently ignores
# set_mode ids. `always-approve` uses the launch flag; `auto` keeps the CLI's
# default classifier behavior (routine calls pass, risky ones prompt); `plan`
# stays for the set_mode plan-hop and revives if ACP modes return.
GROK_SESSION_MODES = frozenset({"auto", "always-approve", "plan"})
# Grok 4.5 exposes low/medium/high reasoning effort and Grok 4.6 adds xhigh;
# the effort launch flag is skipped for models outside these allowlists.
GROK_VALID_THINKING_MODES = frozenset({"low", "medium", "high"})
GROK_REASONING_MODEL_IDS = frozenset({"grok:grok-4.5", "grok:grok-4.6"})
GROK_XHIGH_VALID_THINKING_MODES = frozenset({"low", "medium", "high", "xhigh"})
GROK_XHIGH_MODEL_IDS = frozenset({"grok:grok-4.6"})

# OpenCode's built-in primary agents double as ACP session modes; `plan`
# restricts edits to `.opencode/plans/*.md`, `build` has full tool access.
OPENCODE_SESSION_MODES = frozenset({"build", "plan"})

# Full-execution mode per agent for unattended one-shots (Codex rejects unknown modes; avoid plan/read-only).
NORMAL_SESSION_MODE: dict[AgentKind, PermissionMode] = {
    AgentKind.ANTIGRAVITY: "yolo",
    AgentKind.CLAUDE: "default",
    AgentKind.CODEX: "auto",
    AgentKind.COPILOT: "agent",
    AgentKind.CURSOR: "agent",
    AgentKind.GROK: "always-approve",
    AgentKind.OPENCODE: "build",
}

# Agents that support persona system-prompt replacement over ACP (Cursor/Copilot ignore it).
PERSONAS_SUPPORTED_AGENTS: frozenset[AgentKind] = frozenset(
    {
        AgentKind.CLAUDE,
        AgentKind.CODEX,
        AgentKind.GROK,
        AgentKind.OPENCODE,
    }
)


THINKING_MODE_ORDER = ("low", "medium", "high", "xhigh", "max", "ultra")


def valid_thinking_modes(agent_kind: AgentKind, model_id: str) -> frozenset[str]:
    # Accepted thinking tiers; empty = no effort dial (thinking_mode ignored).
    if agent_kind is AgentKind.ANTIGRAVITY:
        return (
            ANTIGRAVITY_PRO_VALID_THINKING_MODES
            if model_id == ANTIGRAVITY_PRO_MODEL_ID
            else ANTIGRAVITY_VALID_THINKING_MODES
        )
    if agent_kind is AgentKind.CLAUDE:
        if model_id in CLAUDE_NO_EFFORT_MODEL_IDS:
            return frozenset()
        return (
            CLAUDE_XHIGH_VALID_THINKING_MODES
            if model_id in CLAUDE_XHIGH_MODEL_IDS
            else CLAUDE_VALID_THINKING_MODES
        )
    if agent_kind is AgentKind.CODEX:
        if model_id in CODEX_ULTRA_MODEL_IDS:
            return CODEX_ULTRA_VALID_THINKING_MODES
        if model_id in CODEX_MAX_MODEL_IDS:
            return CODEX_MAX_VALID_THINKING_MODES
        return CODEX_VALID_THINKING_MODES
    if agent_kind is AgentKind.COPILOT:
        if model_id in COPILOT_MAX_MODEL_IDS:
            return COPILOT_MAX_VALID_THINKING_MODES
        if model_id in COPILOT_NO_XHIGH_MODEL_IDS:
            return COPILOT_NO_XHIGH_VALID_THINKING_MODES
        if model_id in COPILOT_XHIGH_MODEL_IDS:
            return COPILOT_XHIGH_VALID_THINKING_MODES
        if model_id in COPILOT_REASONING_MODEL_IDS:
            return COPILOT_VALID_THINKING_MODES
        if model_id == "copilot:kimi-k3":
            return COPILOT_KIMI_K3_VALID_THINKING_MODES
        return frozenset()
    if agent_kind is AgentKind.GROK:
        if model_id in GROK_XHIGH_MODEL_IDS:
            return GROK_XHIGH_VALID_THINKING_MODES
        return (
            GROK_VALID_THINKING_MODES
            if model_id in GROK_REASONING_MODEL_IDS
            else frozenset()
        )
    return frozenset()


def coerce_thinking_mode(
    mode: str | None, valid_modes: frozenset[str], default: str = "medium"
) -> str:
    requested = mode or default
    if requested in valid_modes:
        return requested
    if requested in THINKING_MODE_ORDER:
        requested_index = THINKING_MODE_ORDER.index(requested)
        for candidate in reversed(THINKING_MODE_ORDER[:requested_index]):
            if candidate in valid_modes:
                return candidate
    return next((mode for mode in THINKING_MODE_ORDER if mode in valid_modes), default)


def build_system_prompt_meta(
    system_prompt: str | None, is_full_replace: bool
) -> dict[str, Any]:
    # For adapters using _meta.systemPrompt, str replaces and {"append": ...} appends.
    if not system_prompt:
        return {}
    if is_full_replace:
        return {"systemPrompt": system_prompt}
    return {"systemPrompt": {"append": system_prompt}}


@dataclass(frozen=True)
class PermissionConfig:
    session_mode: str


@dataclass(frozen=True)
class LaunchConfig:
    # Spawn recipe: binary, CLI flags, launch-only env (e.g. CODEX_CONFIG).
    binary: str
    cli_args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SessionConfig:
    # Session config: env overrides, session meta, effort, permission mode.
    meta: dict[str, Any] = field(default_factory=dict)
    env_overrides: dict[str, str] = field(default_factory=dict)
    reasoning_effort: str | None = None
    permission: PermissionConfig = field(
        default_factory=lambda: PermissionConfig(session_mode="default")
    )


class AgentAdapter(ABC):
    # Per-agent ACP differences (flags/env/meta/permissions) behind a uniform AcpSessionConfig.

    def __init__(self, kind: AgentKind) -> None:
        self.kind = kind

    @abstractmethod
    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
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
        # UI permission mode → ACP session mode id (plan-mode transitions).
        raise NotImplementedError

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        # Registry key → agent model id (default passthrough).
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
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        return LaunchConfig(
            binary="claude-agent-acp",
            env={"CLAUDE_CODE_EXECUTABLE": "claude"},
        )

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
        # are passed through directly as effort level IDs. Models without the
        # effort dial (Haiku) get None so that call is skipped entirely.
        claude_modes = valid_thinking_modes(AgentKind.CLAUDE, model_id)
        reasoning_effort = (
            coerce_thinking_mode(thinking_mode, claude_modes) if claude_modes else None
        )

        return SessionConfig(
            meta=meta,
            env_overrides={"ANTHROPIC_MODEL": model_id},
            reasoning_effort=reasoning_effort,
            permission=PermissionConfig(session_mode=permission_mode),
        )

    def map_session_mode(self, permission_mode: str) -> str:
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
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        # codex-acp uses CODEX_CONFIG only; modes bundle approval/sandbox, effort is on the model ID.
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
        reasoning_effort = coerce_thinking_mode(
            thinking_mode, valid_thinking_modes(AgentKind.CODEX, model_id)
        )

        # Config via CODEX_CONFIG + model ID, not session meta.
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
    # Copilot modes/reasoning differ from Claude — only send advertised values.

    def __init__(self) -> None:
        super().__init__(kind=AgentKind.COPILOT)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
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

        copilot_modes = valid_thinking_modes(AgentKind.COPILOT, model_id)
        reasoning_effort = (
            coerce_thinking_mode(thinking_mode, copilot_modes, default="high")
            if copilot_modes
            else None
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

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        # Strip "copilot:" namespace for the CLI.
        return model_id.removeprefix("copilot:")


class CursorAgentAdapter(AgentAdapter):
    # Cursor bakes effort into the model ID (`-low`/`-high`/…); no separate thinking flag.

    def __init__(self) -> None:
        super().__init__(kind=AgentKind.CURSOR)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
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

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        # Strip "cursor:" namespace for the CLI.
        return model_id.removeprefix("cursor:")


class GrokAgentAdapter(AgentAdapter):
    # Effort and permission mode are launch-baked; changes respawn via fingerprint.

    def __init__(self) -> None:
        super().__init__(kind=AgentKind.GROK)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        # Agent-level flags must precede the `stdio` subcommand.
        cli_args = ["agent"]
        if (
            permission_mode is not None
            and self.map_session_mode(permission_mode) == "always-approve"
        ):
            cli_args.append("--always-approve")
        if reasoning_effort:
            cli_args.extend(["--reasoning-effort", reasoning_effort])
        cli_args.append("stdio")
        return LaunchConfig(binary="grok", cli_args=cli_args)

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        # Grok's session/new _meta supports systemPromptOverride (full
        # replacement) and rules (appended to the default prompt).
        meta: dict[str, Any] = {}
        if system_prompt:
            if system_prompt_is_full_replace:
                meta["systemPromptOverride"] = system_prompt
            else:
                meta["rules"] = system_prompt

        grok_modes = valid_thinking_modes(AgentKind.GROK, model_id)
        reasoning_effort = (
            coerce_thinking_mode(thinking_mode, grok_modes) if grok_modes else None
        )

        return SessionConfig(
            meta=meta,
            reasoning_effort=reasoning_effort,
            permission=PermissionConfig(
                session_mode=self.map_session_mode(permission_mode)
            ),
        )

    def map_session_mode(self, permission_mode: str) -> str:
        # Persisted settings may carry mode strings from a different agent or
        # the legacy Grok `code` mode. Map those to always-approve — it matches
        # code mode's old behavior of never prompting.
        if permission_mode not in GROK_SESSION_MODES:
            return "always-approve"
        return permission_mode

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        # Strip "grok:" namespace for the CLI.
        return model_id.removeprefix("grok:")


class AntigravityAgentAdapter(AgentAdapter):
    def __init__(self) -> None:
        super().__init__(kind=AgentKind.ANTIGRAVITY)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        return LaunchConfig(binary="agy-acp-server")

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        reasoning_effort = (
            "high"
            if model_id == ANTIGRAVITY_PRO_MODEL_ID and thinking_mode == "medium"
            else coerce_thinking_mode(
                thinking_mode,
                valid_thinking_modes(AgentKind.ANTIGRAVITY, model_id),
                default="high",
            )
        )
        return SessionConfig(
            meta=build_system_prompt_meta(system_prompt, system_prompt_is_full_replace),
            reasoning_effort=reasoning_effort,
            permission=PermissionConfig(
                session_mode=self.map_session_mode(permission_mode)
            ),
        )

    def map_session_mode(self, permission_mode: str) -> str:
        if permission_mode not in ANTIGRAVITY_SESSION_MODES:
            return "yolo"
        return permission_mode

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        effort = reasoning_effort or "high"
        if model_id == ANTIGRAVITY_PRO_MODEL_ID and effort == "medium":
            effort = "high"
        server_model_id = model_id.removeprefix("antigravity:")
        # OAuth-path server IDs; API-key auth advertises different unsupported IDs.
        oauth_model_ids = {
            ("gemini-3.5-flash", "high"): "gemini-3-flash-agent",
            ("gemini-3.5-flash", "medium"): "gemini-3.5-flash-low",
            ("gemini-3.5-flash", "low"): "gemini-3.5-flash-extra-low",
            ("gemini-3.1-pro", "high"): "gemini-pro-agent",
            ("gemini-3.1-pro", "low"): "gemini-3.1-pro-low",
        }
        return oauth_model_ids.get(
            (server_model_id, effort), f"{server_model_id}-{effort}"
        )


class OpencodeAgentAdapter(AgentAdapter):
    # Primary agents map to session modes; no uniform ACP reasoning dial (thinking UI hidden).

    def __init__(self) -> None:
        super().__init__(kind=AgentKind.OPENCODE)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
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

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        # Strip "opencode:" namespace for the CLI.
        return model_id.removeprefix("opencode:")


AGENT_ADAPTERS: dict[AgentKind, AgentAdapter] = {
    AgentKind.ANTIGRAVITY: AntigravityAgentAdapter(),
    AgentKind.CLAUDE: ClaudeAgentAdapter(),
    AgentKind.CODEX: CodexAgentAdapter(),
    AgentKind.COPILOT: CopilotCliAdapter(),
    AgentKind.CURSOR: CursorAgentAdapter(),
    AgentKind.GROK: GrokAgentAdapter(),
    AgentKind.OPENCODE: OpencodeAgentAdapter(),
}
