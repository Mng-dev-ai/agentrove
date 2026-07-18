from pydantic import BaseModel

from app.services.acp.adapters import AgentKind


class AIModelResponse(BaseModel):
    model_id: str
    name: str
    agent_kind: AgentKind
    context_window: int | None = None
    # Supported reasoning-effort tiers, ordered lowest to highest; empty when
    # the model has no reasoning dial (thinking_mode is ignored for it).
    thinking_modes: list[str] = []
