from alembic import op
import sqlalchemy as sa

from app.db.types import GUID

revision = "a7b8c9d0e1f2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("automations") as batch_op:
        batch_op.add_column(sa.Column("device_id", GUID(), nullable=True))
        batch_op.create_foreign_key(
            "fk_automations_device_id_paired_devices",
            "paired_devices",
            ["device_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("automations") as batch_op:
        batch_op.drop_constraint(
            "fk_automations_device_id_paired_devices", type_="foreignkey"
        )
        batch_op.drop_column("device_id")
