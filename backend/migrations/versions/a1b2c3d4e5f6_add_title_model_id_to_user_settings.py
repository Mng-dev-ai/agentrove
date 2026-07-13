# Revision ID: a1b2c3d4e5f6
# Revises: 752b41aaca3a
# Create Date: 2026-07-13 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "752b41aaca3a"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "title_model_id",
            sa.String(length=128),
            nullable=False,
            server_default="haiku",
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "title_model_id")
