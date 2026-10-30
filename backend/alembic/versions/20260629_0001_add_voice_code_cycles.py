"""add persistent voice code cycles

Revision ID: 20260629_0001
Revises: 20260614_0001
Create Date: 2026-06-29 00:00:00.000000

"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260629_0001"
down_revision: str | Sequence[str] | None = "20260614_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "voice_code_cycles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "voice_code_state",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("current_cycle_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["current_cycle_id"], ["voice_code_cycles.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column(
        "surgical_cases",
        sa.Column("voice_code_cycle_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_surgical_cases_voice_code_cycle_id",
        "surgical_cases",
        "voice_code_cycles",
        ["voice_code_cycle_id"],
        ["id"],
    )
    op.create_index(
        "ix_surgical_cases_voice_code_cycle_id",
        "surgical_cases",
        ["voice_code_cycle_id"],
    )

    legacy_cycle_id = uuid.uuid4()
    active_cycle_id = uuid.uuid4()
    op.execute(
        sa.text(
            f"""
            INSERT INTO voice_code_cycles (id, created_at)
            VALUES ('{legacy_cycle_id}'::uuid, CURRENT_TIMESTAMP - INTERVAL '1 microsecond'),
                   ('{active_cycle_id}'::uuid, CURRENT_TIMESTAMP)
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            INSERT INTO voice_code_state (id, current_cycle_id)
            VALUES (1, '{active_cycle_id}'::uuid)
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE surgical_cases
            SET voice_code_cycle_id = '{legacy_cycle_id}'::uuid
            WHERE voice_case_code IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE surgical_cases
            SET voice_code_cycle_id = '{active_cycle_id}'::uuid
            WHERE voice_case_code IS NOT NULL
              AND scheduled_start >= CURRENT_TIMESTAMP - INTERVAL '48 hours'
              AND current_phase NOT IN ('COMPLETE', 'CANCELLED')
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_surgical_cases_voice_code_cycle_id", table_name="surgical_cases")
    op.drop_constraint("fk_surgical_cases_voice_code_cycle_id", "surgical_cases", type_="foreignkey")
    op.drop_column("surgical_cases", "voice_code_cycle_id")
    op.drop_table("voice_code_state")
    op.drop_table("voice_code_cycles")
