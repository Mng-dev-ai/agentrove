from alembic import op
import sqlalchemy as sa

from app.db.types import GUID, UTCDateTime

revision = "ed84c56cd8c4"
down_revision = "e3bdc269cf4a"
branch_labels = None
depends_on = None

DEVICE_SET_COLUMNS = (
    ("chats", "last_device_ids"),
    ("channel_messages", "device_ids"),
    ("automations", "device_ids"),
)


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
        "paired_devices",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "user_id",
            GUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("last_used_at", UTCDateTime(), nullable=True),
        sa.Column("revoked_at", UTCDateTime(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_paired_devices_user_id", "paired_devices", ["user_id"])
    op.create_table(
        "pairing_secrets",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("secret_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "user_id",
            GUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_pairing_secrets_user_id", "pairing_secrets", ["user_id"])
    op.create_table(
        "instance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instance_id", GUID(), nullable=False),
        *timestamps(),
    )
    op.add_column("refresh_tokens", sa.Column("device_id", GUID(), nullable=True))
    op.create_index(
        op.f("ix_refresh_tokens_device_id"), "refresh_tokens", ["device_id"]
    )
    for table, column in DEVICE_SET_COLUMNS:
        op.add_column(
            table, sa.Column(column, sa.JSON(), nullable=False, server_default="[]")
        )


def downgrade() -> None:
    for table, column in DEVICE_SET_COLUMNS:
        op.drop_column(table, column)
    op.execute("DELETE FROM refresh_tokens WHERE device_id IS NOT NULL")
    op.drop_index(op.f("ix_refresh_tokens_device_id"), table_name="refresh_tokens")
    op.drop_column("refresh_tokens", "device_id")
    op.drop_table("instance")
    op.drop_table("pairing_secrets")
    op.drop_table("paired_devices")
