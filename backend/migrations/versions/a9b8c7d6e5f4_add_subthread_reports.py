from alembic import op
import sqlalchemy as sa
from app.db.migration_helpers import uuid_server_default
from app.db.types import GUID, UTCDateTime

revision = "a9b8c7d6e5f4"
down_revision = "d95e6132d914"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subthread_reports",
        sa.Column(
            "id", GUID(), primary_key=True, server_default=uuid_server_default()
        ),
        sa.Column(
            "parent_chat_id",
            GUID(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "child_chat_id",
            GUID(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "child_message_id",
            GUID(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "running",
                "pending",
                "waking",
                "covered",
                "acknowledged",
                "notified",
                name="subthreadreportstatus",
            ),
            server_default="running",
            nullable=False,
        ),
        sa.Column("outcome", sa.String(16), nullable=True),
        sa.Column("next_attempt_at", UTCDateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "wake_message_id",
            GUID(),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", UTCDateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "idx_subthread_reports_parent_status",
        "subthread_reports",
        ["parent_chat_id", "status"],
    )
    op.create_index(
        "idx_subthread_reports_wake_message_id",
        "subthread_reports",
        ["wake_message_id"],
    )


def downgrade() -> None:
    op.drop_table("subthread_reports")
    sa.Enum(name="subthreadreportstatus").drop(op.get_bind(), checkfirst=True)
