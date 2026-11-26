from typing import Any

from app.catalog import MODELS
from app.models.db_models.chat import Chat
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.acp.adapters import AGENT_ADAPTERS


class MissingTurnModelError(Exception):
    @staticmethod
    def errors() -> list[dict[str, Any]]:
        # Same shape as pydantic's ValidationError.errors(), so the form routes
        # report it like any other missing field.
        return [
            {
                "type": "missing",
                "loc": ("body", "model_id"),
                "msg": "Field required",
                "input": None,
            }
        ]


def resolve_turn_settings(
    inherit_from: Chat | None,
    *,
    model_id: str | None = None,
    thinking_mode: str | None = None,
    persona_name: str | None = None,
) -> tuple[str, str | None, str]:
    if inherit_from is not None:
        model_id = model_id or inherit_from.last_model_id
        persona_name = persona_name or inherit_from.last_persona_name
    if model_id is None:
        raise MissingTurnModelError
    persona_name = persona_name or DEFAULT_PERSONA_NAME
    if inherit_from is None or thinking_mode or model_id not in MODELS:
        return model_id, thinking_mode, persona_name
    # Only an explicit tier may fail the turn; an inherited one the model
    # lacks falls back to the adapter default.
    adapter = AGENT_ADAPTERS[MODELS[model_id].agent_kind]
    if adapter.accepts_thinking_mode(model_id, inherit_from.last_thinking_mode):
        thinking_mode = inherit_from.last_thinking_mode
    return model_id, thinking_mode, persona_name
