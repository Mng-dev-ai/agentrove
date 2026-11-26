from app.catalog import MODELS
from app.models.db_models.chat import Chat
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import AGENT_ADAPTERS


def resolve_turn_settings(
    inherit_from: Chat | None,
    model_id: str,
    *,
    thinking_mode: str | None = None,
    persona_name: str | None = None,
) -> tuple[str | None, str]:
    if inherit_from is None:
        return thinking_mode, persona_name or DEFAULT_PERSONA_NAME
    persona_name = (
        persona_name or inherit_from.last_persona_name or DEFAULT_PERSONA_NAME
    )
    if thinking_mode or model_id not in MODELS:
        return thinking_mode, persona_name
    # Only an explicit tier may fail the turn; an inherited one the model
    # lacks falls back to the adapter default.
    adapter = AGENT_ADAPTERS[MODELS[model_id].agent_kind]
    if adapter.accepts_thinking_mode(model_id, inherit_from.last_thinking_mode):
        thinking_mode = inherit_from.last_thinking_mode
    return thinking_mode, persona_name
