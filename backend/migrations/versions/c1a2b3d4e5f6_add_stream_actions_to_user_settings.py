# Revision ID: c1a2b3d4e5f6
# Revises: 05d565131567
# Create Date: 2026-06-17 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c1a2b3d4e5f6"
down_revision: str | None = "05d565131567"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("stream_actions", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "stream_actions")
