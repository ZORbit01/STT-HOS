"""add raw timing metadata

Revision ID: d7e8f9a0b1c2
Revises: c9a7d3f12b44
Create Date: 2026-05-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "d7e8f9a0b1c2"
down_revision: str | None = "c9a7d3f12b44"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "nurse_shifts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("nurse_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("induction_physician_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_reason", sa.String(length=32), nullable=True),
        sa.ForeignKeyConstraint(["induction_physician_id"], ["induction_physicians.id"]),
        sa.ForeignKeyConstraint(["nurse_id"], ["nurse_accounts.id"]),
        sa.ForeignKeyConstraint(["room_id"], ["operating_rooms.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_index("ix_nurse_shifts_room_last_seen", "nurse_shifts", ["room_id", "last_seen_at"])
    op.create_index("ix_nurse_shifts_nurse_started", "nurse_shifts", ["nurse_id", "started_at"])

    op.add_column("phase_events", sa.Column("nurse_shift_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("phase_events", sa.Column("induction_physician_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_phase_events_nurse_shift", "phase_events", "nurse_shifts", ["nurse_shift_id"], ["id"])
    op.create_foreign_key(
        "fk_phase_events_induction_physician",
        "phase_events",
        "induction_physicians",
        ["induction_physician_id"],
        ["id"],
    )

    op.create_table(
        "schedule_change_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("old_scheduled_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("new_scheduled_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("old_room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("new_room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("change_type", sa.String(length=32), nullable=False),
        sa.Column("trigger_case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("trigger_phase_event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_nurse_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_admin_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["case_id"], ["surgical_cases.id"]),
        sa.ForeignKeyConstraint(["created_by_admin_id"], ["admin_accounts.id"]),
        sa.ForeignKeyConstraint(["created_by_nurse_id"], ["nurse_accounts.id"]),
        sa.ForeignKeyConstraint(["new_room_id"], ["operating_rooms.id"]),
        sa.ForeignKeyConstraint(["old_room_id"], ["operating_rooms.id"]),
        sa.ForeignKeyConstraint(["trigger_case_id"], ["surgical_cases.id"]),
        sa.ForeignKeyConstraint(["trigger_phase_event_id"], ["phase_events.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedule_change_events_case_created", "schedule_change_events", ["case_id", "created_at"])

    op.create_table(
        "case_timing_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("planned_reference_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_reference_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expected_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trigger_phase_event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["case_id"], ["surgical_cases.id"]),
        sa.ForeignKeyConstraint(["room_id"], ["operating_rooms.id"]),
        sa.ForeignKeyConstraint(["trigger_phase_event_id"], ["phase_events.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_case_timing_events_case_created", "case_timing_events", ["case_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_case_timing_events_case_created", table_name="case_timing_events")
    op.drop_table("case_timing_events")
    op.drop_index("ix_schedule_change_events_case_created", table_name="schedule_change_events")
    op.drop_table("schedule_change_events")
    op.drop_constraint("fk_phase_events_induction_physician", "phase_events", type_="foreignkey")
    op.drop_constraint("fk_phase_events_nurse_shift", "phase_events", type_="foreignkey")
    op.drop_column("phase_events", "induction_physician_id")
    op.drop_column("phase_events", "nurse_shift_id")
    op.drop_index("ix_nurse_shifts_nurse_started", table_name="nurse_shifts")
    op.drop_index("ix_nurse_shifts_room_last_seen", table_name="nurse_shifts")
    op.drop_table("nurse_shifts")
