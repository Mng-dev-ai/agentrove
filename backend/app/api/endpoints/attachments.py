from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.core.deps import get_attachment_service
from app.db.session import get_db
from app.models.db_models.user import User
from app.services.attachment import AttachmentService
from app.services.exceptions import AttachmentException

router = APIRouter()


@router.get("/attachments/temp/preview")
async def preview_temp_attachment(
    path: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    attachment_service: AttachmentService = Depends(get_attachment_service),
) -> FileResponse:
    try:
        response = await attachment_service.get_temp_preview(path, current_user.id)
    except AttachmentException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    # The file body streams after the handler returns while yield deps stay
    # open — release the auth chain's session so a slow download doesn't pin
    # a pooled DB connection.
    await db.close()
    return response


@router.get("/attachments/{attachment_id}/preview")
async def preview_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    attachment_service: AttachmentService = Depends(get_attachment_service),
) -> FileResponse:
    try:
        response = await attachment_service.get_preview(
            attachment_id, current_user.id, db
        )
    except AttachmentException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    # Release before the body streams — see preview_temp_attachment.
    await db.close()
    return response


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    attachment_service: AttachmentService = Depends(get_attachment_service),
) -> FileResponse:
    try:
        response = await attachment_service.get_download(
            attachment_id, current_user.id, db
        )
    except AttachmentException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    # Release before the body streams — see preview_temp_attachment.
    await db.close()
    return response
