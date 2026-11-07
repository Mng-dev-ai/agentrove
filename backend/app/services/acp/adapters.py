from __future__ import annotations

import json
from dataclasses import dataclass, field
from collections.abc import Iterable
from typing import Any

from app.constants import MODELS
from app.models.types import AgentKind, PermissionMode
from app.services.exceptions import AgentException


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

FULL_ACCESS_SESSION_MODES: dict[AgentKind, frozenset[PermissionMode]] = {
    AgentKind.ANTIGRAVITY: frozenset({"yolo"}),
    AgentKind.CLAUDE: frozenset({"bypassPermissions"}),
    AgentKind.CODEX: frozenset({"full-access"}),
    AgentKind.COPILOT: frozenset(),
    AgentKind.CURSOR: frozenset(),
    AgentKind.GROK: frozenset({"always-approve"}),
    AgentKind.OPENCODE: frozenset(),
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


THINKING_MODE_ORDER = (
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
)


def unsupported_effort_error(mode: str, supported: Iterable[str]) -> AgentException:
    levels = ", ".join(supported)
    if not levels:
        return AgentException(
            f"Effort `{mode}` isn't supported: this model has no effort setting."
        )
    return AgentException(
        f"Effort `{mode}` isn't supported by this model. Supported: {levels}."
    )


def resolve_thinking_mode(
    mode: str | None, valid_modes: frozenset[str], default: str = "medium"
) -> str:
    # An explicit tier is never substituted (it changes cost and latency);
    # only the agent default steps down when this model lacks it.
    if mode:
        if mode in valid_modes:
            return mode
        raise unsupported_effort_error(
            mode, sorted(valid_modes, key=THINKING_MODE_ORDER.index)
        )
    if default in valid_modes:
        return default
    default_index = THINKING_MODE_ORDER.index(default)
    for candidate in reversed(THINKING_MODE_ORDER[:default_index]):
        if candidate in valid_modes:
            return candidate
    return next(m for m in THINKING_MODE_ORDER if m in valid_modes)


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
    # True when the user picked the tier; an agent default is best-effort.
    effort_explicit: bool = False
    session_mode: str = "default"


class AgentAdapter:
    # Per-agent ACP differences (flags/env/meta/permissions) behind a uniform AcpSessionConfig.
    binary: str
    cli_args: tuple[str, ...] = ()
    # Registry keys are namespaced ("copilot:gpt-5.5"); the CLI wants the bare id.
    model_id_namespace = ""
    # Persisted settings may carry a mode string from a previously selected
    # agent; anything outside `session_modes` maps to `fallback_session_mode`.
    session_modes: frozenset[str] = frozenset()
    fallback_session_mode = "default"
    default_thinking_mode = "medium"
    # Session config option that takes the reasoning effort, for agents that
    # expose one; None = effort is delivered another way (or not at all).
    effort_config_id: str | None = None
    # Value that resets effort when the user picks none; resumed sessions
    # otherwise keep the last tier. None = nothing to send.
    unset_effort_value: str | None = None

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        return LaunchConfig(binary=self.binary, cli_args=list(self.cli_args))

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        effort = self.reasoning_effort(model_id, thinking_mode)
        return SessionConfig(
            meta=self.build_session_meta(system_prompt, system_prompt_is_full_replace),
            env_overrides=self.build_session_env(model_id),
            reasoning_effort=effort,
            effort_explicit=self.effort_explicit(model_id, thinking_mode, effort),
            session_mode=self.map_session_mode(permission_mode),
        )

    def effort_explicit(
        self, model_id: str, thinking_mode: str | None, effort: str | None
    ) -> bool:
        return effort is not None and bool(thinking_mode)

    def build_session_meta(
        self, system_prompt: str | None, system_prompt_is_full_replace: bool
    ) -> dict[str, Any]:
        return build_system_prompt_meta(system_prompt, system_prompt_is_full_replace)

    def build_session_env(self, model_id: str) -> dict[str, str]:
        return {}

    def valid_thinking_modes(self, model_id: str) -> frozenset[str]:
        # Accepted thinking tiers; empty = no effort dial (thinking_mode ignored).
        info = MODELS.get(model_id)
        return frozenset(info.effort_levels) if info else frozenset()

    def reasoning_effort(self, model_id: str, thinking_mode: str | None) -> str | None:
        modes = self.valid_thinking_modes(model_id)
        if not modes:
            return None
        return resolve_thinking_mode(thinking_mode, modes, self.default_thinking_mode)

    def map_session_mode(self, permission_mode: str) -> str:
        # UI permission mode → ACP session mode id (plan-mode transitions).
        if permission_mode in self.session_modes:
            return permission_mode
        return self.fallback_session_mode

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        return model_id.removeprefix(self.model_id_namespace)


class ClaudeAgentAdapter(AgentAdapter):
    session_modes = frozenset({"default", "acceptEdits", "plan", "bypassPermissions"})
    binary = "claude-agent-acp"
    effort_config_id = "effort"

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
            binary=self.binary, env={"CLAUDE_CODE_EXECUTABLE": "claude"}
        )

    def build_session_meta(
        self, system_prompt: str | None, system_prompt_is_full_replace: bool
    ) -> dict[str, Any]:
        meta = build_system_prompt_meta(system_prompt, system_prompt_is_full_replace)
        # Effort controls depth; visible thinking requires the SDK display option.
        meta["claudeCode"] = {
            "options": {"thinking": {"type": "adaptive", "display": "summarized"}}
        }
        return meta

    def build_session_env(self, model_id: str) -> dict[str, str]:
        return {"ANTHROPIC_MODEL": model_id}

    def map_session_mode(self, permission_mode: str) -> str:
        return permission_mode


class CodexAgentAdapter(AgentAdapter):
    binary = "codex-acp"
    # UI permission mode → codex-acp session mode (each bundles approval + sandbox policy).
    SESSION_MODE_IDS = {
        "auto": "agent",
        "read-only": "read-only",
        "full-access": "agent-full-access",
    }
    session_modes = frozenset(SESSION_MODE_IDS)

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
        return LaunchConfig(binary=self.binary, env=env)

    def build_session_meta(
        self, system_prompt: str | None, system_prompt_is_full_replace: bool
    ) -> dict[str, Any]:
        return {}

    def map_session_mode(self, permission_mode: str) -> str:
        # Invalid modes indicate a caller bug; fail here so the session
        # doesn't silently start with broader or different permissions.
        if permission_mode not in self.SESSION_MODE_IDS:
            raise ValueError("Invalid Codex session mode: " + permission_mode)
        return self.SESSION_MODE_IDS[permission_mode]

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        # codex-acp encodes reasoning effort inside the model ID and rejects
        # bare IDs ("modelId[effort]" is the required format).
        if reasoning_effort:
            return f"{model_id}[{reasoning_effort}]"
        return model_id


class CopilotCliAdapter(AgentAdapter):
    # Copilot modes/reasoning differ from Claude — only send advertised values.
    binary = "copilot"
    cli_args = ("--acp", "--stdio")
    model_id_namespace = "copilot:"
    session_modes = frozenset({"agent", "plan", "autopilot"})
    fallback_session_mode = "agent"
    default_thinking_mode = "high"
    effort_config_id = "reasoning_effort"
    SESSION_MODE_BASE_URL = "https://agentclientprotocol.com/protocol/session-modes"

    def map_session_mode(self, permission_mode: str) -> str:
        return (
            f"{self.SESSION_MODE_BASE_URL}#{super().map_session_mode(permission_mode)}"
        )


class CursorAgentAdapter(AgentAdapter):
    # Cursor bakes effort into the model ID (`-low`/`-high`/…); no separate thinking flag.
    binary = "cursor-agent"
    cli_args = ("acp",)
    model_id_namespace = "cursor:"
    # Cursor CLI exposes three ACP session modes (see https://cursor.com/docs/cli/acp).
    session_modes = frozenset({"agent", "plan", "ask"})
    fallback_session_mode = "agent"


class GrokAgentAdapter(AgentAdapter):
    # Effort and permission mode are launch-baked; changes respawn via fingerprint.
    binary = "grok"
    model_id_namespace = "grok:"
    # Current stable Grok advertises no ACP session modes and silently ignores
    # set_mode ids. `always-approve` uses the launch flag; `auto` keeps the CLI's
    # default classifier behavior (routine calls pass, risky ones prompt); `plan`
    # stays for the set_mode plan-hop and revives if ACP modes return. The legacy
    # `code` mode never prompted, so it falls back to always-approve.
    session_modes = frozenset({"auto", "always-approve", "plan"})
    fallback_session_mode = "always-approve"

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
        return LaunchConfig(binary=self.binary, cli_args=cli_args)

    def build_session_meta(
        self, system_prompt: str | None, system_prompt_is_full_replace: bool
    ) -> dict[str, Any]:
        # Grok's session/new _meta supports systemPromptOverride (full
        # replacement) and rules (appended to the default prompt).
        if not system_prompt:
            return {}
        if system_prompt_is_full_replace:
            return {"systemPromptOverride": system_prompt}
        return {"rules": system_prompt}


class AntigravityAgentAdapter(AgentAdapter):
    binary = "agy-acp-server"
    model_id_namespace = "antigravity:"
    session_modes = frozenset({"default", "auto_edit", "yolo"})
    fallback_session_mode = "yolo"
    default_thinking_mode = "high"
    # OAuth-path server IDs; API-key auth advertises different unsupported IDs.
    OAUTH_MODEL_IDS = {
        ("gemini-3.5-flash", "high"): "gemini-3-flash-agent",
        ("gemini-3.5-flash", "medium"): "gemini-3.5-flash-low",
        ("gemini-3.5-flash", "low"): "gemini-3.5-flash-extra-low",
        ("gemini-3.1-pro", "high"): "gemini-pro-agent",
        ("gemini-3.1-pro", "low"): "gemini-3.1-pro-low",
    }

    def reasoning_effort(self, model_id: str, thinking_mode: str | None) -> str:
        # Every Antigravity model has tiers, and its model IDs encode one.
        return resolve_thinking_mode(
            thinking_mode,
            self.valid_thinking_modes(model_id),
            self.default_thinking_mode,
        )

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        effort = self.reasoning_effort(model_id, reasoning_effort)
        server_model_id = model_id.removeprefix(self.model_id_namespace)
        return self.OAUTH_MODEL_IDS.get(
            (server_model_id, effort), f"{server_model_id}-{effort}"
        )

    def build_session_meta(
        self, system_prompt: str | None, system_prompt_is_full_replace: bool
    ) -> dict[str, Any]:
        # Antigravity only supports appending, under _meta.antigravity.
        if not system_prompt:
            return {}
        return {"antigravity": {"systemPrompt": {"append": system_prompt}}}


class OpencodeAgentAdapter(AgentAdapter):
    # Primary agents map to session modes; effort is a per-model ACP config option.
    binary = "opencode"
    cli_args = ("acp",)
    model_id_namespace = "opencode:"
    # OpenCode's built-in primary agents double as ACP session modes; `plan`
    # (built-in) restricts edits to `~/.opencode/plan/*`, `build` has full access.
    # Unknown modes fall back to plan so switching agents never silently widens
    # permissions — e.g. a chat left in Codex's read-only mode shouldn't become
    # opencode full-access just because the string doesn't map.
    session_modes = frozenset({"build", "plan"})
    fallback_session_mode = "plan"
    effort_config_id = "effort"
    unset_effort_value = "default"
    # OpenCode 2 allows external directories by default; restore v1's ask
    # (host-mode sessions share the real HOME). Built-in plan writes here.
    BASE_CONFIG: dict[str, Any] = {
        "permission": {
            "external_directory": {"*": "ask", "~/.opencode/plan/*": "allow"}
        }
    }

    def build_session_env(self, model_id: str) -> dict[str, str]:
        return {"OPENCODE_CONFIG_CONTENT": json.dumps(self.BASE_CONFIG)}

    def reasoning_effort(self, model_id: str, thinking_mode: str | None) -> str | None:
        # Unlike other agents, an unset level (or the selector's "default")
        # sends nothing so OpenCode keeps the provider's own default.
        modes = self.valid_thinking_modes(model_id)
        if thinking_mode in (None, "", "default") or not modes:
            return None
        return resolve_thinking_mode(thinking_mode, modes)

    def effort_explicit(
        self, model_id: str, thinking_mode: str | None, effort: str | None
    ) -> bool:
        # Picking "Default" resets a resumed session's tier, so its failure
        # must stop the turn like any other explicit choice.
        return bool(thinking_mode) and bool(self.valid_thinking_modes(model_id))

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        reasoning_effort: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        env = (
            {
                "OPENCODE_CONFIG_CONTENT": json.dumps(
                    {**self.BASE_CONFIG, "instructions": [instructions_file_path]}
                )
            }
            if instructions_file_path
            else {}
        )
        return LaunchConfig(binary=self.binary, cli_args=list(self.cli_args), env=env)

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        if not (system_prompt and system_prompt_is_full_replace):
            return super().build_session_config(
                system_prompt=system_prompt,
                system_prompt_is_full_replace=system_prompt_is_full_replace,
                model_id=model_id,
                thinking_mode=thinking_mode,
                permission_mode=permission_mode,
            )
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
                **self.BASE_CONFIG,
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
        effort = self.reasoning_effort(model_id, thinking_mode)
        return SessionConfig(
            env_overrides={"OPENCODE_CONFIG_CONTENT": config_content},
            reasoning_effort=effort,
            effort_explicit=self.effort_explicit(model_id, thinking_mode, effort),
            session_mode=agent_name,
        )

    def build_session_meta(
        self, system_prompt: str | None, system_prompt_is_full_replace: bool
    ) -> dict[str, Any]:
        return {}


AGENT_ADAPTERS: dict[AgentKind, AgentAdapter] = {
    AgentKind.ANTIGRAVITY: AntigravityAgentAdapter(),
    AgentKind.CLAUDE: ClaudeAgentAdapter(),
    AgentKind.CODEX: CodexAgentAdapter(),
    AgentKind.COPILOT: CopilotCliAdapter(),
    AgentKind.CURSOR: CursorAgentAdapter(),
    AgentKind.GROK: GrokAgentAdapter(),
    AgentKind.OPENCODE: OpencodeAgentAdapter(),
}
