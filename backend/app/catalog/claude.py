from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind

SLASH_COMMANDS: list[dict[str, str]] = [
    {
        "value": "/compact",
        "label": "Compact",
        "description": "Free up context by summarizing the conversation so far. Optional: /compact [instructions for summarization]",
    },
    {
        "value": "/clear",
        "label": "Clear",
        "description": "Start a new session with empty context; previous session stays on disk (resumable with /resume)",
    },
    {
        "value": "/review",
        "label": "Review",
        "description": "Review a GitHub pull request; for your working diff use /code-review",
    },
    {
        "value": "/code-review",
        "label": "Code Review",
        "description": "Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups. Optional: /code-review [low|medium|high|xhigh|max] [--fix] [--comment] [target]",
    },
    {
        "value": "/security-review",
        "label": "Security Review",
        "description": "Complete a security review of the pending changes on the current branch",
    },
    {
        "value": "/simplify",
        "label": "Simplify",
        "description": "Review changed code for reuse, simplification, efficiency, and altitude cleanups, then apply the fixes",
    },
    {
        "value": "/init",
        "label": "Init",
        "description": "Initialize a new CLAUDE.md file with codebase documentation",
    },
    {
        "value": "/debug",
        "label": "Debug",
        "description": "Enable debug logging for this session and help diagnose issues",
    },
    {
        "value": "/doctor",
        "label": "Doctor",
        "description": "Health-check the Claude Code setup and fix installation, settings, and configuration issues",
    },
    {
        "value": "/insights",
        "label": "Insights",
        "description": "Generate a report analyzing your Claude Code sessions",
    },
    {
        "value": "/recap",
        "label": "Recap",
        "description": "Generate a one-line session recap now",
    },
    {
        "value": "/loop",
        "label": "Loop",
        "description": "Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)",
    },
    {
        "value": "/batch",
        "label": "Batch",
        "description": "Research and plan a large-scale change, then execute it in parallel across isolated worktree agents that each open a PR",
    },
    {
        "value": "/deep-research",
        "label": "Deep Research",
        "description": "Fan out web searches, fetch and cross-check sources, and synthesize a cited report",
    },
    {
        "value": "/verify",
        "label": "Verify",
        "description": "Verify a code change end-to-end by driving the affected flow, not just tests or typecheck",
    },
    {
        "value": "/run",
        "label": "Run",
        "description": "Launch and drive this project's app to see a change working",
    },
    {
        "value": "/run-skill-generator",
        "label": "Run Skill Generator",
        "description": "Author or improve a per-project run skill that tells agents how to build, launch, and drive this app",
    },
    {
        "value": "/goal",
        "label": "Goal",
        "description": "Set a goal — keep working until the condition is met",
    },
    {
        "value": "/update-config",
        "label": "Update Config",
        "description": "Configure Claude Code settings via settings.json (permissions, hooks, env vars)",
    },
    {
        "value": "/claude-api",
        "label": "Claude API",
        "description": "Build apps with the Claude API or Anthropic SDK",
    },
    {
        "value": "/dataviz",
        "label": "Data Viz",
        "description": "Design guidance for charts, graphs, and dashboards",
    },
    {
        "value": "/fewer-permission-prompts",
        "label": "Fewer Permission Prompts",
        "description": "Scan transcripts for common read-only tool calls and add a project allowlist to reduce permission prompts",
    },
    {
        "value": "/team-onboarding",
        "label": "Team Onboarding",
        "description": "Help teammates ramp on Claude Code with a guide from your usage",
    },
    {
        "value": "/reload-skills",
        "label": "Reload Skills",
        "description": "Pick up skills added or changed on disk during this session",
    },
]

MODELS: dict[str, ModelInfo] = {
    "sonnet": ModelInfo(
        "Sonnet",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "max"),
    ),
    "claude-sonnet-5-5": ModelInfo(
        "Sonnet 5.5",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "haiku": ModelInfo("Haiku", AgentKind.CLAUDE, 200_000),
    "claude-haiku-5-5": ModelInfo(
        "Haiku 5.5",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-fable-5-2": ModelInfo(
        "Fable 5.2",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-fable-5-1": ModelInfo(
        "Fable 5.1",
        AgentKind.CLAUDE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-fable-5": ModelInfo(
        "Fable 5",
        AgentKind.CLAUDE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-opus-5-5": ModelInfo(
        "Opus 5.5",
        AgentKind.CLAUDE,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
    "claude-opus-5": ModelInfo(
        "Opus 5",
        AgentKind.CLAUDE,
        1_000_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh", "max"),
    ),
}
