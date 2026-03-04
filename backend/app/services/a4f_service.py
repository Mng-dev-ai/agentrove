import logging
from typing import Any

import httpx

A4F_BASE_URL = "https://api.a4f.co/v1"

logger = logging.getLogger(__name__)


class A4FService:
    @staticmethod
    async def fetch_models(api_key: str) -> tuple[bool, str | None, list[dict[str, Any]]]:
        """Fetch available models from A4F API.

        Returns:
            Tuple of (success, error_message, models_list)
        """
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{A4F_BASE_URL}/models",
                    headers=headers,
                )

                if response.status_code == 401:
                    return False, "Invalid API key", []

                if response.status_code != 200:
                    return False, f"API returned status {response.status_code}", []

                data = response.json()
                seen_ids: set[str] = set()
                models: list[dict[str, Any]] = []

                for model in data.get("data", []):
                    raw_model_id = model.get("id", "")
                    if raw_model_id:
                        # Extract model name from A4F format: "provider-x/model-name" -> "model-name"
                        # A4F API expects just the model name without provider prefix
                        parts = raw_model_id.split("/")
                        model_id = parts[-1] if len(parts) > 1 else raw_model_id

                        # Skip duplicates (same model from different providers)
                        if model_id in seen_ids:
                            continue
                        seen_ids.add(model_id)

                        # Convert kebab-case to title case for display name
                        display_name = model_id.replace("-", " ").title()

                        models.append({
                            "model_id": model_id,
                            "name": display_name,
                            "enabled": True,
                        })

                return True, None, models

        except httpx.TimeoutException:
            return False, "Request timed out", []
        except httpx.HTTPError as e:
            logger.error("A4F API error: %s", e)
            return False, f"Connection failed: {str(e)}", []
        except Exception as e:
            logger.error("A4F unexpected error: %s", e)
            return False, f"Unexpected error: {str(e)}", []

    @staticmethod
    async def validate_connection(api_key: str) -> tuple[bool, str | None]:
        """Validate A4F API key by fetching models.

        Returns:
            Tuple of (is_valid, error_message)
        """
        success, error, _ = await A4FService.fetch_models(api_key)
        return success, error
