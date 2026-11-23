from app.catalog import antigravity, claude, codex, copilot, cursor, grok, opencode
from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind


def merge_models(*catalogs: dict[str, ModelInfo]) -> dict[str, ModelInfo]:
    models: dict[str, ModelInfo] = {}
    for catalog in catalogs:
        duplicates = models.keys() & catalog.keys()
        if duplicates:
            raise ValueError(f"Duplicate model ids: {sorted(duplicates)}")
        models.update(catalog)
    return models


MODELS: dict[str, ModelInfo] = merge_models(
    claude.MODELS,
    codex.MODELS,
    copilot.MODELS,
    cursor.MODELS,
    grok.MODELS,
    antigravity.MODELS,
    opencode.MODELS,
)

# Built-in slash commands per agent kind for the frontend. Claude/Codex lists
# are filtered ACP-exposed subsets (not full CLI/TUI chrome); skills are runtime.
# Codex omits logout — too easy to hit from chat autocomplete.
BUILTIN_SLASH_COMMANDS: dict[AgentKind, list[dict[str, str]]] = {
    AgentKind.ANTIGRAVITY: [],
    AgentKind.CLAUDE: claude.SLASH_COMMANDS,
    AgentKind.CODEX: codex.SLASH_COMMANDS,
    AgentKind.COPILOT: copilot.SLASH_COMMANDS,
    # Cursor slash commands are TUI-only; ACP would treat them as prompt text.
    AgentKind.CURSOR: [],
    # Grok advertises commands via availableCommands — runtime discovery only.
    AgentKind.GROK: [],
    # OpenCode slash commands are TUI-only; ACP surfaces user-defined ones.
    AgentKind.OPENCODE: [],
}
