from alembic import op
import sqlalchemy as sa

revision = "b1c2d3e4f5a7"
down_revision = "a9b8c7d6e5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chats", sa.Column("last_permission_mode", sa.String(32), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("chats", "last_permission_mode")
