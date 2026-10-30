"""add induction case phase

Revision ID: 20260603_0001
Revises: 20260530_0002
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op


revision: str = "20260603_0001"
down_revision: str | None = "20260530_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE casephase ADD VALUE IF NOT EXISTS 'INDUCTION' AFTER 'IN'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely without rebuilding dependent columns.
    pass
