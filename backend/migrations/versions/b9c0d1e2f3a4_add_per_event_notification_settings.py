from alembic import op
import sqlalchemy as sa

revision = "b9c0d1e2f3a4"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None

COLUMNS = (
    "notify_permission_requests",
    "notify_questions",
    "notify_completions",
    "notify_inbox_messages",
    "notify_sub_threads",
)


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column(
            "user_settings",
            sa.Column(column, sa.Boolean(), nullable=False, server_default="true"),
        )


def downgrade() -> None:
    for column in reversed(COLUMNS):
        op.drop_column("user_settings", column)
