from pydantic import BaseModel

from app.services.acp.adapters import AgentKind


class AIModelResponse(BaseModel):
    model_id: str
    name: str
    agent_kind: AgentKind
    context_window: int | None = None
    # Effort tiers low→high; empty means no dial (thinking_mode ignored).
    thinking_modes: list[str] = []
