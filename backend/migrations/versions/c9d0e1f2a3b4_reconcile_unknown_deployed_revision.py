# Revision ID: c9d0e1f2a3b4
# Revises: b8c9d0e1f2a3
# Create Date: 2026-08-13 00:00:00.000000

"""Reconcile a deployed revision whose migration never landed on main.

A deployed build once stamped databases with revision c9d0e1f2a3b4. This
pass-through revision re-anchors them into the chain so ``alembic upgrade head``
can resolve. It intentionally has no operations and must not be deleted while any
environment's alembic_version may still contain c9d0e1f2a3b4.
"""

from typing import Sequence

revision: str = "c9d0e1f2a3b4"
down_revision: str | None = "b8c9d0e1f2a3"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
