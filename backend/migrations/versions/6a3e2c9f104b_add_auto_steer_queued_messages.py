from alembic import op
import sqlalchemy as sa

revision = "6a3e2c9f104b"
down_revision = "1df57169d8aa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "auto_steer_queued_messages",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "auto_steer_queued_messages")
