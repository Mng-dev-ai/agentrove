"""add channel parent chat, instructions and owed report

Revision ID: c9e1a3b5d7f2
Revises: b8d2f4a6c1e3
"""

from alembic import op
import sqlalchemy as sa

from app.db.types import GUID, UUIDSet

revision = "c9e1a3b5d7f2"
down_revision = "b8d2f4a6c1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("channels") as batch:
        batch.add_column(sa.Column("parent_chat_id", GUID(), nullable=True))
        batch.add_column(sa.Column("instructions", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column(
                "owed_report_device_ids", UUIDSet(none_as_null=True), nullable=True
            )
        )
        batch.create_foreign_key(
            "fk_channels_parent_chat_id",
            "chats",
            ["parent_chat_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_channels_parent_chat_id", ["parent_chat_id"])


def downgrade() -> None:
    with op.batch_alter_table("channels") as batch:
        batch.drop_index("ix_channels_parent_chat_id")
        batch.drop_constraint("fk_channels_parent_chat_id", type_="foreignkey")
        batch.drop_column("owed_report_device_ids")
        batch.drop_column("instructions")
        batch.drop_column("parent_chat_id")
