from alembic import op
import sqlalchemy as sa

from app.db.types import GUID

revision = "d5e6f7a8b9c1"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "automations", sa.Column("channel_members", sa.JSON(), nullable=True)
    )
    op.drop_column("automations", "channel_id")


def downgrade() -> None:
    op.add_column("automations", sa.Column("channel_id", GUID(), nullable=True))
    op.drop_column("automations", "channel_members")
