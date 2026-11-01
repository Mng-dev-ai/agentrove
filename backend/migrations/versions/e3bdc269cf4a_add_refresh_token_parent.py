from alembic import op
import sqlalchemy as sa

from app.db.types import GUID

revision = "e3bdc269cf4a"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("refresh_tokens", sa.Column("parent_id", GUID(), nullable=True))
    op.create_index(
        op.f("ix_refresh_tokens_parent_id"), "refresh_tokens", ["parent_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_refresh_tokens_parent_id"), table_name="refresh_tokens")
    op.drop_column("refresh_tokens", "parent_id")
