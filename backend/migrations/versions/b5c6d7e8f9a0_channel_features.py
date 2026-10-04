"""channel permissions, shared worktrees and attachments

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
"""

from alembic import op
import sqlalchemy as sa

from app.db.types import GUID, UTCDateTime

revision = "b5c6d7e8f9a0"
down_revision = "a4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("worktree", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column("channels", sa.Column("branch", sa.String(255), nullable=True))
    op.add_column(
        "channel_members",
        sa.Column(
            "permission_mode", sa.String(32), nullable=False, server_default="default"
        ),
    )
    for kind, mode in {
        "antigravity": "yolo",
        "codex": "auto",
        "copilot": "agent",
        "cursor": "agent",
        "grok": "always-approve",
        "opencode": "build",
    }.items():
        op.execute(
            sa.text(
                "UPDATE channel_members SET permission_mode = :mode WHERE display_name = :kind OR display_name LIKE :prefix"
            ).bindparams(mode=mode, kind=kind, prefix=f"{kind}-%")
        )
    op.execute("UPDATE channel_members SET introduced = 0")
    op.create_table(
        "channel_message_attachments",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "message_id",
            GUID(),
            sa.ForeignKey("channel_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("file_url", sa.String(2048), nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("file_type", sa.String(10), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column(
            "created_at", UTCDateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_channel_message_attachments_message_id",
        "channel_message_attachments",
        ["message_id"],
    )


def downgrade() -> None:
    op.drop_table("channel_message_attachments")
    op.drop_column("channel_members", "permission_mode")
    op.drop_column("channels", "branch")
    op.drop_column("channels", "worktree")
