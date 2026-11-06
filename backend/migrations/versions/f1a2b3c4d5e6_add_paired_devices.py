from alembic import op
import sqlalchemy as sa

from app.db.types import GUID, UTCDateTime

revision = "f1a2b3c4d5e6"
down_revision = "e3bdc269cf4a"
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
    with op.batch_alter_table("refresh_tokens") as batch_op:
        batch_op.add_column(sa.Column("device_id", GUID(), nullable=True))
        batch_op.create_foreign_key(
            "fk_refresh_tokens_device_id_paired_devices",
            "paired_devices",
            ["device_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_refresh_tokens_device_id", ["device_id"])


def downgrade() -> None:
    with op.batch_alter_table("refresh_tokens") as batch_op:
        batch_op.drop_index("ix_refresh_tokens_device_id")
        batch_op.drop_constraint(
            "fk_refresh_tokens_device_id_paired_devices", type_="foreignkey"
        )
        batch_op.drop_column("device_id")
    op.drop_table("instance")
    op.drop_table("pairing_secrets")
    op.drop_table("paired_devices")
