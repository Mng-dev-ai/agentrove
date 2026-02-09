from fastapi import HTTPException, status

from app.models.schemas import UpdateFileResponse
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


class UpdateFileAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str, file_path: str, content: str) -> UpdateFileResponse:
        try:
            await self._sandbox_service.write_file(sandbox_id, file_path, content)
            return UpdateFileResponse(
                success=True,
                message=f"File {file_path} updated successfully",
            )
        except SandboxException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to update file: {str(exc)}",
            ) from exc
