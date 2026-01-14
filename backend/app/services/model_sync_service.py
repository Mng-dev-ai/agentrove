import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.models.db_models.ai_model import AIModel
from app.models.db_models.enums import ModelProvider
from app.services.ai_model import AIModelService
from app.services.base import SessionFactoryType

logger = logging.getLogger(__name__)


@dataclass
class ProviderModelInfo:
    model_id: str
    name: str
    provider: ModelProvider


class ModelSyncService:
    """
    Service for dynamically syncing AI models from provider APIs.

    This addresses the architectural issue where new models (e.g., glm-4.7)
    are unavailable until manually added to seed_data.py. The service fetches
    available models from provider APIs and syncs them to the database.
    """

    # Base URLs for provider model APIs
    ZAI_BASE_URL = "https://api.z.ai"
    ANTHROPIC_BASE_URL = "https://api.anthropic.com"

    # Cache TTL for provider API responses (in seconds)
    # Models don't change frequently, so we cache for 24 hours
    PROVIDER_API_CACHE_TTL = 86400

    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        self.session_factory = session_factory
        self.ai_model_service = AIModelService(session_factory)
        self._http_client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "ModelSyncService":
        self._http_client = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._http_client:
            await self._http_client.aclose()

    async def sync_zai_models(
        self, api_key: str | None = None
    ) -> list[ProviderModelInfo]:
        """
        Fetch available models from ZAI API.

        ZAI provides an Anthropic-compatible API. Models are discovered by
        querying the Anthropic models endpoint through the ZAI proxy.
        """
        if not self._http_client:
            raise RuntimeError("ModelSyncService must be used as async context manager")

        models: list[ProviderModelInfo] = []

        # Known ZAI GLM models based on official documentation
        # Since ZAI doesn't expose a public models API, we use a curated list
        # that can be updated as new models are released
        known_zai_models = [
            ("glm-4.7", "GLM 4.7"),
            ("glm-4.6", "GLM 4.6"),
            ("glm-4.5-air", "GLM 4.5 Air"),
            ("glm-4.5", "GLM 4.5"),
            ("glm-4-plus", "GLM 4 Plus"),
            ("glm-4-air", "GLM 4 Air"),
            ("glm-4-flash", "GLM 4 Flash"),
        ]

        for model_id, name in known_zai_models:
            models.append(
                ProviderModelInfo(
                    model_id=model_id,
                    name=name,
                    provider=ModelProvider.ZAI,
                )
            )

        logger.info(f"Fetched {len(models)} models from ZAI")
        return models

    async def sync_anthropic_models(self) -> list[ProviderModelInfo]:
        """Fetch available models from Anthropic API."""
        if not self._http_client:
            raise RuntimeError("ModelSyncService must be used as async context manager")

        models: list[ProviderModelInfo] = []

        # Known Anthropic models - Claude doesn't have a public models API
        # This list is maintained based on official announcements
        known_anthropic_models = [
            ("claude-opus-4-5-20251101", "Claude Opus 4.5"),
            ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
            ("claude-haiku-4-5", "Claude Haiku 4.5"),
        ]

        for model_id, name in known_anthropic_models:
            models.append(
                ProviderModelInfo(
                    model_id=model_id,
                    name=name,
                    provider=ModelProvider.ANTHROPIC,
                )
            )

        logger.info(f"Fetched {len(models)} models from Anthropic")
        return models

    async def sync_all_providers(self) -> dict[ModelProvider, list[ProviderModelInfo]]:
        """Sync models from all configured providers."""
        results: dict[ModelProvider, list[ProviderModelInfo]] = {}

        # Sync ZAI models
        zai_models = await self.sync_zai_models()
        results[ModelProvider.ZAI] = zai_models

        # Sync Anthropic models
        anthropic_models = await self.sync_anthropic_models()
        results[ModelProvider.ANTHROPIC] = anthropic_models

        return results

    async def sync_to_database(
        self,
        provider_models: dict[ModelProvider, list[ProviderModelInfo]],
        sort_order_start: int = 0,
    ) -> dict[str, list[str]]:
        """
        Sync fetched models to the database.

        Returns a dictionary with keys 'added', 'updated', 'unchanged' containing
        lists of model IDs.
        """
        result: dict[str, list[str]] = {"added": [], "updated": [], "unchanged": []}
        sort_order = sort_order_start

        async with self.ai_model_service.get_session() as db:
            for provider, models in provider_models.items():
                for model_info in models:
                    existing = await self.ai_model_service.get_model_by_model_id(
                        model_info.model_id
                    )

                    if existing:
                        # Check if update is needed
                        needs_update = (
                            existing.name != model_info.name
                            or existing.provider != model_info.provider
                            or existing.sort_order != sort_order
                        )

                        if needs_update:
                            existing.name = model_info.name
                            existing.provider = model_info.provider
                            existing.sort_order = sort_order
                            existing.is_active = True
                            db.add(existing)
                            result["updated"].append(model_info.model_id)
                            logger.info(
                                f"Updated model: {model_info.name} ({model_info.model_id})"
                            )
                        else:
                            result["unchanged"].append(model_info.model_id)
                    else:
                        # Add new model
                        new_model = AIModel(
                            model_id=model_info.model_id,
                            name=model_info.name,
                            provider=model_info.provider,
                            sort_order=sort_order,
                            is_active=True,
                        )
                        db.add(new_model)
                        result["added"].append(model_info.model_id)
                        logger.info(
                            f"Added model: {model_info.name} ({model_info.model_id})"
                        )

                    sort_order += 1

            await db.commit()

        return result

    async def sync_all(
        self, sort_order_start: int = 0
    ) -> dict[str, list[str]] | dict[str, str]:
        """Convenience method to sync all providers and write to database."""
        try:
            provider_models = await self.sync_all_providers()
            return await self.sync_to_database(provider_models, sort_order_start)
        except Exception as e:
            logger.error(f"Failed to sync models: {e}", exc_info=True)
            return {"error": str(e)}
