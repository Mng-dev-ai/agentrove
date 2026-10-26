from alembic import op
import sqlalchemy as sa
from app.db.types import GUID, UTCDateTime

revision = "d95e6132d914"
down_revision = "6a3e2c9f104b"
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
        "push_devices",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column(
            "user_id",
            GUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(200), nullable=False, unique=True),
        sa.Column("sandbox", sa.Boolean(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])
    op.create_table(
        "push_deliveries",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("event_key", sa.String(255), nullable=False),
        sa.Column(
            "device_id",
            GUID(),
            sa.ForeignKey("push_devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.String(512), nullable=False),
        sa.Column("path", sa.String(255), nullable=False),
        sa.Column("collapse_id", sa.String(64), nullable=False),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.Column("next_attempt_at", UTCDateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("finished_at", UTCDateTime(), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("event_key", "device_id"),
    )
    op.create_index(
        "ix_push_deliveries_next_attempt_at", "push_deliveries", ["next_attempt_at"]
    )


def downgrade() -> None:
    op.drop_table("push_deliveries")
    op.drop_table("push_devices")
