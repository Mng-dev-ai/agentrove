# Revision ID: b7c8d9e0f1a2
# Revises: a6c328fe1290
# Create Date: 2026-10-31 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.migration_helpers import uuid_server_default, now_server_default
from app.db.types import GUID, UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "b7c8d9e0f1a2"
down_revision: str | None = "a6c328fe1290"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inbox_items",
        sa.Column("id", GUID(), server_default=uuid_server_default(), nullable=False),
        sa.Column("user_id", GUID(), nullable=False),
        sa.Column("chat_id", GUID(), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("read_at", UTCDateTime(), nullable=True),
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
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_inbox_items_user_id_created_at",
        "inbox_items",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_inbox_items_user_id_created_at", table_name="inbox_items")
    op.drop_table("inbox_items")
