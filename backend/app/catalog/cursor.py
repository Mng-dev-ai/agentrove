from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind

MODELS: dict[str, ModelInfo] = {
    "cursor:auto": ModelInfo("Auto", AgentKind.CURSOR, None),
    "cursor:composer-2.5-fast": ModelInfo(
        "Composer 2.5 Fast", AgentKind.CURSOR, 200_000
    ),
    "cursor:composer-2.5": ModelInfo("Composer 2.5", AgentKind.CURSOR, 200_000),
    "cursor:composer-2-fast": ModelInfo(
        "Composer 2", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:composer-1.5": ModelInfo(
        "Composer 1.5", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:gpt-5.4-medium": ModelInfo("GPT 5.4", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.4-mini-medium": ModelInfo("GPT 5.4 Mini", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.4-nano-medium": ModelInfo("GPT 5.4 Nano", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.3-codex": ModelInfo("GPT 5.3 Codex", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.3-codex-spark-preview": ModelInfo(
        "Codex 5.3 Spark", AgentKind.CURSOR, 272_000
    ),
    "cursor:gpt-5.2": ModelInfo("GPT 5.2", AgentKind.CURSOR, 272_000),
    "cursor:gpt-5.2-codex": ModelInfo(
        "GPT 5.2 Codex", AgentKind.CURSOR, 272_000, legacy=True
    ),
    "cursor:gpt-5.1": ModelInfo("GPT 5.1", AgentKind.CURSOR, 272_000, legacy=True),
    "cursor:gpt-5.1-codex-max-medium": ModelInfo(
        "GPT 5.1 Codex Max", AgentKind.CURSOR, 272_000
    ),
    "cursor:gpt-5.1-codex-mini": ModelInfo(
        "GPT 5.1 Codex Mini", AgentKind.CURSOR, 272_000
    ),
    "cursor:gpt-5-mini": ModelInfo("GPT 5 Mini", AgentKind.CURSOR, 272_000),
    "cursor:claude-opus-4-7-thinking-high": ModelInfo(
        "Opus 4.7 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:claude-4.6-opus-high-thinking": ModelInfo(
        "Opus 4.6 Thinking", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:claude-4.5-opus-high-thinking": ModelInfo(
        "Opus 4.5 Thinking", AgentKind.CURSOR, 200_000, legacy=True
    ),
    "cursor:claude-4.6-sonnet-medium-thinking": ModelInfo(
        "Sonnet 4.6 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:claude-4.5-sonnet-thinking": ModelInfo(
        "Sonnet 4.5 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:claude-4-sonnet": ModelInfo("Sonnet 4", AgentKind.CURSOR, 200_000),
    "cursor:gemini-3.1-pro": ModelInfo("Gemini 3.1 Pro", AgentKind.CURSOR, 200_000),
    "cursor:gemini-3-flash": ModelInfo("Gemini 3 Flash", AgentKind.CURSOR, 200_000),
    "cursor:grok-4-20-thinking": ModelInfo(
        "Grok 4.20 Thinking", AgentKind.CURSOR, 200_000
    ),
    "cursor:kimi-k2.5": ModelInfo("Kimi K2.5", AgentKind.CURSOR, 262_000),
}
