"""set_first_user_as_admin

Revision ID: 01b9f7f33c2b
Revises: 37ff0751c998
Create Date: 2026-02-28 08:48:10.795177

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '01b9f7f33c2b'
down_revision: Union[str, None] = '37ff0751c998'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Set the first registered user as admin (superuser)
    # This ensures users upgrading from older versions get admin privileges
    op.execute("""
        UPDATE users
        SET is_superuser = true
        WHERE id = (
            SELECT id FROM users
            ORDER BY created_at ASC
            LIMIT 1
        )
    """)


def downgrade() -> None:
    # Revert: set the first user back to non-admin
    op.execute("""
        UPDATE users
        SET is_superuser = false
        WHERE id = (
            SELECT id FROM users
            ORDER BY created_at ASC
            LIMIT 1
        )
    """)
