"""backfill assistant message session_id from chat

Revision ID: 1df57169d8aa
Revises: fbca37896f4f
"""

from alembic import op

revision = "1df57169d8aa"
down_revision = "fbca37896f4f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Provider handoff resumes each agent kind from its latest assistant
    # message's session_id; before this, every chat ran a single agent kind.
    op.execute(
        "UPDATE messages SET session_id = "
        "(SELECT chats.session_id FROM chats WHERE chats.id = messages.chat_id) "
        "WHERE role = 'assistant' AND session_id IS NULL"
    )


def downgrade() -> None:
    pass
