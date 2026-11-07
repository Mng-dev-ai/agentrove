import uuid

from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.types import GUID


class Instance(Base):
    __tablename__ = "instance"

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False)
