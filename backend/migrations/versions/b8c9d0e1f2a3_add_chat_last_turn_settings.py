# Revision ID: b8c9d0e1f2a3
# Revises: a1b2c3d4e5f6
# Create Date: 2026-07-18 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("last_model_id", sa.String(128), nullable=True))
    op.add_column(
        "chats", sa.Column("last_thinking_mode", sa.String(16), nullable=True)
    )
    op.add_column(
        "chats", sa.Column("last_persona_name", sa.String(255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("chats", "last_persona_name")
    op.drop_column("chats", "last_thinking_mode")
    op.drop_column("chats", "last_model_id")
