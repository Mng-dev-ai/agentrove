import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class SupabaseService:
    @staticmethod
    def normalize_url(url: str) -> str:
        url = url.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        return url

    @staticmethod
    async def validate_connection(
        url: str, anon_key: str
    ) -> tuple[bool, str | None, dict[str, Any] | None]:
        normalized_url = SupabaseService.normalize_url(url)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{normalized_url}/rest/v1/",
                    headers={
                        "apikey": anon_key,
                        "Authorization": f"Bearer {anon_key}",
                    },
                )
                if response.status_code in (200, 401, 403, 404):
                    project_info = await SupabaseService.get_project_info(
                        normalized_url, anon_key
                    )
                    return True, None, project_info
                return False, f"Connection failed: HTTP {response.status_code}", None
        except httpx.TimeoutException:
            return False, "Connection timed out", None
        except httpx.ConnectError:
            return False, "Could not connect to the specified URL", None
        except Exception as e:
            logger.error(f"Supabase validation error: {e}")
            return False, str(e), None

    @staticmethod
    async def get_project_info(
        url: str, anon_key: str
    ) -> dict[str, Any] | None:
        normalized_url = SupabaseService.normalize_url(url)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{normalized_url}/rest/v1/",
                    headers={
                        "apikey": anon_key,
                        "Authorization": f"Bearer {anon_key}",
                    },
                )
                if response.status_code in (200, 401, 403, 404):
                    return {"url": normalized_url}
        except Exception as e:
            logger.error(f"Failed to get Supabase project info: {e}")
        return None
