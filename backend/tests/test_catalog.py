import pytest

from app.catalog import BUILTIN_SLASH_COMMANDS, MODELS, ModelInfo, merge_models
from app.constants import DEFAULT_TITLE_MODEL_ID
from app.models.types import AgentKind
from app.services.acp.adapters import THINKING_MODE_ORDER


def test_model_entries_are_well_formed() -> None:
    for model_id, info in MODELS.items():
        assert set(info.effort_levels) <= set(THINKING_MODE_ORDER), model_id
        assert info.context_window is None or info.context_window > 0, model_id


def test_builtin_slash_commands_cover_every_agent_kind() -> None:
    assert set(BUILTIN_SLASH_COMMANDS) == set(AgentKind)
    for commands in BUILTIN_SLASH_COMMANDS.values():
        for command in commands:
            assert set(command) == {"value", "label", "description"}
            assert command["value"].startswith("/")


def test_default_title_model_is_in_catalog() -> None:
    assert DEFAULT_TITLE_MODEL_ID in MODELS


def test_merge_models_rejects_duplicate_ids() -> None:
    info = ModelInfo("Haiku", AgentKind.CLAUDE, 200_000)
    with pytest.raises(ValueError, match="haiku"):
        merge_models({"haiku": info}, {"haiku": info})
