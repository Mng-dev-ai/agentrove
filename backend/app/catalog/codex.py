from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind

SLASH_COMMANDS: list[dict[str, str]] = [
    {
        "value": "/review",
        "label": "Review",
        "description": "Review uncommitted changes, or review with custom instructions",
    },
    {
        "value": "/review-branch",
        "label": "Review Branch",
        "description": "Review changes relative to a base branch",
    },
    {
        "value": "/review-commit",
        "label": "Review Commit",
        "description": "Review a specific commit",
    },
    {
        "value": "/compact",
        "label": "Compact",
        "description": "Summarize conversation to avoid hitting the context limit",
    },
    {
        "value": "/status",
        "label": "Status",
        "description": "Display session configuration and token usage",
    },
    {
        "value": "/goal",
        "label": "Goal",
        "description": "Set, pause, resume, or clear a task goal",
    },
    {
        "value": "/mcp",
        "label": "MCP",
        "description": "List configured Model Context Protocol (MCP) tools",
    },
    {
        "value": "/skills",
        "label": "Skills",
        "description": "List available skills",
    },
]

MODELS: dict[str, ModelInfo] = {
    # Codex CLI clamps model_context_window to its bundled catalog max — 272k for
    # these slugs — then sessions report ~95% of the resolved window (e.g. 258,400).
    # gpt-5.4's catalog max is 1M via config opt-in; raise it here once a live
    # session verifies the opt-in survives our app-server launch path.
    # Live-reported window still wins over these fallbacks.
    "gpt-6.1-sol": ModelInfo(
        "GPT 6.1 Sol",
        AgentKind.CODEX,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-6.1-terra": ModelInfo(
        "GPT 6.1 Terra",
        AgentKind.CODEX,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-6-astra": ModelInfo(
        "GPT 6 Astra",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-6-sol": ModelInfo(
        "GPT 6 Sol",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-6-luna": ModelInfo(
        "GPT 6 Luna",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "gpt-5.6-sol": ModelInfo(
        "GPT 5.6 Sol",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-5.6-terra": ModelInfo(
        "GPT 5.6 Terra",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh", "max", "ultra"),
    ),
    "gpt-5.6-luna": ModelInfo(
        "GPT 5.6 Luna",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "gpt-5.5": ModelInfo(
        "GPT 5.5",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.4": ModelInfo(
        "GPT 5.4",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.4-mini": ModelInfo(
        "GPT 5.4 Mini",
        AgentKind.CODEX,
        272_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.3-codex": ModelInfo(
        "GPT 5.3 Codex",
        AgentKind.CODEX,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.2-codex": ModelInfo(
        "GPT 5.2 Codex",
        AgentKind.CODEX,
        400_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.2": ModelInfo(
        "GPT 5.2",
        AgentKind.CODEX,
        272_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.1-codex-max": ModelInfo(
        "GPT 5.1 Codex Max",
        AgentKind.CODEX,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "gpt-5.1-codex-mini": ModelInfo(
        "GPT 5.1 Codex Mini",
        AgentKind.CODEX,
        400_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
}
