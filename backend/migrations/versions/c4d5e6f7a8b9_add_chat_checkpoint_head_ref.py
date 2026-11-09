# Revision ID: c4d5e6f7a8b9
# Revises: 2b8d9c0e1f3a
# Create Date: 2026-11-09 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "2b8d9c0e1f3a"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_checkpoints",
        sa.Column("head_ref", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_checkpoints", "head_ref")
