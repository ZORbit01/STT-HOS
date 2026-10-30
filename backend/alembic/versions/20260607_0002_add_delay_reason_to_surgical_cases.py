"""add delay reason fields to surgical cases

Revision ID: 20260607_0002
Revises: 20260607_0001
Create Date: 2026-06-07 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260607_0002"
down_revision: str | None = "20260607_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DELAY_REASON_CODES = (
    "INSTRUMENTS_NOT_READY",
    "PATIENT_NOT_READY",
    "ANESTHESIA_DELAY",
    "STAFFING_SHORTAGE",
    "SURGEON_LATE",
    "EQUIPMENT_ISSUE",
    "PREVIOUS_CASE_OVERRUN",
    "OTHER",
)


def upgrade() -> None:
    delay_reason_code = sa.Enum(*DELAY_REASON_CODES, name="delayreasoncode")
    delay_reason_code.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "surgical_cases",
        sa.Column("delay_reason_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("surgical_cases", "delay_reason_required", server_default=None)
    op.add_column("surgical_cases", sa.Column("delay_reason", delay_reason_code, nullable=True))
    op.add_column("surgical_cases", sa.Column("delay_reason_note", sa.String(length=256), nullable=True))


def downgrade() -> None:
    op.drop_column("surgical_cases", "delay_reason_note")
    op.drop_column("surgical_cases", "delay_reason")
    op.drop_column("surgical_cases", "delay_reason_required")

    sa.Enum(name="delayreasoncode").drop(op.get_bind(), checkfirst=True)
