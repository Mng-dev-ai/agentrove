from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind

SLASH_COMMANDS: list[dict[str, str]] = [
    {"value": "/model", "label": "Model", "description": "Select the active model"},
    {
        "value": "/compact",
        "label": "Compact",
        "description": "Clear conversation history but keep a summary in context",
    },
    {
        "value": "/context",
        "label": "Context",
        "description": "Show context window token usage and visualization",
    },
    {
        "value": "/usage",
        "label": "Usage",
        "description": "Display session usage metrics and statistics",
    },
    {"value": "/review", "label": "Review", "description": "Review a pull request"},
    {
        "value": "/diff",
        "label": "Diff",
        "description": "Review the changes made in the current directory",
    },
    {
        "value": "/pr",
        "label": "PR",
        "description": "Operate on pull requests for the current branch",
    },
    {
        "value": "/init",
        "label": "Init",
        "description": "Initialize project configuration",
    },
    {
        "value": "/agent",
        "label": "Agent",
        "description": "Browse and select from available agents",
    },
    {
        "value": "/skills",
        "label": "Skills",
        "description": "Manage skills for enhanced capabilities",
    },
    {
        "value": "/mcp",
        "label": "MCP",
        "description": "Manage MCP server configuration",
    },
    {
        "value": "/plugin",
        "label": "Plugin",
        "description": "Manage plugins and plugin marketplaces",
    },
    {
        "value": "/session",
        "label": "Session",
        "description": "View and manage sessions",
    },
    {
        "value": "/tasks",
        "label": "Tasks",
        "description": "View and manage background tasks",
    },
    {
        "value": "/delegate",
        "label": "Delegate",
        "description": "Send this session to GitHub and create a PR",
    },
    {
        "value": "/fleet",
        "label": "Fleet",
        "description": "Enable parallel subagent execution",
    },
    {
        "value": "/allow-all",
        "label": "Allow All",
        "description": "Enable all permissions for the session",
    },
]

MODELS: dict[str, ModelInfo] = {
    "copilot:auto": ModelInfo("Auto", AgentKind.COPILOT, None),
    "copilot:claude-opus-5.5": ModelInfo(
        "Opus 5.5",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-sonnet-5.5": ModelInfo(
        "Sonnet 5.5",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-fable-5.2": ModelInfo(
        "Fable 5.2",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-fable-5.1": ModelInfo(
        "Fable 5.1",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-sonnet-5": ModelInfo(
        "Sonnet 5",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-fable-5": ModelInfo(
        "Fable 5",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-opus-5": ModelInfo(
        "Opus 5",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-opus-4.8": ModelInfo(
        "Opus 4.8",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-opus-4.8-fast": ModelInfo(
        "Opus 4.8 Fast",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-sonnet-4.6": ModelInfo(
        "Sonnet 4.6",
        AgentKind.COPILOT,
        160_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "copilot:claude-haiku-5.5": ModelInfo(
        "Haiku 5.5",
        AgentKind.COPILOT,
        160_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:claude-haiku-4.5": ModelInfo(
        "Haiku 4.5", AgentKind.COPILOT, 160_000, legacy=True
    ),
    "copilot:gpt-6.1-sol": ModelInfo(
        "GPT 6.1 Sol",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-6.1-terra": ModelInfo(
        "GPT 6.1 Terra",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-6-astra": ModelInfo(
        "GPT 6 Astra",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-6-sol": ModelInfo(
        "GPT 6 Sol",
        AgentKind.COPILOT,
        304_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-6-luna": ModelInfo(
        "GPT 6 Luna",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.6-sol": ModelInfo(
        "GPT 5.6 Sol",
        AgentKind.COPILOT,
        304_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.6-terra": ModelInfo(
        "GPT 5.6 Terra",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.6-luna": ModelInfo(
        "GPT 5.6 Luna",
        AgentKind.COPILOT,
        304_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "copilot:gpt-5.3-codex": ModelInfo(
        "GPT 5.3 Codex",
        AgentKind.COPILOT,
        304_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:mai-code-1.1-flash": ModelInfo(
        "MAI Code 1.1 Flash",
        AgentKind.COPILOT,
        128_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-4-carbon": ModelInfo(
        "Gemini 4 Carbon",
        AgentKind.COPILOT,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-4-argon": ModelInfo(
        "Gemini 4 Argon",
        AgentKind.COPILOT,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash",
        AgentKind.COPILOT,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:grok-4.7": ModelInfo(
        "Grok 4.7",
        AgentKind.COPILOT,
        256_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:grok-4.6": ModelInfo(
        "Grok 4.6",
        AgentKind.COPILOT,
        256_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "copilot:grok-4.5": ModelInfo(
        "Grok 4.5",
        AgentKind.COPILOT,
        256_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
    "copilot:kimi-k3": ModelInfo(
        "Kimi K3", AgentKind.COPILOT, 256_000, effort_levels=("low", "high", "max")
    ),
}
