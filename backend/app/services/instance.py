from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.instance import Instance


async def get_instance_id(db: AsyncSession) -> UUID:
    query = select(Instance.instance_id).where(Instance.id == 1)
    instance_id: UUID | None = await db.scalar(query)
    if instance_id is not None:
        return instance_id
    await db.execute(
        insert(Instance).values(id=1, instance_id=uuid4()).on_conflict_do_nothing()
    )
    await db.commit()
    created_id: UUID = (await db.execute(query)).scalar_one()
    return created_id
