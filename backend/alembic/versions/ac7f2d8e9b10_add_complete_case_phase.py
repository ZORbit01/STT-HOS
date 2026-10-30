"""add_complete_case_phase

Revision ID: ac7f2d8e9b10
Revises: 9c1e2a7b4d6f
Create Date: 2026-05-15 00:00:00.000001

"""
from typing import Sequence, Union

from alembic import op


revision: str = "ac7f2d8e9b10"
down_revision: Union[str, Sequence[str], None] = "9c1e2a7b4d6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE casephase ADD VALUE IF NOT EXISTS 'COMPLETE'")
    op.execute(
        """
        UPDATE surgical_cases
        SET current_phase = 'COMPLETE'
        WHERE current_phase = 'IDLE'
          AND actual_end_at IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE surgical_cases
        SET actual_end_at = NULL
        WHERE current_phase IN ('OUT', 'CLEANING')
        """
    )
    op.execute(
        """
        UPDATE phase_events
        SET to_phase = 'COMPLETE'
        WHERE to_phase = 'IDLE'
          AND case_id IN (
            SELECT id FROM surgical_cases WHERE current_phase = 'COMPLETE'
          )
        """
    )


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely without rebuilding the type.
    pass
