import shutil
from typing import Any

import pytest
import sync_opencode_catalog as sync

from app.catalog.model_info import ModelInfo
from app.models.types import AgentKind
from app.services.acp.adapters import THINKING_MODE_ORDER

CATALOG: dict[str, Any] = {
    "unlisted": {
        "models": {"other": {"name": "Other", "limit": {"context": 1000}}},
    },
    "zeta": {
        "models": {
            "plain": {"name": "Plain", "limit": {"context": 8192}},
            "retired": {
                "name": "Retired",
                "limit": {"context": 200_000},
                "status": "deprecated",
            },
            "image-only": {"name": "Image Only", "limit": {"output": 4096}},
            "thinker": {
                "name": "Thinker",
                "limit": {"context": 1_000_000},
                "status": "beta",
                "reasoning_options": [
                    {"type": "toggle"},
                    {"type": "effort", "values": ["low", "default", "high"]},
                ],
            },
        },
    },
    "alpha": {
        "models": {
            "b/old": {"name": "Old", "limit": {"context": 128_000}},
            "a-renamed": {"name": "Upstream Name", "limit": {"context": 32_768}},
        },
    },
}
OVERRIDES: dict[str, Any] = {
    "min_models": 5,
    "providers": {"zeta": "Zeta", "alpha": "Alpha Cloud"},
    "display_names": {"alpha/a-renamed": "Our Name"},
    "legacy": {"alpha": ["b/old"]},
    "keep": {
        "zeta/kept-fast": {
            "name": "Kept Fast",
            "context_window": 400_000,
            "effort_levels": ["high"],
        },
    },
}
EXPECTED = {
    "opencode:zeta/kept-fast": ModelInfo(
        "Kept Fast (Zeta)", AgentKind.OPENCODE, 400_000, effort_levels=("high",)
    ),
    "opencode:zeta/plain": ModelInfo("Plain (Zeta)", AgentKind.OPENCODE, 8192),
    "opencode:zeta/thinker": ModelInfo(
        "Thinker (Zeta)", AgentKind.OPENCODE, 1_000_000, effort_levels=("low", "high")
    ),
    "opencode:alpha/a-renamed": ModelInfo(
        "Our Name (Alpha Cloud)", AgentKind.OPENCODE, 32_768
    ),
    "opencode:alpha/b/old": ModelInfo(
        "Old (Alpha Cloud)", AgentKind.OPENCODE, 128_000, legacy=True
    ),
}


def rendered_models(source: str) -> dict[str, ModelInfo]:
    namespace: dict[str, Any] = {}
    exec(source, namespace)
    models: dict[str, ModelInfo] = namespace["MODELS"]
    return models


def test_generated_catalog_applies_filters_and_overrides_in_stable_order() -> None:
    source = sync.render(sync.build_models(CATALOG, OVERRIDES))

    models = rendered_models(source)
    assert models == EXPECTED
    assert list(models) == list(EXPECTED)
    assert sync.render(sync.build_models(CATALOG, OVERRIDES)) == source


def test_effort_levels_mirror_the_adapter_order() -> None:
    assert sync.EFFORT_LEVELS == THINKING_MODE_ORDER


@pytest.mark.skipif(shutil.which("ruff") is None, reason="ruff is not installed")
def test_generated_catalog_is_ruff_format_clean() -> None:
    formatted = sync.format_source(sync.render(sync.build_models(CATALOG, OVERRIDES)))

    assert rendered_models(formatted) == EXPECTED
    assert sync.format_source(formatted) == formatted
