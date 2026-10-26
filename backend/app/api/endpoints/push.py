from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.push import PushDeviceRegister
from app.services.push import PushService

router = APIRouter()


@router.post("/devices", status_code=status.HTTP_204_NO_CONTENT)
async def register_push_device(
    device: PushDeviceRegister,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await PushService.register_device(db, current_user.id, device.token, device.sandbox)


@router.delete("/devices/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_push_device(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await PushService.unregister_device(db, current_user.id, token)
