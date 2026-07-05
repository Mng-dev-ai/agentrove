# Revision ID: f7a8b9c0d1e2
# Revises: e3f4a5b6c7d8
# Create Date: 2026-07-05 00:00:00.000000

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from app.db.types import UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "f7a8b9c0d1e2"
down_revision: str | None = "e3f4a5b6c7d8"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("last_viewed_at", UTCDateTime(), nullable=True))
    # Backfill so pre-existing chats don't all flash unread after upgrade —
    # only activity after this feature ships should flag the dot.
    op.execute("UPDATE chats SET last_viewed_at = updated_at")


def downgrade() -> None:
    op.drop_column("chats", "last_viewed_at")
