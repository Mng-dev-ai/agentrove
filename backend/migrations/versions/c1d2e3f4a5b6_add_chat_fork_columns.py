from alembic import op
import sqlalchemy as sa

from app.db.types import GUID

revision = "c1d2e3f4a5b6"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None

COLUMNS = (
    ("forked_from_chat_id", GUID()),
    ("forked_from_message_id", GUID()),
    ("forked_from_title", sa.String(255)),
    ("fork_source_session_id", sa.String(128)),
    ("fork_agent_kind", sa.String(32)),
    ("forked_session_id", sa.String(128)),
)


def upgrade() -> None:
    for name, column_type in COLUMNS:
        op.add_column("chats", sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("chats", name)
