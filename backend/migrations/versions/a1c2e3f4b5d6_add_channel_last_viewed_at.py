# Revision ID: a1c2e3f4b5d6
# Revises: c4d5e6f7a8b9
# Create Date: 2026-11-13 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.types import UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "a1c2e3f4b5d6"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "channels", sa.Column("last_viewed_at", UTCDateTime(), nullable=True)
    )
    op.execute("UPDATE channels SET last_viewed_at = updated_at")


def downgrade() -> None:
    op.drop_column("channels", "last_viewed_at")
