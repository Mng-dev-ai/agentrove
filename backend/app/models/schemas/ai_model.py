from pydantic import BaseModel

from app.models.types import AgentKind


class AIModelResponse(BaseModel):
    model_id: str
    name: str
    agent_kind: AgentKind
    context_window: int | None = None
    # Available to saved selections, but hidden from ordinary model choices.
    legacy: bool = False
    # Effort tiers low→high; empty means no dial (thinking_mode ignored).
    thinking_modes: list[str] = []
    # The agent CLI implements ACP session/fork, so its chats can be forked.
    supports_fork: bool = False
    supports_persona: bool = False
    supports_fast_mode: bool = False
    supports_usage_updates: bool = False
