from typing import NamedTuple

from app.models.types import AgentKind


class ModelInfo(NamedTuple):
    display_name: str
    agent_kind: AgentKind
    context_window: int | None
    legacy: bool = False
    # Effort tiers the model accepts (OpenCode's from models.dev
    # `reasoning_options`); empty = no effort dial.
    effort_levels: tuple[str, ...] = ()
