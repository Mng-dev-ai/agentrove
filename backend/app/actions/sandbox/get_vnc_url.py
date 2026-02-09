from app.models.schemas import VNCUrlResponse
from app.services.sandbox import SandboxService


class GetVncUrlAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> VNCUrlResponse:
        url = await self._sandbox_service.get_vnc_url(sandbox_id)
        return VNCUrlResponse(url=url)
