# Revision ID: b2c3d4e5f6a7
# Revises: a1c2e3f4b5d6
# Create Date: 2026-11-13 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1c2e3f4b5d6"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "settings_version", sa.Integer(), server_default="0", nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "settings_version")
