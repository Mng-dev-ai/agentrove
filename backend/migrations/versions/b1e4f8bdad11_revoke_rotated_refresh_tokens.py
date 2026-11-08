from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

from app.db.types import UTCDateTime

revision = "b1e4f8bdad11"
down_revision = "ed84c56cd8c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE refresh_tokens SET revoked_at = :now "
            "WHERE revoked_at IS NULL AND id IN "
            "(SELECT parent_id FROM refresh_tokens WHERE parent_id IS NOT NULL)"
        ).bindparams(
            sa.bindparam("now", datetime.now(timezone.utc), type_=UTCDateTime())
        )
    )


def downgrade() -> None:
    pass
