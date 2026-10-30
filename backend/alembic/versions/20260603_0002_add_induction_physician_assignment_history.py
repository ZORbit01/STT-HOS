"""add induction physician assignment history

Revision ID: 20260603_0002
Revises: 20260603_0001
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260603_0002"
down_revision: str | None = "20260603_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.create_table(
        "induction_physician_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("nurse_shift_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("nurse_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("induction_physician_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="SESSION"),
        sa.ForeignKeyConstraint(["induction_physician_id"], ["induction_physicians.id"]),
        sa.ForeignKeyConstraint(["nurse_id"], ["nurse_accounts.id"]),
        sa.ForeignKeyConstraint(["nurse_shift_id"], ["nurse_shifts.id"]),
        sa.ForeignKeyConstraint(["room_id"], ["operating_rooms.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_induction_physician_assignments_shift_time",
        "induction_physician_assignments",
        ["nurse_shift_id", "assigned_at"],
    )

    op.execute(
        """
        INSERT INTO induction_physician_assignments (
            id,
            nurse_shift_id,
            room_id,
            nurse_id,
            induction_physician_id,
            assigned_at,
            ended_at,
            source
        )
        SELECT gen_random_uuid(), id, room_id, nurse_id, induction_physician_id, started_at, ended_at, 'BACKFILL'
        FROM nurse_shifts
        """
    )


def downgrade() -> None:
    op.drop_index("ix_induction_physician_assignments_shift_time", table_name="induction_physician_assignments")
    op.drop_table("induction_physician_assignments")
