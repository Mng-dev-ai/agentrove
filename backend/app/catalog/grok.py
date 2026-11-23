from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind

MODELS: dict[str, ModelInfo] = {
    "grok:grok-4.7": ModelInfo(
        "Grok 4.7",
        AgentKind.GROK,
        500_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "grok:grok-4.6": ModelInfo(
        "Grok 4.6",
        AgentKind.GROK,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "grok:grok-4.5": ModelInfo(
        "Grok 4.5",
        AgentKind.GROK,
        500_000,
        legacy=True,
        effort_levels=("low", "medium", "high"),
    ),
}
