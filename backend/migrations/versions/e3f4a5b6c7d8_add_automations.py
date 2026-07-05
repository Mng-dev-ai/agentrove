# Revision ID: e3f4a5b6c7d8
# Revises: d2e3f4a5b6c7
# Create Date: 2026-07-05 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.migration_helpers import uuid_server_default, now_server_default
from app.db.types import GUID, UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "e3f4a5b6c7d8"
down_revision: str | None = "d2e3f4a5b6c7"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "automations",
        sa.Column("id", GUID(), server_default=uuid_server_default(), nullable=False),
        sa.Column("user_id", GUID(), nullable=False),
        sa.Column("workspace_id", GUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("model_id", sa.String(length=255), nullable=False),
        sa.Column(
            "permission_mode",
            sa.String(length=32),
            server_default="bypassPermissions",
            nullable=False,
        ),
        sa.Column("thinking_mode", sa.String(length=50), nullable=True),
        sa.Column("worktree", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("plan_mode", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "selected_persona_name",
            sa.String(length=100),
            server_default="Default",
            nullable=False,
        ),
        sa.Column("cron_expression", sa.String(length=128), nullable=False),
        sa.Column(
            "timezone", sa.String(length=64), server_default="UTC", nullable=False
        ),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("next_run_at", UTCDateTime(), nullable=False),
        sa.Column("last_run_at", UTCDateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=now_server_default(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=now_server_default(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_automations_user_id", "automations", ["user_id"], unique=False)
    op.create_index(
        "idx_automations_enabled_next_run_at",
        "automations",
        ["enabled", "next_run_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_automations_enabled_next_run_at", table_name="automations")
    op.drop_index("idx_automations_user_id", table_name="automations")
    op.drop_table("automations")
