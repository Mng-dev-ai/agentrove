from alembic import op
import sqlalchemy as sa

revision = "a6c328fe1290"
down_revision = "d95e6132d914"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("last_permission_mode", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("chats", "last_permission_mode")
