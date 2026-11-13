# Revision ID: f5a6b7c8d9e0
# Revises: d4e5f6a7b8c9
# Create Date: 2026-11-13 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.types import GUID

# revision identifiers, used by Alembic.
revision: str = "f5a6b7c8d9e0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("automations", sa.Column("channel_id", GUID(), nullable=True))


def downgrade() -> None:
    op.drop_column("automations", "channel_id")
