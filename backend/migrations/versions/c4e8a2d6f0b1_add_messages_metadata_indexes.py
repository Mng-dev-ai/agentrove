"""add messages metadata indexes

Revision ID: c4e8a2d6f0b1
Revises: b8d2f4a6c1e3
"""

from alembic import op
import sqlalchemy as sa

revision = "c4e8a2d6f0b1"
down_revision = "b8d2f4a6c1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_messages_chat_id_role_deleted_created",
        "messages",
        ["chat_id", "role", "deleted_at", "created_at"],
        unique=False,
    )
    op.drop_index("idx_messages_chat_id_role_deleted", table_name="messages")
    op.create_index(
        "idx_messages_in_progress_assistant",
        "messages",
        ["stream_status", "role"],
        unique=False,
        sqlite_where=sa.text(
            "stream_status = 'in_progress' AND role = 'assistant' "
            "AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("idx_messages_in_progress_assistant", table_name="messages")
    op.create_index(
        "idx_messages_chat_id_role_deleted",
        "messages",
        ["chat_id", "role", "deleted_at"],
        unique=False,
    )
    op.drop_index("idx_messages_chat_id_role_deleted_created", table_name="messages")
