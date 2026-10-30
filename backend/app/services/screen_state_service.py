import math
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.enums import AlertLevel, CasePhase, RoomStatus, ScreenTimingStatus
from app.models.orm import OperatingRoom, SurgicalCase
from app.schemas.screen import (
    ScreenCaseOut,
    ScreenGapOut,
    ScreenRoomOut,
    ScreenStateOut,
    ScreenTimelineOut,
)
from app.services.alert_service import CRITICAL_MINUTES

ScreenAudience = Literal["professional", "visitor"]
NEAR_END_MINUTES = 15
MIN_GAP_MINUTES = 20

PHASE_LABEL: dict[CasePhase, str] = {
    CasePhase.IDLE: "Scheduled",
    CasePhase.IN: "In room",
    CasePhase.INDUCTION: "Induction",
    CasePhase.INCISION: "Incision",
    CasePhase.CLOSURE: "Closing",
    CasePhase.OUT: "Out",
    CasePhase.CLEANING: "Cleaning",
    CasePhase.COMPLETE: "Complete",
    CasePhase.CANCELLED: "Cancelled",
}

TIMING_LABEL: dict[ScreenTimingStatus, str] = {
    ScreenTimingStatus.SCHEDULED: "Scheduled",
    ScreenTimingStatus.IN_PROGRESS: "On time",
    ScreenTimingStatus.NEAR_END: "Near end",
    ScreenTimingStatus.OVERRUN: "Overrun",
    ScreenTimingStatus.CRITICAL_OVERRUN: "Critical",
    ScreenTimingStatus.COMPLETE: "Complete",
    ScreenTimingStatus.IDLE: "Idle",
}


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _screen_day_bounds(now: datetime) -> tuple[datetime, datetime]:
    current = _aware(now)
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def _case_room(case: SurgicalCase) -> OperatingRoom:
    return case.room or case.scheduled_room


def _planned_start(case: SurgicalCase) -> datetime:
    if case.actual_start_at and case.current_phase != CasePhase.IDLE:
        return _aware(case.actual_start_at)
    return _aware(case.scheduled_start)


def _planned_end(case: SurgicalCase, display_start: datetime | None = None) -> datetime:
    if case.expected_end_at and case.current_phase != CasePhase.IDLE:
        return _aware(case.expected_end_at)
    return (display_start or _planned_start(case)) + timedelta(minutes=case.estimated_duration_min)


def _original_planned_start(case: SurgicalCase) -> datetime:
    return _aware(case.original_scheduled_start or case.scheduled_start)


def _original_planned_end(case: SurgicalCase) -> datetime:
    return _original_planned_start(case) + timedelta(minutes=case.estimated_duration_min)


def _patient_initials(first_name: str | None, last_name: str | None) -> str:
    letters = [part[:1].upper() for part in (first_name, last_name) if part]
    return ".".join(letters) + "." if letters else "P.--"


def _patient_label(case: SurgicalCase) -> str:
    patient = case.patient
    first = patient.first_name if patient else None
    last = patient.last_name if patient else None
    initials = _patient_initials(first, last)
    age = patient.age if patient and patient.age is not None else case.patient_age
    sex = patient.sex if patient and patient.sex else case.patient_gender
    age_part = str(age) if age is not None else "--"
    sex_part = (sex or "-")[:1].upper()
    return f"{initials} {age_part}{sex_part}"


def _public_patient_label(case: SurgicalCase) -> str:
    return _patient_label(case)


def _physician_label(case: SurgicalCase) -> str:
    if not case.doctor:
        return "Physician"
    name = f"{case.doctor.first_name} {case.doctor.last_name}".strip()
    return f"Dr. {name}" if name else "Physician"


def _timing_status(
    case: SurgicalCase,
    now: datetime,
    planned_end: datetime,
    overrun_minutes: int,
    remaining_minutes: int | None,
) -> ScreenTimingStatus:
    if case.current_phase in (CasePhase.COMPLETE, CasePhase.CANCELLED):
        return ScreenTimingStatus.COMPLETE
    if case.current_phase == CasePhase.IDLE:
        return ScreenTimingStatus.SCHEDULED
    if overrun_minutes >= CRITICAL_MINUTES:
        return ScreenTimingStatus.CRITICAL_OVERRUN
    if overrun_minutes > 0:
        return ScreenTimingStatus.OVERRUN
    if remaining_minutes is not None and remaining_minutes <= NEAR_END_MINUTES:
        return ScreenTimingStatus.NEAR_END
    return ScreenTimingStatus.IN_PROGRESS


def _alert_level(case: SurgicalCase, timing_status: ScreenTimingStatus) -> AlertLevel:
    if timing_status == ScreenTimingStatus.CRITICAL_OVERRUN:
        return AlertLevel.CRITICAL
    if timing_status == ScreenTimingStatus.OVERRUN:
        return AlertLevel.WARNING
    return case.alert_level


def _screen_case(
    case: SurgicalCase,
    now: datetime,
    audience: ScreenAudience,
    display_start_override: datetime | None = None,
) -> ScreenCaseOut:
    display_start = display_start_override or _planned_start(case)
    planned_end = _planned_end(case, display_start)
    original_planned_start = _original_planned_start(case)
    original_planned_end = _original_planned_end(case)
    is_complete = case.current_phase in (CasePhase.COMPLETE, CasePhase.CANCELLED)
    is_active = case.current_phase not in (CasePhase.IDLE, CasePhase.COMPLETE, CasePhase.CANCELLED)
    actual_end = _aware(case.actual_end_at) if case.actual_end_at else None
    visual_reference_end = now if is_active else actual_end
    can_show_overrun = (is_active or is_complete) and visual_reference_end is not None
    overrun_minutes = (
        max(0, math.ceil((visual_reference_end - planned_end).total_seconds() / 60)) if can_show_overrun else 0
    )
    remaining_minutes = round((planned_end - now).total_seconds() / 60) if is_active else None
    if is_complete and actual_end:
        visual_end = max(display_start, actual_end)
    elif can_show_overrun:
        visual_end = max(planned_end, visual_reference_end)
    else:
        visual_end = planned_end
    timing_status = _timing_status(case, now, planned_end, overrun_minutes, remaining_minutes)
    alert_level = _alert_level(case, timing_status)
    room = _case_room(case)
    patient_label = _patient_label(case)
    public_patient_label = _public_patient_label(case)

    return ScreenCaseOut(
        id=case.id,
        case_code=case.case_code,
        voice_case_code=case.voice_case_code,
        case_type=case.case_type,
        room_id=room.id,
        room_code=room.room_code,
        current_phase=case.current_phase,
        phase_label=PHASE_LABEL[case.current_phase],
        alert_level=alert_level,
        timing_status=timing_status,
        status_label=TIMING_LABEL[timing_status],
        public_status_label=PHASE_LABEL[case.current_phase] if is_active else TIMING_LABEL[timing_status],
        procedure_name=case.procedure_name,
        procedure_label=case.procedure_name,
        physician_label=_physician_label(case) if audience == "professional" else "Care team",
        patient_label=patient_label if audience == "professional" else public_patient_label,
        public_patient_label=public_patient_label,
        original_planned_start=original_planned_start,
        original_planned_end=original_planned_end,
        scheduled_start=_aware(case.scheduled_start),
        display_start=display_start,
        planned_end=planned_end,
        visual_end=visual_end,
        actual_start_at=_aware(case.actual_start_at) if case.actual_start_at else None,
        actual_end_at=actual_end,
        expected_end_at=_aware(case.expected_end_at) if case.expected_end_at else None,
        estimated_duration_min=case.estimated_duration_min,
        remaining_minutes=remaining_minutes,
        overrun_minutes=overrun_minutes,
        is_active=is_active,
        is_complete=is_complete,
    )


def _build_screen_cases(
    cases: list[SurgicalCase],
    now: datetime,
    audience: ScreenAudience,
) -> list[ScreenCaseOut]:
    raw_by_room: dict[str, list[SurgicalCase]] = {}
    for case in cases:
        if case.current_phase == CasePhase.CANCELLED and case.actual_start_at is None:
            continue
        raw_by_room.setdefault(_case_room(case).room_code, []).append(case)

    screen_cases: list[ScreenCaseOut] = []
    for room_cases in raw_by_room.values():
        ordered = sorted(room_cases, key=lambda case: (_planned_start(case), case.case_code))
        floor = now if audience == "visitor" else None

        for case in ordered:
            base_start = _planned_start(case)
            display_start = base_start

            # Visitor screens describe current expectations, so overdue queued
            # cases slide to now. Professional timelines keep historical slots
            # visible and only cascade against earlier cases in the same room.
            if floor is not None and case.current_phase == CasePhase.IDLE and base_start < floor:
                display_start = floor

            screen_case = _screen_case(case, now, audience, display_start)
            screen_cases.append(screen_case)
            floor = screen_case.visual_end if floor is None else max(floor, screen_case.visual_end)

    return sorted(screen_cases, key=lambda case: (case.room_code, case.display_start, case.case_code))


def _room_alert(cases: list[ScreenCaseOut]) -> AlertLevel:
    if any(case.alert_level == AlertLevel.CRITICAL for case in cases):
        return AlertLevel.CRITICAL
    if any(case.alert_level == AlertLevel.WARNING for case in cases):
        return AlertLevel.WARNING
    return AlertLevel.NONE


def _room_timing(cases: list[ScreenCaseOut]) -> ScreenTimingStatus:
    active = next((case for case in cases if case.is_active), None)
    return active.timing_status if active else ScreenTimingStatus.IDLE


def _progress_percent(active_case: ScreenCaseOut | None, now: datetime) -> int:
    if not active_case:
        return 0
    total = max(1, (active_case.planned_end - active_case.display_start).total_seconds())
    elapsed = max(0, (now - active_case.display_start).total_seconds())
    return min(100, round((elapsed / total) * 100))


def _gaps_by_room(cases_by_room: dict[str, list[ScreenCaseOut]]) -> list[ScreenGapOut]:
    gaps: list[ScreenGapOut] = []
    for room_code, room_cases in cases_by_room.items():
        ordered = sorted(room_cases, key=lambda case: case.display_start)
        for current, next_case in zip(ordered, ordered[1:], strict=False):
            gap_minutes = round((next_case.display_start - current.visual_end).total_seconds() / 60)
            if gap_minutes < MIN_GAP_MINUTES:
                continue
            gaps.append(
                ScreenGapOut(
                    room_id=current.room_id,
                    room_code=room_code,
                    start=current.visual_end,
                    end=next_case.display_start,
                    minutes=gap_minutes,
                    label=f"{gap_minutes}m open",
                )
            )
    return gaps


async def get_screen_state(db: AsyncSession, audience: ScreenAudience) -> ScreenStateOut:
    now = datetime.now(UTC)
    day_start, day_end = _screen_day_bounds(now)

    rooms_result = await db.execute(
        select(OperatingRoom).options(selectinload(OperatingRoom.active_case)).order_by(OperatingRoom.room_code)
    )
    rooms = list(rooms_result.scalars().all())

    cases_result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.room),
            selectinload(SurgicalCase.scheduled_room),
        )
        .where(
            SurgicalCase.scheduled_start >= day_start,
            SurgicalCase.scheduled_start < day_end,
        )
        .order_by(SurgicalCase.scheduled_start)
    )
    screen_cases = _build_screen_cases(list(cases_result.scalars().all()), now, audience)

    cases_by_room: dict[str, list[ScreenCaseOut]] = {}
    for case in screen_cases:
        cases_by_room.setdefault(case.room_code, []).append(case)

    gaps = _gaps_by_room(cases_by_room)
    gap_count_by_room: dict[str, int] = {}
    for gap in gaps:
        gap_count_by_room[gap.room_code] = gap_count_by_room.get(gap.room_code, 0) + 1

    screen_rooms: list[ScreenRoomOut] = []
    for room in rooms:
        room_cases = cases_by_room.get(room.room_code, [])
        active_case_code = room.active_case.case_code if room.active_case else None
        active_case = next((case for case in room_cases if case.case_code == active_case_code), None)
        if active_case is None:
            active_case = next((case for case in room_cases if case.is_active), None)
        timing = _room_timing(room_cases)
        alert = _room_alert(room_cases)
        phase = active_case.current_phase if active_case else CasePhase.IDLE
        screen_rooms.append(
            ScreenRoomOut(
                id=room.id,
                room_code=room.room_code,
                status=room.status if active_case else RoomStatus.AVAILABLE,
                active_case_code=active_case.case_code if active_case else None,
                phase=phase,
                phase_label=PHASE_LABEL[phase] if active_case else "Open",
                alert_level=alert,
                timing_status=timing,
                status_label=TIMING_LABEL[timing] if active_case else "Open",
                gap_count=gap_count_by_room.get(room.room_code, 0),
                progress_percent=_progress_percent(active_case, now),
            )
        )

    return ScreenStateOut(
        generated_at=now,
        audience=audience,
        timeline=ScreenTimelineOut(start_hour=0, end_hour=24, split_hour=12),
        rooms=screen_rooms,
        cases=screen_cases,
        gaps=gaps,
    )
