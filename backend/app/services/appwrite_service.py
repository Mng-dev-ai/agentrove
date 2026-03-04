import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class AppwriteService:
    @staticmethod
    def normalize_endpoint(endpoint: str) -> str:
        endpoint = endpoint.strip().rstrip("/")
        if not endpoint.startswith(("http://", "https://")):
            endpoint = f"https://{endpoint}"
        return endpoint

    @staticmethod
    async def validate_connection(
        endpoint: str, project_id: str, api_key: str
    ) -> tuple[bool, str | None, dict[str, Any] | None]:
        normalized_endpoint = AppwriteService.normalize_endpoint(endpoint)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{normalized_endpoint}/v1/projects/{project_id}",
                    headers={
                        "X-Appwrite-Project": project_id,
                        "X-Appwrite-Key": api_key,
                    },
                )
                if response.status_code == 200:
                    project_data = response.json()
                    project_info = {
                        "project_id": project_id,
                        "project_name": project_data.get("name", project_id),
                    }
                    return True, None, project_info
                elif response.status_code in (401, 403):
                    return False, "Invalid credentials", None
                elif response.status_code == 404:
                    return False, "Project not found", None
                return False, f"Connection failed: HTTP {response.status_code}", None
        except httpx.TimeoutException:
            return False, "Connection timed out", None
        except httpx.ConnectError:
            return False, "Could not connect to the specified endpoint", None
        except Exception as e:
            logger.error(f"Appwrite validation error: {e}")
            return False, str(e), None

    @staticmethod
    async def get_project_info(
        endpoint: str, project_id: str, api_key: str
    ) -> dict[str, Any] | None:
        normalized_endpoint = AppwriteService.normalize_endpoint(endpoint)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{normalized_endpoint}/v1/projects/{project_id}",
                    headers={
                        "X-Appwrite-Project": project_id,
                        "X-Appwrite-Key": api_key,
                    },
                )
                if response.status_code == 200:
                    project_data = response.json()
                    return {
                        "project_id": project_id,
                        "project_name": project_data.get("name", project_id),
                    }
        except Exception as e:
            logger.error(f"Failed to get Appwrite project info: {e}")
        return None
