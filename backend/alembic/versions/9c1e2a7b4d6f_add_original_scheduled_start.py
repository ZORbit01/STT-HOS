"""add_original_scheduled_start

Revision ID: 9c1e2a7b4d6f
Revises: f2b9c0d4a1e7
Create Date: 2026-05-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9c1e2a7b4d6f"
down_revision: Union[str, Sequence[str], None] = "f2b9c0d4a1e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "surgical_cases",
        sa.Column("original_scheduled_start", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE surgical_cases SET original_scheduled_start = scheduled_start")
    op.alter_column("surgical_cases", "original_scheduled_start", nullable=False)


def downgrade() -> None:
    op.drop_column("surgical_cases", "original_scheduled_start")
