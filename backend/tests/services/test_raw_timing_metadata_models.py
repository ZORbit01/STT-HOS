from app.models.orm import (
    CaseTimingEvent,
    InductionPhysicianAssignment,
    NurseShift,
    PhaseEvent,
    ScheduleChangeEvent,
)


def test_raw_timing_metadata_columns_are_registered() -> None:
    assert "nurse_shift_id" in PhaseEvent.__table__.columns
    assert "induction_physician_id" in PhaseEvent.__table__.columns

    assert {
        "session_id",
        "room_id",
        "nurse_id",
        "induction_physician_id",
        "started_at",
        "last_seen_at",
        "ended_at",
        "end_reason",
    }.issubset(NurseShift.__table__.columns.keys())

    assert {
        "old_scheduled_start",
        "new_scheduled_start",
        "trigger_case_id",
        "trigger_phase_event_id",
        "created_by_nurse_id",
        "created_by_admin_id",
    }.issubset(ScheduleChangeEvent.__table__.columns.keys())

    assert {
        "event_type",
        "planned_reference_at",
        "actual_reference_at",
        "expected_end_at",
        "trigger_phase_event_id",
    }.issubset(CaseTimingEvent.__table__.columns.keys())

    assert {
        "nurse_shift_id",
        "room_id",
        "nurse_id",
        "induction_physician_id",
        "assigned_at",
        "ended_at",
        "source",
    }.issubset(InductionPhysicianAssignment.__table__.columns.keys())
