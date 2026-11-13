# Revision ID: d4e5f6a7b8c9
# Revises: c3d4e5f6a7b8
# Create Date: 2026-11-13 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.types import UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "channel_members", sa.Column("removed_at", UTCDateTime(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("channel_members", "removed_at")
