from fastapi import HTTPException, status

from app.models.schemas import BrowserStatusResponse
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


class StartBrowserAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str, url: str) -> BrowserStatusResponse:
        try:
            await self._sandbox_service.start_browser(sandbox_id, url)
            return BrowserStatusResponse(running=True, current_url=url)
        except SandboxException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to start browser: {str(exc)}",
            ) from exc
