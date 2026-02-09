from app.models.schemas import PortPreviewLink, PreviewLinksResponse
from app.services.sandbox import SandboxService


class GetPreviewLinksAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> PreviewLinksResponse:
        links = await self._sandbox_service.get_preview_links(sandbox_id)
        return PreviewLinksResponse(links=[PortPreviewLink(**link) for link in links])
