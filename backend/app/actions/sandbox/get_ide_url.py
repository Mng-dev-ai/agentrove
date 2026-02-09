from app.models.schemas import IDEUrlResponse
from app.services.sandbox import SandboxService


class GetIdeUrlAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> IDEUrlResponse:
        url = await self._sandbox_service.get_ide_url(sandbox_id)
        return IDEUrlResponse(url=url)
