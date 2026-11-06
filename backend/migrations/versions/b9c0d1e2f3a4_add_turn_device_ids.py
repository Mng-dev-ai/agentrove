from alembic import op
import sqlalchemy as sa

from app.db.types import GUID

revision = "b9c0d1e2f3a4"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("chats") as batch_op:
        batch_op.add_column(sa.Column("last_device_id", GUID(), nullable=True))
        batch_op.create_foreign_key(
            "fk_chats_last_device_id_paired_devices",
            "paired_devices",
            ["last_device_id"],
            ["id"],
        )
    with op.batch_alter_table("channel_messages") as batch_op:
        batch_op.add_column(sa.Column("device_id", GUID(), nullable=True))
        batch_op.create_foreign_key(
            "fk_channel_messages_device_id_paired_devices",
            "paired_devices",
            ["device_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("channel_messages") as batch_op:
        batch_op.drop_constraint(
            "fk_channel_messages_device_id_paired_devices", type_="foreignkey"
        )
        batch_op.drop_column("device_id")
    with op.batch_alter_table("chats") as batch_op:
        batch_op.drop_constraint(
            "fk_chats_last_device_id_paired_devices", type_="foreignkey"
        )
        batch_op.drop_column("last_device_id")
