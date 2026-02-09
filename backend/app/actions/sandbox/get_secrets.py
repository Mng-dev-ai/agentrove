from fastapi import HTTPException, status

from app.models.schemas import SecretResponse, SecretsListResponse
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


class GetSecretsAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> SecretsListResponse:
        try:
            secrets = await self._sandbox_service.get_secrets(sandbox_id)
            return SecretsListResponse(secrets=[SecretResponse(**s) for s in secrets])
        except SandboxException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get secrets: {str(exc)}",
            ) from exc
