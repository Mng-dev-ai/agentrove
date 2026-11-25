from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.schemas.auth import InstanceOut
from app.services.instance import get_instance_id
from app.services.storage import StorageService

settings = get_settings()

router = APIRouter()


@router.get("/instance", response_model=InstanceOut)
async def get_instance(db: AsyncSession = Depends(get_db)) -> InstanceOut:
    return InstanceOut(
        instance_id=await get_instance_id(db),
        max_upload_size=settings.MAX_UPLOAD_SIZE,
        allowed_file_types=StorageService.allowed_file_types(),
    )
