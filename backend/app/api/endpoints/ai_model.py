from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.ai_model import AIModelResponse
from app.catalog import MODELS
from app.models.types import AgentKind
from app.services.acp.adapters import (
    AGENT_ADAPTERS,
    PERSONAS_SUPPORTED_AGENTS,
    THINKING_MODE_ORDER,
    UNATTENDED_PERMISSION_MODE,
)

router = APIRouter()


@router.get("/", response_model=list[AIModelResponse])
async def list_models(
    current_user: User = Depends(get_current_user),
    agent_kind: str | None = Query(None, max_length=32),
) -> list[AIModelResponse]:
    kind: AgentKind | None = None
    if agent_kind:
        try:
            kind = AgentKind(agent_kind)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid agent_kind: {agent_kind}",
            )

    return [
        AIModelResponse(
            model_id=mid,
            name=info.display_name,
            agent_kind=info.agent_kind,
            context_window=info.context_window,
            legacy=info.legacy,
            thinking_modes=sorted(
                AGENT_ADAPTERS[info.agent_kind].valid_thinking_modes(mid),
                key=THINKING_MODE_ORDER.index,
            ),
            supports_fork=AGENT_ADAPTERS[info.agent_kind].supports_fork,
            supports_persona=info.agent_kind in PERSONAS_SUPPORTED_AGENTS,
            supports_fast_mode=(
                AGENT_ADAPTERS[info.agent_kind].fast_mode_config_id is not None
            ),
            supports_usage_updates=(
                AGENT_ADAPTERS[info.agent_kind].supports_usage_updates
            ),
            unattended_permission_mode=UNATTENDED_PERMISSION_MODE[info.agent_kind],
        )
        for mid, info in MODELS.items()
        if kind is None or info.agent_kind == kind
    ]
