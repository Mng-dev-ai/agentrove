from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind

MODELS: dict[str, ModelInfo] = {
    "antigravity:gemini-4-neon": ModelInfo(
        "Gemini 4 Neon",
        AgentKind.ANTIGRAVITY,
        1_048_576,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "antigravity:gemini-4-hydrogen": ModelInfo(
        "Gemini 4 Hydrogen",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        effort_levels=("low", "medium", "high", "xhigh"),
    ),
    "antigravity:gemini-4-carbon": ModelInfo(
        "Gemini 4 Carbon",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-4-argon": ModelInfo(
        "Gemini 4 Argon",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
    "antigravity:gemini-3.8-flash": ModelInfo(
        "Gemini 3.8 Flash",
        AgentKind.ANTIGRAVITY,
        1_000_000,
        effort_levels=("low", "medium", "high"),
    ),
}
