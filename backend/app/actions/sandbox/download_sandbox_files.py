from fastapi import HTTPException, Response, status

from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


class DownloadSandboxFilesAction:
    def __init__(self, sandbox_service: SandboxService) -> None:
        self._sandbox_service = sandbox_service

    async def execute(self, sandbox_id: str) -> Response:
        try:
            zip_bytes = await self._sandbox_service.generate_zip_download(sandbox_id)
            return Response(
                content=zip_bytes,
                media_type="application/zip",
                headers={
                    "Content-Disposition": f'attachment; filename="sandbox_{sandbox_id}.zip"'
                },
            )
        except SandboxException as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to generate zip file: {str(exc)}",
            ) from exc
