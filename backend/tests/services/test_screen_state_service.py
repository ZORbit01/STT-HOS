from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.domain.enums import AlertLevel, CasePhase, CaseType
from app.services.screen_state_service import _build_screen_cases, _screen_day_bounds


def test_screen_day_bounds_use_only_the_current_utc_day() -> None:
    now = datetime(2026, 5, 31, 14, 30, tzinfo=UTC)

    start, end = _screen_day_bounds(now)

    assert start == datetime(2026, 5, 31, tzinfo=UTC)
    assert end == datetime(2026, 6, 1, tzinfo=UTC)
    assert end - start == timedelta(days=1)


def _idle_case(room, case_code: str, scheduled_start: datetime):
    return SimpleNamespace(
        id=uuid4(),
        case_code=case_code,
        voice_case_code="A1",
        case_type=CaseType.SCHEDULED,
        current_phase=CasePhase.IDLE,
        alert_level=AlertLevel.NONE,
        procedure_name="Knee Arthroscopy",
        estimated_duration_min=90,
        original_scheduled_start=scheduled_start,
        scheduled_start=scheduled_start,
        actual_start_at=None,
        expected_end_at=None,
        actual_end_at=None,
        patient=None,
        patient_age=45,
        patient_gender="M",
        doctor=None,
        room=None,
        scheduled_room=room,
    )


def test_professional_idle_cases_keep_historical_schedule_instead_of_snapping_to_now() -> None:
    now = datetime(2026, 6, 1, 20, 56, tzinfo=UTC)
    scheduled_start = datetime(2026, 6, 1, 19, 0, tzinfo=UTC)
    room = SimpleNamespace(id=uuid4(), room_code="OR3")

    [screen_case] = _build_screen_cases([_idle_case(room, "S20260601006", scheduled_start)], now, "professional")

    assert screen_case.display_start == scheduled_start
    assert screen_case.planned_end == datetime(2026, 6, 1, 20, 30, tzinfo=UTC)


def test_visitor_idle_cases_still_slide_to_now() -> None:
    now = datetime(2026, 6, 1, 20, 56, tzinfo=UTC)
    scheduled_start = datetime(2026, 6, 1, 19, 0, tzinfo=UTC)
    room = SimpleNamespace(id=uuid4(), room_code="OR3")

    [screen_case] = _build_screen_cases([_idle_case(room, "S20260601006", scheduled_start)], now, "visitor")

    assert screen_case.display_start == now
    assert screen_case.planned_end == datetime(2026, 6, 1, 22, 26, tzinfo=UTC)
