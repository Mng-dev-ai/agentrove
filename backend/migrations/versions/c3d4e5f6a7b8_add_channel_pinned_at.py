# Revision ID: c3d4e5f6a7b8
# Revises: b2c3d4e5f6a7
# Create Date: 2026-11-13 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.types import UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("channels", sa.Column("pinned_at", UTCDateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("channels", "pinned_at")
