from alembic import op
import sqlalchemy as sa

from app.db.types import GUID

revision = "a7c3e91f5b2d"
down_revision = "d5e6f7a8b9c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing registrations can't be attributed to a paired device, so a later
    # revocation could not remove them; phones register again on next launch.
    op.execute("DELETE FROM push_deliveries")
    op.execute("DELETE FROM push_devices")
    with op.batch_alter_table("push_devices") as batch:
        batch.add_column(sa.Column("paired_device_id", GUID(), nullable=True))
        batch.create_foreign_key(
            "fk_push_devices_paired_device_id",
            "paired_devices",
            ["paired_device_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_index("ix_push_devices_paired_device_id", ["paired_device_id"])


def downgrade() -> None:
    with op.batch_alter_table("push_devices") as batch:
        batch.drop_index("ix_push_devices_paired_device_id")
        batch.drop_constraint("fk_push_devices_paired_device_id", type_="foreignkey")
        batch.drop_column("paired_device_id")
