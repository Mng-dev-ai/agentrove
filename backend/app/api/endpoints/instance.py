from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.schemas.auth import InstanceOut
from app.services.instance import get_instance_id

router = APIRouter()


@router.get("/instance", response_model=InstanceOut)
async def get_instance(db: AsyncSession = Depends(get_db)) -> InstanceOut:
    return InstanceOut(instance_id=await get_instance_id(db))
