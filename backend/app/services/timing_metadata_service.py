from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.domain.delay_reasoning import is_unexplained_delay
from app.models.orm import CaseTimingEvent, ScheduleChangeEvent, SurgicalCase


def add_case_timing_event(
    db: AsyncSession,
    *,
    case: SurgicalCase,
    event_type: str,
    source: str,
    room_id: UUID | None = None,
    planned_reference_at: datetime | None = None,
    actual_reference_at: datetime | None = None,
    expected_end_at: datetime | None = None,
    trigger_phase_event_id: UUID | None = None,
) -> CaseTimingEvent:
    event = CaseTimingEvent(
        case_id=case.id,
        room_id=room_id,
        event_type=event_type,
        planned_reference_at=planned_reference_at,
        actual_reference_at=actual_reference_at,
        expected_end_at=expected_end_at,
        trigger_phase_event_id=trigger_phase_event_id,
        source=source,
    )
    db.add(event)
    return event


def add_schedule_change_event(
    db: AsyncSession,
    *,
    case: SurgicalCase,
    source: str,
    change_type: str,
    old_scheduled_start: datetime | None,
    new_scheduled_start: datetime | None,
    old_room_id: UUID | None = None,
    new_room_id: UUID | None = None,
    trigger_case_id: UUID | None = None,
    trigger_phase_event_id: UUID | None = None,
    created_by_nurse_id: UUID | None = None,
    created_by_admin_id: UUID | None = None,
) -> ScheduleChangeEvent:
    event = ScheduleChangeEvent(
        case_id=case.id,
        old_scheduled_start=old_scheduled_start,
        new_scheduled_start=new_scheduled_start,
        old_room_id=old_room_id,
        new_room_id=new_room_id,
        source=source,
        change_type=change_type,
        trigger_case_id=trigger_case_id,
        trigger_phase_event_id=trigger_phase_event_id,
        created_by_nurse_id=created_by_nurse_id,
        created_by_admin_id=created_by_admin_id,
    )
    db.add(event)
    return event


async def _previous_case_actual_end(db: AsyncSession, case: SurgicalCase) -> datetime | None:
    """Most recent completed case scheduled in the same room before this one."""
    result = await db.execute(
        select(SurgicalCase.actual_end_at)
        .where(
            SurgicalCase.scheduled_room_id == case.scheduled_room_id,
            SurgicalCase.id != case.id,
            SurgicalCase.actual_end_at.is_not(None),
            SurgicalCase.scheduled_start < case.scheduled_start,
        )
        .order_by(SurgicalCase.scheduled_start.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def evaluate_delay_reason_requirement(db: AsyncSession, *, case: SurgicalCase) -> None:
    """
    Called once, right when a case transitions to IN. Flags `delay_reason_required`
    on the case if its late start is not explained by the previous case overrunning
    into it (gap between the room freeing up and this case's actual start).
    """
    if case.actual_start_at is None:
        return

    previous_end = await _previous_case_actual_end(db, case)
    case.delay_reason_required = is_unexplained_delay(
        actual_start_at=case.actual_start_at,
        scheduled_start=case.scheduled_start,
        previous_case_actual_end_at=previous_end,
        gap_threshold=timedelta(minutes=settings.DELAY_REASON_GAP_MINUTES),
    )
