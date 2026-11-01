# Revision ID: c8d9e0f1a2b3
# Revises: b7c8d9e0f1a2
# Create Date: 2026-11-01 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.migration_helpers import uuid_server_default, now_server_default
from app.db.types import GUID, UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: str | None = "b7c8d9e0f1a2"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "memories",
        sa.Column("id", GUID(), server_default=uuid_server_default(), nullable=False),
        sa.Column("user_id", GUID(), nullable=False),
        sa.Column("workspace_id", GUID(), nullable=True),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("pinned", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("source_chat_id", GUID(), nullable=True),
        sa.Column("source_model_id", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            UTCDateTime(),
            server_default=now_server_default(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            UTCDateTime(),
            server_default=now_server_default(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["source_chat_id"], ["chats.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_memories_user_id_workspace_id",
        "memories",
        ["user_id", "workspace_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_memories_user_id_workspace_id", table_name="memories")
    op.drop_table("memories")
