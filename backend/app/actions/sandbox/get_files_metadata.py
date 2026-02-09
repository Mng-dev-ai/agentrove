from app.models.schemas import FileMetadata, SandboxFilesMetadataResponse
from app.services.sandbox import SandboxService


class GetFilesMetadataAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> SandboxFilesMetadataResponse:
        files = await self._sandbox_service.get_files_metadata(sandbox_id)
        return SandboxFilesMetadataResponse(files=[FileMetadata(**f) for f in files])
