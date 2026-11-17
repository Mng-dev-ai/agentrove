# Revision ID: a7b8c9d0e1f2
# Revises: f5a6b7c8d9e0
# Create Date: 2026-11-17 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.types import UUIDSet

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f5a6b7c8d9e0"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chats", sa.Column("owed_report_device_ids", UUIDSet(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("chats", "owed_report_device_ids")
