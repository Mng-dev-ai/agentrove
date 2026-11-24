from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from collections.abc import Iterable
from typing import Any

from acp.schema import ToolCallProgress, ToolCallStart

from app.catalog import MODELS
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
    # ACP session/fork verified live against a settled session whose process is
    # still running, then loaded from a new process (claude-agent-acp 0.109.0,
    # codex-acp 2.8.0, OpenCode 2.3.2).
    supports_fork = False
    # Tool-input key holding the path of a `read` call whose image the runtime
    # attaches from disk; None = the agent's reads never need it.
    image_read_path_key: str | None = None
    forwards_plan = True
    tool_images_in_content = False
    # ACP extension method the agent delivers its question tool through.
    ask_user_question_method: str | None = None
    # Agents allowed to steer a running turn when they also advertise it.
    supports_steering = False
    # Session config option (select on/off) that toggles the fast service tier.
    fast_mode_config_id: str | None = None
    # True when the permission mode is baked into the launch command.
    respawns_on_mode_change = False

    @staticmethod
    def loads_agentrove_mcp(
        agent_kind: AgentKind, permission_mode: PermissionMode, *, channel_member: bool
    ) -> bool:
        return (
            not channel_member
            or permission_mode in FULL_ACCESS_SESSION_MODES[agent_kind]
        )

    @staticmethod
    def unsupported_effort_error(mode: str, supported: Iterable[str]) -> AgentException:
        levels = ", ".join(supported)
        if not levels:
            return AgentException(
                f"Effort `{mode}` isn't supported: this model has no effort setting."
            )
        return AgentException(
            f"Effort `{mode}` isn't supported by this model. Supported: {levels}."
        )

    @staticmethod
    def resolve_thinking_mode(
        mode: str | None, valid_modes: frozenset[str], default: str = "medium"
    ) -> str:
        # An explicit tier is never substituted (it changes cost and latency);
        # only the agent default steps down when this model lacks it.
        if mode:
            if mode in valid_modes:
                return mode
            raise AgentAdapter.unsupported_effort_error(
                mode, sorted(valid_modes, key=THINKING_MODE_ORDER.index)
            )
        if default in valid_modes:
            return default
        default_index = THINKING_MODE_ORDER.index(default)
        for candidate in reversed(THINKING_MODE_ORDER[:default_index]):
            if candidate in valid_modes:
                return candidate
        return next(m for m in THINKING_MODE_ORDER if m in valid_modes)

    @staticmethod
    def build_system_prompt_meta(
        system_prompt: str | None, is_full_replace: bool
    ) -> dict[str, Any]:
        # For adapters using _meta.systemPrompt, str replaces and {"append": ...} appends.
        if not system_prompt:
            return {}
        if is_full_replace:
            return {"systemPrompt": system_prompt}
        return {"systemPrompt": {"append": system_prompt}}

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
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
        return self.build_system_prompt_meta(
            system_prompt, system_prompt_is_full_replace
        )

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
        return self.resolve_thinking_mode(
            thinking_mode, modes, self.default_thinking_mode
        )

    def map_session_mode(self, permission_mode: str) -> str:
        # UI permission mode → ACP session mode id (plan-mode transitions).
        if permission_mode in self.session_modes:
            return permission_mode
        return self.fallback_session_mode

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        return model_id.removeprefix(self.model_id_namespace)

    def wire_mode_id(self, session_mode: str) -> str:
        return session_mode

    def needs_instructions_file(self, system_prompt_is_full_replace: bool) -> bool:
        # True when the system prompt reaches the agent as a file outside the
        # user's workspace.
        return False

    @staticmethod
    def parse_raw_input(raw_input: Any) -> dict[str, Any] | None:
        if not raw_input:
            return None
        if isinstance(raw_input, dict):
            return raw_input
        try:
            parsed = json.loads(str(raw_input))
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
        return {"raw": str(raw_input)}

    @staticmethod
    def content_texts(tc: ToolCallProgress) -> list[str]:
        if not tc.content:
            return []
        texts = []
        for block in tc.content:
            inner = getattr(block, "content", None)
            if inner and getattr(inner, "type", None) == "text":
                texts.append(inner.text)
        return texts

    @staticmethod
    def content_diffs(tc: ToolCallStart | ToolCallProgress) -> list[dict[str, Any]]:
        # Cursor and Codex emit `edit` tool results as ACP FileEditToolCallContent
        # blocks (type="diff") with path/oldText/newText, without raw_output —
        # Cursor on the terminal update, Codex on the initial tool_call.
        # Surface these so the frontend edit renderer can show the diff.
        if not tc.content:
            return []
        diffs: list[dict[str, Any]] = []
        for block in tc.content:
            if getattr(block, "type", None) != "diff":
                continue
            diffs.append(
                {
                    "path": getattr(block, "path", None),
                    "oldText": getattr(block, "old_text", None),
                    "newText": getattr(block, "new_text", None),
                }
            )
        return diffs

    @staticmethod
    def mcp_tool_call(
        server: Any, tool: Any, arguments: Any
    ) -> tuple[str, dict[str, Any]] | None:
        # Claude's `mcp__<server>__<tool>` name and bare arguments, so the
        # frontend's MCP renderers (agentrove tools, render_ui) apply to every
        # agent.
        if isinstance(server, str) and isinstance(tool, str):
            return (
                f"mcp__{server}__{tool}",
                arguments if isinstance(arguments, dict) else {},
            )
        return None

    def wire_tool_name(self, tool_call: dict[str, Any]) -> str | None:
        # Tool name read from the raw JSON-RPC tool call, for agents that send
        # it in a field the SDK schema drops.
        return None

    def meta_tool_name(self, tc: Any) -> str | None:
        # Tool name the agent stamps on every frame of a call, updates included.
        return None

    def parent_tool_id(self, tc: Any) -> str | None:
        return None

    def normalize_tool_call(self, tc: Any) -> tuple[str, dict[str, Any] | None] | None:
        # (name, input) for calls the agent labels or wraps in its own
        # envelope; None = the ACP `kind`/`title` and raw_input stand.
        return None

    def extract_tool_result(self, tc: ToolCallProgress) -> Any:
        # Codex/Cursor put execute/read results in raw_output and Cursor emits
        # its edit results as diff content blocks. Content text blocks are the
        # last resort for agents that use none of the above.
        if tc.raw_output is not None:
            return tc.raw_output
        diffs = self.content_diffs(tc)
        if diffs:
            return {"diffs": diffs}
        texts = self.content_texts(tc)
        return "\n".join(texts) if texts else None

    def extract_tool_error(self, tc: ToolCallProgress) -> str:
        if tc.raw_output is not None:
            if isinstance(tc.raw_output, dict):
                # Codex wraps the error in formatted_output; opencode uses a
                # top-level `error` string. Fall through to stringifying the
                # dict only if neither is present.
                for key in ("formatted_output", "error"):
                    value = tc.raw_output.get(key)
                    if value:
                        return str(value)
                return str(tc.raw_output)
            return str(tc.raw_output)
        texts = self.content_texts(tc)
        return "\n".join(texts) if texts else "Tool execution failed"


class ClaudeAgentAdapter(AgentAdapter):
    session_modes = frozenset({"default", "acceptEdits", "plan", "bypassPermissions"})
    binary = "claude-agent-acp"
    effort_config_id = "effort"
    supports_fork = True
    supports_steering = True

    @staticmethod
    def _claude_meta(tc: Any) -> dict[str, Any]:
        meta = getattr(tc, "field_meta", None)
        claude_meta = meta.get("claudeCode") if isinstance(meta, dict) else None
        return claude_meta if isinstance(claude_meta, dict) else {}

    def meta_tool_name(self, tc: Any) -> str | None:
        # claude-agent-acp stamps the real tool name ("Read", "Edit") at
        # _meta.claudeCode.toolName, also on updates that carry no title.
        tool_name = self._claude_meta(tc).get("toolName")
        return tool_name if isinstance(tool_name, str) and tool_name else None

    def parent_tool_id(self, tc: Any) -> str | None:
        parent_id = self._claude_meta(tc).get("parentToolUseId")
        return str(parent_id) if parent_id else None

    def extract_tool_result(self, tc: ToolCallProgress) -> Any:
        claude_meta = self._claude_meta(tc)
        if "toolResponse" in claude_meta:
            return claude_meta["toolResponse"]
        return super().extract_tool_result(tc)

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        return LaunchConfig(
            binary=self.binary, env={"CLAUDE_CODE_EXECUTABLE": "claude"}
        )

    def build_session_meta(
        self, system_prompt: str | None, system_prompt_is_full_replace: bool
    ) -> dict[str, Any]:
        meta = self.build_system_prompt_meta(
            system_prompt, system_prompt_is_full_replace
        )
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
    effort_config_id = "reasoning_effort"
    supports_fork = True
    supports_steering = True
    image_read_path_key = "path"
    # codex-acp advertises Fast mode as a select (or a boolean when the client
    # supports it); the values match FastModeConfig.ts.
    fast_mode_config_id = "fast-mode"
    # UI permission mode → codex-acp session mode (each bundles approval + sandbox policy).
    SESSION_MODE_IDS = {
        "auto": "agent",
        "read-only": "read-only",
        "full-access": "agent-full-access",
    }
    session_modes = frozenset(SESSION_MODE_IDS)

    def needs_instructions_file(self, system_prompt_is_full_replace: bool) -> bool:
        return system_prompt_is_full_replace

    def normalize_tool_call(self, tc: Any) -> tuple[str, dict[str, Any] | None] | None:
        # MCP calls: title "mcp.<server>.<tool>", raw_input {server, tool, arguments}.
        raw_input = self.parse_raw_input(getattr(tc, "raw_input", None))
        meta = getattr(tc, "field_meta", None) or {}
        if not raw_input or not meta.get("is_mcp_tool_call"):
            return None
        return self.mcp_tool_call(
            raw_input.get("server"), raw_input.get("tool"), raw_input.get("arguments")
        )

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        # codex-acp uses CODEX_CONFIG only; modes bundle approval/sandbox.
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


class CopilotCliAdapter(AgentAdapter):
    # Copilot modes/reasoning differ from Claude — only send advertised values.
    binary = "copilot"
    cli_args = ("--acp", "--stdio")
    model_id_namespace = "copilot:"
    session_modes = frozenset({"agent", "plan", "autopilot"})
    fallback_session_mode = "agent"
    default_thinking_mode = "high"
    effort_config_id = "reasoning_effort"
    image_read_path_key = "path"
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
    # Permission mode is launch-baked; changes respawn via fingerprint.
    binary = "grok"
    model_id_namespace = "grok:"
    # The CLI ignores --reasoning-effort on session/load and keeps the saved tier.
    effort_config_id = "reasoning_effort"
    # UI labels, not CLI mode ids (wire_mode_id maps them to `default`/`plan`).
    # `always-approve` uses the launch flag; `auto` requests the CLI's
    # auto-review via session _meta (over ACP, risky calls are blocked, not
    # prompted). The legacy `code` mode never prompted, so it falls back to
    # always-approve.
    session_modes = frozenset({"auto", "always-approve", "plan"})
    fallback_session_mode = "always-approve"
    # resume_session_id preserves context across the respawn.
    respawns_on_mode_change = True
    # Delivered as `_x.ai/ask_user_question` (the SDK strips the underscore).
    # It must be answered with an AskUserQuestionExtResponse — an empty result
    # fails the tool with "missing field `outcome`".
    ask_user_question_method = "x.ai/ask_user_question"

    def wire_mode_id(self, session_mode: str) -> str:
        # The CLI only knows `default` and `plan`; approval is a launch flag.
        return "plan" if session_mode == "plan" else "default"

    def normalize_tool_call(self, tc: Any) -> tuple[str, dict[str, Any] | None] | None:
        # The raw tool name (write, search_replace, read_file, grep,
        # run_terminal_command, ...) is in field_meta["x.ai/tool"].name: the
        # initial tool_call has no `kind` and later updates rewrite `title` to
        # a human label. Web search calls lack that meta and keep their `kind`.
        # MCP calls are a `use_tool` with raw_input
        # {tool_name: "<server>__<tool>", tool_input}.
        meta = getattr(tc, "field_meta", None) or {}
        name = meta.get("x.ai/tool", {}).get("name")
        if not name:
            return None
        raw_input = self.parse_raw_input(getattr(tc, "raw_input", None))
        if name == "use_tool" and raw_input:
            tool_name = raw_input.get("tool_name")
            if isinstance(tool_name, str) and "__" in tool_name:
                tool_input = raw_input.get("tool_input")
                return (
                    f"mcp__{tool_name}",
                    tool_input if isinstance(tool_input, dict) else {},
                )
        return str(name), raw_input

    def extract_tool_error(self, tc: ToolCallProgress) -> str:
        # Failed updates carry a variant-tag dict in raw_output (e.g.
        # {"type": "FileNotFound"}); the readable message is in the content
        # text blocks.
        texts = self.content_texts(tc)
        if texts:
            return "\n".join(texts)
        return super().extract_tool_error(tc)

    def build_session_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        model_id: str,
        thinking_mode: str | None,
        permission_mode: str,
    ) -> SessionConfig:
        config = super().build_session_config(
            system_prompt=system_prompt,
            system_prompt_is_full_replace=system_prompt_is_full_replace,
            model_id=model_id,
            thinking_mode=thinking_mode,
            permission_mode=permission_mode,
        )
        if config.session_mode != "auto":
            return config
        # Without it a `grok agent` session starts in ask mode; also honored on load.
        return replace(config, meta={**config.meta, "autoMode": True})

    def build_launch_config(
        self,
        *,
        system_prompt: str | None,
        system_prompt_is_full_replace: bool,
        instructions_file_path: str | None = None,
        permission_mode: str | None = None,
    ) -> LaunchConfig:
        # Agent-level flags must precede the `stdio` subcommand.
        cli_args = ["agent"]
        if (
            permission_mode is not None
            and self.map_session_mode(permission_mode) == "always-approve"
        ):
            cli_args.append("--always-approve")
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
    image_read_path_key = "file_path"

    def normalize_tool_call(self, tc: Any) -> tuple[str, dict[str, Any] | None] | None:
        # MCP calls: field_meta.mcp {tool, server?}, raw_input {arguments, **arguments}.
        raw_input = self.parse_raw_input(getattr(tc, "raw_input", None))
        meta = getattr(tc, "field_meta", None) or {}
        if raw_input and meta.get("is_mcp_tool_call"):
            mcp = meta.get("mcp", {})
            mcp_call = self.mcp_tool_call(
                mcp.get("server"), mcp.get("tool"), raw_input.get("arguments")
            )
            if mcp_call:
                return mcp_call
        # ask_question frames are the only calls sent without a kind; their
        # title is the question text and raw_input is empty.
        title = getattr(tc, "title", None)
        if not getattr(tc, "kind", None) and title:
            return "ask_question", {"question": title}
        return None

    def reasoning_effort(self, model_id: str, thinking_mode: str | None) -> str:
        # Every Antigravity model has tiers, and its model IDs encode one.
        return self.resolve_thinking_mode(
            thinking_mode,
            self.valid_thinking_modes(model_id),
            self.default_thinking_mode,
        )

    def map_model_id(self, model_id: str, reasoning_effort: str | None = None) -> str:
        effort = self.reasoning_effort(model_id, reasoning_effort)
        server_model_id = model_id.removeprefix(self.model_id_namespace)
        return f"{server_model_id}-{effort}"

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
    supports_fork = True
    # OpenCode also emits todowrite tool calls, so its plan would duplicate them.
    forwards_plan = False
    tool_images_in_content = True
    # OpenCode v2 renamed these tools; older sessions replay the v1 names.
    TOOL_ALIASES = {"bash": "shell", "task": "subagent", "apply_patch": "patch"}
    # OpenCode 2 allows external directories by default; restore v1's ask
    # (host-mode sessions share the real HOME). Built-in plan writes here.
    BASE_CONFIG: dict[str, Any] = {
        "permission": {
            "external_directory": {"*": "ask", "~/.opencode/plan/*": "allow"}
        }
    }

    def needs_instructions_file(self, system_prompt_is_full_replace: bool) -> bool:
        return not system_prompt_is_full_replace

    def wire_tool_name(self, tool_call: dict[str, Any]) -> str | None:
        # The name is only in a top-level `name` field: ACP `kind` collapses
        # distinct tools (edit/write/patch all become "edit") and `title` turns
        # into the shell command once input arrives.
        name = tool_call.get("name")
        if not isinstance(name, str) or not name:
            return None
        name = name.lower()
        return self.TOOL_ALIASES.get(name, name)

    def extract_tool_result(self, tc: ToolCallProgress) -> Any:
        # raw_output holds only metadata; the output text is in content blocks.
        if isinstance(tc.raw_output, dict):
            return {
                "output": "\n".join(self.content_texts(tc)),
                "metadata": tc.raw_output.get("metadata"),
            }
        return super().extract_tool_result(tc)

    def build_session_env(self, model_id: str) -> dict[str, str]:
        return {"OPENCODE_CONFIG_CONTENT": json.dumps(self.BASE_CONFIG)}

    def reasoning_effort(self, model_id: str, thinking_mode: str | None) -> str | None:
        # Unlike other agents, an unset level (or the selector's "default")
        # sends nothing so OpenCode keeps the provider's own default.
        modes = self.valid_thinking_modes(model_id)
        if thinking_mode in (None, "", "default") or not modes:
            return None
        return self.resolve_thinking_mode(thinking_mode, modes)

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
