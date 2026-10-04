"""channel message activity

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
"""

from alembic import op
import sqlalchemy as sa

from app.db.types import GUID

revision = "c6d7e8f9a0b1"
down_revision = "b5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        # Rebuilding this table would cascade-delete its deliveries and attachments.
        op.execute(
            "ALTER TABLE channel_messages ADD COLUMN source_message_id CHAR(32) "
            "REFERENCES messages(id) ON DELETE SET NULL"
        )
    else:
        op.add_column(
            "channel_messages",
            sa.Column(
                "source_message_id",
                GUID(),
                sa.ForeignKey(
                    "messages.id",
                    name="fk_channel_messages_source_message_id",
                    ondelete="SET NULL",
                ),
                nullable=True,
            ),
        )
    op.add_column(
        "channel_messages",
        sa.Column("tool_call_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(
            "fk_channel_messages_source_message_id",
            "channel_messages",
            type_="foreignkey",
        )
    op.drop_column("channel_messages", "tool_call_count")
    op.drop_column("channel_messages", "source_message_id")
