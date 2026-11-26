"""add channel message has_render_ui

Revision ID: b8d2f4a6c1e3
Revises: a7c3e91f5b2d
"""

from alembic import op
import sqlalchemy as sa

revision = "b8d2f4a6c1e3"
down_revision = "a7c3e91f5b2d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channel_messages",
        sa.Column("has_render_ui", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("channel_messages", "has_render_ui")
