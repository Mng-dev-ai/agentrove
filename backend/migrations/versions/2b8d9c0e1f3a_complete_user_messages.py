from alembic import op

revision = "2b8d9c0e1f3a"
down_revision = "b1e4f8bdad11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE messages SET stream_status = 'completed' "
        "WHERE role = 'user' AND stream_status = 'in_progress'"
    )


def downgrade() -> None:
    pass
