from fastapi import HTTPException, status

from app.models.schemas import MessageResponse
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


class StopBrowserAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> MessageResponse:
        try:
            await self._sandbox_service.stop_browser(sandbox_id)
            return MessageResponse(message="Browser stopped")
        except SandboxException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to stop browser: {str(exc)}",
            ) from exc
