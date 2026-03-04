"""add pin and passwordless auth fields

Revision ID: a1b2c3d4e5f6
Revises: 118ec77cc12d
Create Date: 2026-02-27 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '118ec77cc12d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column('pin_enabled', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column(
        'user_settings',
        sa.Column('hashed_pin', sa.String(length=128), nullable=True),
    )
    op.add_column(
        'user_settings',
        sa.Column('passwordless_enabled', sa.Boolean(), nullable=False, server_default='false'),
    )

    op.create_table(
        'otp_codes',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('code', sa.String(length=32), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used', sa.Boolean(), nullable=False, server_default='false'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_otp_codes_user_id', 'otp_codes', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_otp_codes_user_id', table_name='otp_codes')
    op.drop_table('otp_codes')
    op.drop_column('user_settings', 'passwordless_enabled')
    op.drop_column('user_settings', 'hashed_pin')
    op.drop_column('user_settings', 'pin_enabled')
