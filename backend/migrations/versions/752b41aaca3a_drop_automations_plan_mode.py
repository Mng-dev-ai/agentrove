"""drop automations plan_mode

Revision ID: 752b41aaca3a
Revises: f7a8b9c0d1e2
Create Date: 2026-07-10 04:04:23.015106

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '752b41aaca3a'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Autogenerate also emitted server-default alter_columns from pre-existing
# SQLite dialect drift (UUID defaults on id columns); trimmed to just the
# plan_mode drop for the removed Codex Plan Mode feature.
def upgrade() -> None:
    op.drop_column('automations', 'plan_mode')


def downgrade() -> None:
    op.add_column('automations', sa.Column('plan_mode', sa.BOOLEAN(), server_default=sa.text("'false'"), nullable=False))
