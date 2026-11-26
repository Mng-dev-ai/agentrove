from app.catalog import MODELS
from app.models.db_models.chat import Chat
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import AGENT_ADAPTERS


def resolve_inherited_turn_settings(
    chat: Chat,
    *,
    model_id: str | None = None,
    thinking_mode: str | None = None,
    persona_name: str | None = None,
) -> tuple[str | None, str | None, str]:
    model_id = model_id or chat.last_model_id
    persona_name = persona_name or chat.last_persona_name or DEFAULT_PERSONA_NAME
    if thinking_mode or model_id is None or model_id not in MODELS:
        return model_id, thinking_mode, persona_name
    # Only an explicit tier may fail the turn; an inherited one the model
    # lacks falls back to the adapter default.
    adapter = AGENT_ADAPTERS[MODELS[model_id].agent_kind]
    if adapter.accepts_thinking_mode(model_id, chat.last_thinking_mode):
        thinking_mode = chat.last_thinking_mode
    return model_id, thinking_mode, persona_name
