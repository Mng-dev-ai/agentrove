from alembic import op
import sqlalchemy as sa

revision = "c2d3e4f5a6b8"
down_revision = "b1c2d3e4f5a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("subthread_reports", sa.Column("summary", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("subthread_reports", "summary")
