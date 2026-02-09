from app.models.schemas import BrowserStatusResponse
from app.services.sandbox import SandboxService


class GetBrowserStatusAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> BrowserStatusResponse:
        result = await self._sandbox_service.get_browser_status(sandbox_id)
        return BrowserStatusResponse(running=result.get("running", False))
