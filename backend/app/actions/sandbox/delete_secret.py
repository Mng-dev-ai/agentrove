from fastapi import HTTPException, status

from app.models.schemas import MessageResponse
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


class DeleteSecretAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str, key: str) -> MessageResponse:
        try:
            await self._sandbox_service.delete_secret(sandbox_id, key)
            return MessageResponse(message=f"Secret {key} deleted successfully")
        except SandboxException as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete secret: {str(exc)}",
            ) from exc
