from fastapi import HTTPException, status

from app.models.schemas import FileContentResponse
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


class GetFileContentAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str, file_path: str) -> FileContentResponse:
        try:
            file_data = await self._sandbox_service.get_file_content(
                sandbox_id, file_path
            )
            return FileContentResponse(**file_data)
        except SandboxException as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get file content: {str(exc)}",
            ) from exc
