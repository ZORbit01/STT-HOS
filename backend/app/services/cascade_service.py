"""
Cascade shift service.

When a case's predicted_end is later than the scheduled_start of the next
case in the same room, we auto-shift all downstream IDLE cases in that room
so the schedule stays coherent.

Three triggers:
  1. Late start  — dispatch_service calls this right after setting actual_start_at (IN)
  2. Overrun     — alert_service calls this when WARNING/CRITICAL fires
  3. Case completes — dispatch_service/case_service calls this on COMPLETE so the
                      final actual end becomes the new floor for the next queued case

Returns a list of shift records (for the WS broadcast):
  [{"case_code": "A2", "old_start": "08:30", "new_start": "09:10"}, ...]
"""

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import CasePhase
from app.models.orm import OperatingRoom, SurgicalCase

logger = logging.getLogger(__name__)


async def apply_cascade_shift(
    room_code: str,
    predicted_end: datetime | None,
    active_case_code: str,
    db: AsyncSession,
    *,
    source: str = "CASCADE",
    trigger_case_id: UUID | None = None,
    trigger_phase_event_id: UUID | None = None,
    created_by_nurse_id: UUID | None = None,
    created_by_admin_id: UUID | None = None,
) -> list[dict]:
    """
    Shift all IDLE cases in `room_code` that would start before `predicted_end`.

    Returns list of {"case_code", "old_start", "new_start"} dicts, empty if nothing shifted.
    `predicted_end` is the expected finish of the currently active case.
    """
    if predicted_end is None:
        return []

    if predicted_end.tzinfo is None:
        predicted_end = predicted_end.replace(tzinfo=UTC)

    # Load room
    room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == room_code))
    room = room_result.scalar_one_or_none()
    if room is None:
        return []

    if trigger_case_id is None and active_case_code:
        trigger_result = await db.execute(
            select(SurgicalCase.id).where(SurgicalCase.case_code == active_case_code).limit(1)
        )
        trigger_case_id = trigger_result.scalar_one_or_none()

    # Load only pending (not yet started, not completed) IDLE cases in this room
    queue_result = await db.execute(
        select(SurgicalCase)
        .where(
            SurgicalCase.scheduled_room_id == room.id,
            SurgicalCase.current_phase == CasePhase.IDLE,
            SurgicalCase.actual_end_at.is_(None),
            SurgicalCase.actual_start_at.is_(None),
            SurgicalCase.case_code != active_case_code,
        )
        .order_by(SurgicalCase.scheduled_start)
    )
    queue = list(queue_result.scalars().all())

    shifts: list[dict] = []
    # The "floor" starts at predicted_end of the active case.
    # Each subsequent case must start no earlier than floor.
    floor = predicted_end

    for case in queue:
        start = case.scheduled_start
        if start.tzinfo is None:
            start = start.replace(tzinfo=UTC)

        if start >= floor:
            # This case and all after it are fine — stop cascading
            break

        old_start_iso = case.scheduled_start.isoformat()
        old_start = case.scheduled_start
        new_start = floor

        case.scheduled_start = new_start
        # Recompute expected_end_at for cases that haven't started (still IDLE)
        # No need — they haven't started yet, expected_end_at is only set on IN

        shifts.append(
            {
                "case_code": case.case_code,
                "old_start": old_start_iso,
                "new_start": new_start.isoformat(),
            }
        )

        from app.services.timing_metadata_service import add_schedule_change_event

        add_schedule_change_event(
            db,
            case=case,
            source=source,
            change_type="TIME",
            old_scheduled_start=old_start,
            new_scheduled_start=new_start,
            old_room_id=case.scheduled_room_id,
            new_room_id=case.scheduled_room_id,
            trigger_case_id=trigger_case_id,
            trigger_phase_event_id=trigger_phase_event_id,
            created_by_nurse_id=created_by_nurse_id,
            created_by_admin_id=created_by_admin_id,
        )

        logger.info(
            "Cascade shift: %s in %s moved from %s to %s",
            case.case_code,
            room_code,
            old_start_iso,
            new_start.isoformat(),
        )

        # The next case must start after this one ends
        floor = new_start + timedelta(minutes=case.estimated_duration_min)

    return shifts
