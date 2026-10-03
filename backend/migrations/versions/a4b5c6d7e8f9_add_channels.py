"""add channels

Revision ID: a4b5c6d7e8f9
Revises: c9d0e1f2a3b4
"""

from alembic import op
import sqlalchemy as sa

from app.db.types import GUID, UTCDateTime

revision = "a4b5c6d7e8f9"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", UTCDateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "channels",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "user_id",
            GUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            GUID(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_channels_user_id", "channels", ["user_id"])
    op.create_index("ix_channels_workspace_id", "channels", ["workspace_id"])
    # Rebuilding chats with foreign keys enabled would cascade-delete its messages.
    op.execute(
        "ALTER TABLE chats ADD COLUMN channel_id CHAR(32) REFERENCES channels(id) ON DELETE CASCADE"
    )
    op.create_index("ix_chats_channel_id", "chats", ["channel_id"])
    op.create_table(
        "channel_members",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "channel_id",
            GUID(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "chat_id",
            GUID(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("model_id", sa.String(128), nullable=False),
        sa.Column("persona", sa.String(100)),
        sa.Column("thinking_mode", sa.String(50)),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("introduced", sa.Boolean(), nullable=False, server_default="0"),
        *timestamps(),
    )
    op.create_index("ix_channel_members_channel_id", "channel_members", ["channel_id"])
    op.create_table(
        "channel_messages",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "channel_id",
            GUID(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "member_id", GUID(), sa.ForeignKey("channel_members.id", ondelete="CASCADE")
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        *timestamps(),
        sa.UniqueConstraint(
            "channel_id", "seq", name="uq_channel_messages_channel_seq"
        ),
        sa.CheckConstraint(
            "status IN ('streaming', 'completed', 'cancelled', 'deleted')",
            name="ck_channel_message_status",
        ),
    )

    op.create_table(
        "channel_deliveries",
        sa.Column(
            "member_id",
            GUID(),
            sa.ForeignKey("channel_members.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "message_id",
            GUID(),
            sa.ForeignKey("channel_messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        *timestamps(),
    )


def downgrade() -> None:
    op.execute("DELETE FROM chats WHERE channel_id IS NOT NULL")
    op.drop_table("channel_deliveries")
    op.drop_table("channel_messages")
    op.drop_table("channel_members")
    op.drop_index("ix_chats_channel_id", table_name="chats")
    op.drop_column("chats", "channel_id")
    op.drop_table("channels")
