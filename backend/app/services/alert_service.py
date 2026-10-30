import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.domain.enums import AlertLevel, CasePhase
from app.models.orm import OperatingRoom, SurgicalCase

logger = logging.getLogger(__name__)

WARNING_MINUTES = 10
CRITICAL_MINUTES = settings.CLEANING_ALERT_MINUTES  # 15


def _predicted_end(case: SurgicalCase) -> datetime | None:
    """
    Return the predicted end for an active case.
    Uses expected_end_at (actual_start + duration) when available,
    falls back to scheduled_start + duration for cases not yet started.
    """
    from datetime import timedelta

    if case.expected_end_at:
        return case.expected_end_at
    if case.scheduled_start and case.estimated_duration_min:
        base = case.scheduled_start
        if base.tzinfo is None:
            base = base.replace(tzinfo=UTC)
        return base + timedelta(minutes=case.estimated_duration_min)
    return None


def _compute_alert(case: SurgicalCase, now: datetime) -> AlertLevel:
    if case.current_phase in (CasePhase.IDLE, CasePhase.COMPLETE):
        return AlertLevel.NONE

    end = _predicted_end(case)
    if end is None:
        return AlertLevel.NONE

    if end.tzinfo is None:
        end = end.replace(tzinfo=UTC)

    overrun_min = (now - end).total_seconds() / 60

    if overrun_min >= CRITICAL_MINUTES:
        return AlertLevel.CRITICAL
    if overrun_min >= WARNING_MINUTES:
        return AlertLevel.WARNING
    return AlertLevel.NONE


async def _check_unstarted_overdue(db: AsyncSession, broadcast_fn, now: datetime) -> None:
    """
    Shift any IDLE (unstarted, not completed) case whose scheduled_start is in the past.
    Uses the active case's live overrun floor when the room is in use, or now if room is idle.
    """
    from app.services.cascade_service import apply_cascade_shift
    from app.ws.messages import schedule_shifted_msg

    # Find all pending cases whose scheduled_start has passed
    result = await db.execute(
        select(SurgicalCase)
        .options(selectinload(SurgicalCase.scheduled_room).selectinload(OperatingRoom.active_case))
        .where(
            SurgicalCase.current_phase == CasePhase.IDLE,
            SurgicalCase.actual_end_at == None,  # noqa: E711
            SurgicalCase.actual_start_at == None,  # noqa: E711
            SurgicalCase.scheduled_start < now,
        )
    )
    overdue = result.scalars().all()
    if not overdue:
        return

    # Group by room — cascade per room once using now as floor
    room_codes_done: set[str] = set()
    for case in overdue:
        room = case.scheduled_room
        if not room or room.room_code in room_codes_done:
            continue
        room_codes_done.add(room.room_code)

        # Use the active case's predicted_end as the floor if the room is in use,
        # otherwise use now so the shift is minimal
        floor = now
        trigger_case_id = None
        active_code = ""
        if room.active_case_id:
            active = room.active_case
            if active:
                trigger_case_id = active.id
                active_code = active.case_code
                predicted_end = _predicted_end(active)
                floor = max(predicted_end, now) if predicted_end else now

        shifts = await apply_cascade_shift(
            room_code=room.room_code,
            predicted_end=floor,
            active_case_code=active_code,
            db=db,
            trigger_case_id=trigger_case_id,
        )
        if shifts:
            logger.info("Unstarted overdue shift: room=%s shifts=%d", room.room_code, len(shifts))
            from app.services.screen_feed_service import create_schedule_shift_feed_events

            await create_schedule_shift_feed_events(
                db,
                room_code=room.room_code,
                shifts=shifts,
                broadcast_fn=broadcast_fn,
            )
            await broadcast_fn(schedule_shifted_msg(room_code=room.room_code, shifts=shifts))


async def check_alerts(db: AsyncSession, broadcast_fn) -> None:
    """
    Check all active cases, update alert levels, trigger cascade shifts on new overruns.
    """
    from app.services.cascade_service import apply_cascade_shift
    from app.ws.messages import alert_msg

    now = datetime.now(UTC)

    result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.room),
            selectinload(SurgicalCase.scheduled_room),
        )
        .where(SurgicalCase.current_phase.notin_([CasePhase.IDLE, CasePhase.COMPLETE]))
    )
    cases = result.scalars().all()

    for case in cases:
        new_level = _compute_alert(case, now)
        level_changed = new_level != case.alert_level

        if level_changed:
            case.alert_level = new_level
            logger.info(
                "Alert updated: case=%s phase=%s level=%s",
                case.case_code,
                case.current_phase,
                new_level,
            )

        room = case.room or case.scheduled_room
        room_code = room.room_code if room else str(case.room_id or case.scheduled_room_id)

        end = _predicted_end(case)
        elapsed = (now - end).total_seconds() / 60 if end else 0.0

        # Broadcast alert only on level change
        if level_changed and new_level in (AlertLevel.WARNING, AlertLevel.CRITICAL):
            from app.services.timing_metadata_service import add_case_timing_event

            add_case_timing_event(
                db,
                case=case,
                event_type=f"{new_level.value}_ALERT_FIRED",
                source="SYSTEM",
                room_id=room.id if room else case.room_id or case.scheduled_room_id,
                planned_reference_at=end,
                actual_reference_at=now,
                expected_end_at=end,
            )
            from app.services.screen_feed_service import create_timing_feed_event

            await create_timing_feed_event(
                db,
                case=case,
                room_code=room_code,
                alert_level=new_level,
                elapsed_minutes=elapsed,
                broadcast_fn=broadcast_fn,
            )
            await broadcast_fn(
                alert_msg(
                    case_code=case.case_code,
                    room_code=room_code,
                    alert_level=new_level.value,
                    phase=case.current_phase.value,
                    elapsed_minutes=round(elapsed, 1),
                )
            )

        # Re-cascade every tick while the active case exceeds its planned end.
        # The alert threshold is separate from rescheduling: queued cases move as soon
        # as the active case's live floor passes their scheduled start.
        if elapsed > 0:
            shifts = await apply_cascade_shift(
                room_code=room_code,
                predicted_end=now,
                active_case_code=case.case_code,
                db=db,
                trigger_case_id=case.id,
            )
            if shifts:
                from app.services.screen_feed_service import create_schedule_shift_feed_events
                from app.ws.messages import schedule_shifted_msg

                await create_schedule_shift_feed_events(
                    db,
                    room_code=room_code,
                    shifts=shifts,
                    broadcast_fn=broadcast_fn,
                )
                await broadcast_fn(schedule_shifted_msg(room_code=room_code, shifts=shifts))

    # Shift any unstarted cases whose scheduled time has already passed
    await _check_unstarted_overdue(db, broadcast_fn, now)

    from app.services.screen_feed_service import cleanup_old_feed_events

    await cleanup_old_feed_events(db)

    await db.commit()

    from app.services.screen_state_service import get_screen_state
    from app.ws.messages import screen_state_msg

    for audience in ("professional", "visitor"):
        state = await get_screen_state(db, audience)
        await broadcast_fn(screen_state_msg(audience, state))


async def run_alert_loop(db_factory, broadcast_fn) -> None:
    logger.info("Alert loop started")
    while True:
        try:
            async with db_factory() as db:
                await check_alerts(db, broadcast_fn)
        except asyncio.CancelledError:
            logger.info("Alert loop cancelled")
            return
        except Exception:
            logger.exception("Error in alert loop — will retry in 60s")
        await asyncio.sleep(30)
