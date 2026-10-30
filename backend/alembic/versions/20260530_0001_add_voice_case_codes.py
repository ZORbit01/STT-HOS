"""add voice case codes

Revision ID: 20260530_0001
Revises: d7e8f9a0b1c2
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260530_0001"
down_revision: Union[str, Sequence[str], None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("surgical_cases", sa.Column("voice_case_code", sa.String(length=8), nullable=True))
    op.add_column("surgical_cases", sa.Column("voice_code_day", sa.Date(), nullable=True))
    op.create_index("ix_surgical_cases_voice_case_code", "surgical_cases", ["voice_case_code"])
    op.create_index("ix_surgical_cases_voice_code_day", "surgical_cases", ["voice_code_day"])


def downgrade() -> None:
    op.drop_index("ix_surgical_cases_voice_code_day", table_name="surgical_cases")
    op.drop_index("ix_surgical_cases_voice_case_code", table_name="surgical_cases")
    op.drop_column("surgical_cases", "voice_code_day")
    op.drop_column("surgical_cases", "voice_case_code")
