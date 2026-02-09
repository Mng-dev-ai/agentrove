from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.attachments import (
    DownloadAttachmentAction,
    PreviewAttachmentAction,
    PreviewTempAttachmentAction,
)
from app.core.deps import (
    get_db,
    get_download_attachment_action,
    get_preview_attachment_action,
    get_preview_temp_attachment_action,
)
from app.core.security import get_current_user
from app.models.db_models import User

router = APIRouter()


@router.get("/attachments/temp/preview")
async def preview_temp_attachment(
    path: str,
    current_user: User = Depends(get_current_user),
    preview_temp_attachment_action: PreviewTempAttachmentAction = Depends(
        get_preview_temp_attachment_action
    ),
) -> FileResponse:
    return await preview_temp_attachment_action.execute(path, current_user)


@router.get("/attachments/{attachment_id}/preview")
async def preview_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    preview_attachment_action: PreviewAttachmentAction = Depends(
        get_preview_attachment_action
    ),
) -> FileResponse:
    return await preview_attachment_action.execute(attachment_id, current_user, db)


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    download_attachment_action: DownloadAttachmentAction = Depends(
        get_download_attachment_action
    ),
) -> FileResponse:
    return await download_attachment_action.execute(attachment_id, current_user, db)
