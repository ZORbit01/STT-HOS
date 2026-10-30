import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.enums import CasePhase, DelayReasonCode, InputSource, RoomStatus, TransitionOutcome
from app.domain.exceptions import (
    CancellationAlreadyRequestedError,
    CancellationNotRequestedError,
    CaseFrozenError,
    CaseNotFoundError,
    DelayReasonNotRequiredError,
    RoomNotFoundError,
)
from app.domain.state_machine import validate_transition
from app.models.orm import NurseShift, OperatingRoom, PhaseEvent, SurgicalCase
from app.services.nurse_shift_service import room_actor_metadata, session_metadata
from app.services.timing_metadata_service import add_case_timing_event, evaluate_delay_reason_requirement

logger = logging.getLogger(__name__)


async def list_today_cases(db: AsyncSession) -> list[SurgicalCase]:
    # Return cases from the last 48 hours so that:
    # - Today's cases always show
    # - Yesterday's cases still show (night shifts, dates that rolled over)
    # - Cases don't disappear just because the calendar date changed
    cutoff = datetime.now(UTC) - timedelta(hours=48)
    result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.companies),
            selectinload(SurgicalCase.scheduled_room),
            selectinload(SurgicalCase.induction_physician),
            selectinload(SurgicalCase.cancellation_requested_by_nurse),
        )
        .where(SurgicalCase.scheduled_start >= cutoff)
        .order_by(SurgicalCase.scheduled_start)
    )
    return list(result.scalars().all())


async def list_all_cases(db: AsyncSession) -> list[SurgicalCase]:
    """Return the complete case history for the admin case browser."""
    result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.companies),
            selectinload(SurgicalCase.scheduled_room),
            selectinload(SurgicalCase.induction_physician),
            selectinload(SurgicalCase.cancellation_requested_by_nurse),
        )
        .order_by(SurgicalCase.scheduled_start)
    )
    return list(result.scalars().all())


async def get_case(case_code: str, db: AsyncSession) -> SurgicalCase:
    result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.companies),
            selectinload(SurgicalCase.scheduled_room),
            selectinload(SurgicalCase.induction_physician),
            selectinload(SurgicalCase.cancellation_requested_by_nurse),
            selectinload(SurgicalCase.phase_events).selectinload(PhaseEvent.triggered_by_nurse),
            selectinload(SurgicalCase.phase_events).selectinload(PhaseEvent.induction_physician),
            selectinload(SurgicalCase.phase_events).selectinload(PhaseEvent.nurse_shift).selectinload(NurseShift.nurse),
            selectinload(SurgicalCase.phase_events)
            .selectinload(PhaseEvent.nurse_shift)
            .selectinload(NurseShift.induction_physician),
        )
        .where(SurgicalCase.case_code == case_code)
        .order_by(SurgicalCase.scheduled_start.desc())
        .limit(1)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise CaseNotFoundError(case_code)
    return case


async def submit_delay_reason(
    case_code: str,
    reason: DelayReasonCode,
    note: str | None,
    db: AsyncSession,
) -> SurgicalCase:
    """
    Nurse records why a case started late, when the delay wasn't auto-explained
    by the previous case overrunning into it. Set once, at case start.
    """
    case = await get_case(case_code, db)
    if not case.delay_reason_required:
        raise DelayReasonNotRequiredError(case_code)

    case.delay_reason = reason
    case.delay_reason_note = note
    case.delay_reason_required = False
    await db.commit()
    await db.refresh(case)
    return case


async def manual_transition(
    case_code: str,
    to_phase: CasePhase,
    nurse_id: str | None,
    db: AsyncSession,
    room_code: str | None = None,
) -> tuple[PhaseEvent, list[dict]]:
    """
    Button fallback — coordinator manually forces a phase change.
    Uses the same validate_transition() as the STT pipeline.

    When room_code is given it identifies the mic client's room and overrides
    the case's scheduled room, exactly like the STT path — the case starts in
    that room, room_reassigned is recorded, and the original room is freed.
    """
    case = await get_case(case_code, db)

    if case.cancellation_requested and to_phase != CasePhase.CANCELLED:
        raise CaseFrozenError(case_code)

    outcome = validate_transition(case.current_phase, to_phase)
    if room_code is not None:
        room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == room_code))
        room = room_result.scalar_one_or_none()
        if room is None:
            raise RoomNotFoundError(room_code)
        room_id = room.id
    else:
        room_id = case.room_id or case.scheduled_room_id
        room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == room_id))
        room = room_result.scalar_one_or_none()
    room_reassigned = (
        room.id != case.scheduled_room_id
        if room is not None
        else (case.room_id != case.scheduled_room_id if case.room_id else False)
    )
    metadata = await room_actor_metadata(db, room, nurse_id=nurse_id) if room else session_metadata(None)
    triggered_by_nurse_id = UUID(nurse_id) if nurse_id else metadata["triggered_by_nurse_id"]

    event = PhaseEvent(
        case_id=case.id,
        room_id=room_id,
        scheduled_room_id=case.scheduled_room_id,
        room_reassigned=room_reassigned,
        from_phase=case.current_phase,
        to_phase=to_phase,
        source=InputSource.BUTTON,
        outcome=outcome,
        raw_transcript=None,
        confidence_score=None,
        triggered_by_nurse_id=triggered_by_nurse_id,
        nurse_shift_id=metadata["nurse_shift_id"],
        induction_physician_id=metadata["induction_physician_id"],
        actual_time=datetime.now(UTC),
        delay_minutes=None,
    )
    db.add(event)
    await db.flush()

    if outcome == TransitionOutcome.ACCEPTED:
        case.current_phase = to_phase
        now = datetime.now(UTC)

        if to_phase == CasePhase.IN:
            # Assign the induction physician on shift at the moment the case starts (set once only)
            if case.induction_physician_id is None and metadata.get("induction_physician_id"):
                case.induction_physician_id = metadata["induction_physician_id"]
            # Hard constraint — a room can only have one active case at a time
            if room and room.active_case_id and room.active_case_id != case.id:
                from app.domain.exceptions import RoomOccupiedError

                occupied_result = await db.execute(select(SurgicalCase).where(SurgicalCase.id == room.active_case_id))
                occupied = occupied_result.scalar_one_or_none()
                raise RoomOccupiedError(
                    room_code=room.room_code,
                    active_case_code=occupied.case_code if occupied else str(room.active_case_id),
                )
            case.actual_start_at = now
            case.expected_end_at = now + timedelta(minutes=case.estimated_duration_min)
            await evaluate_delay_reason_requirement(db, case=case)
            add_case_timing_event(
                db,
                case=case,
                event_type="ACTUAL_START_RECORDED",
                source=InputSource.BUTTON.value,
                room_id=room.id if room else case.scheduled_room_id,
                planned_reference_at=case.scheduled_start,
                actual_reference_at=now,
                expected_end_at=case.expected_end_at,
                trigger_phase_event_id=event.id,
            )
            add_case_timing_event(
                db,
                case=case,
                event_type="EXPECTED_END_SET",
                source=InputSource.BUTTON.value,
                room_id=room.id if room else case.scheduled_room_id,
                planned_reference_at=case.scheduled_start,
                actual_reference_at=now,
                expected_end_at=case.expected_end_at,
                trigger_phase_event_id=event.id,
            )
            case.room_id = room.id if room else case.scheduled_room_id
            if room:
                room.status = RoomStatus.IN_USE
                room.active_case_id = case.id
        elif to_phase == CasePhase.OUT:
            # Patient leaving OR — surgery body is done
            logger.info("Case %s patient out at %s", case.case_code, now.strftime("%H:%M"))
        elif to_phase == CasePhase.COMPLETE:
            # Cleaning done — room is free again
            case.actual_end_at = now
            add_case_timing_event(
                db,
                case=case,
                event_type="ACTUAL_COMPLETION_RECORDED",
                source=InputSource.BUTTON.value,
                room_id=room.id if room else case.room_id or case.scheduled_room_id,
                planned_reference_at=case.expected_end_at,
                actual_reference_at=now,
                expected_end_at=case.expected_end_at,
                trigger_phase_event_id=event.id,
            )
            if room:
                room.status = RoomStatus.AVAILABLE
                room.active_case_id = None

        # Same as the STT path — a reassigned case must release its original room
        if room_reassigned and case.scheduled_room_id:
            orig_result = await db.execute(
                select(OperatingRoom).where(OperatingRoom.id == case.scheduled_room_id)
            )
            orig_room = orig_result.scalar_one_or_none()
            if orig_room and orig_room.active_case_id == case.id:
                orig_room.status = RoomStatus.AVAILABLE
                orig_room.active_case_id = None

    await db.commit()
    await db.refresh(event)

    # On case completion, cascade-shift the next queued cases using now as the floor.
    cascade_shifts: list[dict] = []
    if outcome == TransitionOutcome.ACCEPTED and to_phase == CasePhase.COMPLETE and room:
        from app.services.cascade_service import apply_cascade_shift

        cascade_shifts = await apply_cascade_shift(
            room_code=room.room_code,
            predicted_end=datetime.now(UTC),
            active_case_code=case_code,
            db=db,
            trigger_case_id=case.id,
            trigger_phase_event_id=event.id,
            created_by_nurse_id=triggered_by_nurse_id,
        )
        if cascade_shifts:
            await db.commit()

    logger.info(
        "Manual transition case=%s %s->%s outcome=%s nurse=%s shifts=%d",
        case_code,
        event.from_phase,
        to_phase,
        outcome,
        nurse_id,
        len(cascade_shifts),
    )
    return event, cascade_shifts


async def request_cancellation(
    case_code: str,
    nurse_id: str | None,
    source: InputSource,
    db: AsyncSession,
    raw_transcript: str | None = None,
    confidence_score: float | None = None,
) -> tuple[SurgicalCase, PhaseEvent]:
    """
    Nurse (or admin) flags a case for cancellation. Freezes the case — no further
    phase transitions are accepted until an admin confirms or the request is resolved.
    """
    case = await get_case(case_code, db)
    if case.cancellation_requested or case.current_phase == CasePhase.CANCELLED:
        raise CancellationAlreadyRequestedError(case_code)

    room_id = case.room_id or case.scheduled_room_id
    room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == room_id))
    room = room_result.scalar_one_or_none()
    metadata = await room_actor_metadata(db, room, nurse_id=nurse_id) if room else session_metadata(None)
    triggered_by_nurse_id = UUID(nurse_id) if nurse_id else metadata["triggered_by_nurse_id"]

    case.cancellation_requested = True
    case.cancellation_requested_at = datetime.now(UTC)
    case.cancellation_requested_by_nurse_id = triggered_by_nurse_id

    event = PhaseEvent(
        case_id=case.id,
        room_id=room_id,
        scheduled_room_id=case.scheduled_room_id,
        room_reassigned=case.room_id != case.scheduled_room_id if case.room_id else False,
        from_phase=case.current_phase,
        to_phase=case.current_phase,
        source=source,
        outcome=TransitionOutcome.REVIEW,
        raw_transcript=raw_transcript,
        confidence_score=confidence_score,
        triggered_by_nurse_id=triggered_by_nurse_id,
        nurse_shift_id=metadata["nurse_shift_id"],
        induction_physician_id=metadata["induction_physician_id"],
        actual_time=datetime.now(UTC),
        delay_minutes=None,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    await db.refresh(case)

    logger.info("Cancellation requested case=%s nurse=%s", case_code, nurse_id)
    return case, event


async def confirm_cancellation(
    case_code: str,
    admin_id: str | None,
    reason: str,
    db: AsyncSession,
) -> tuple[SurgicalCase, PhaseEvent]:
    """Admin confirms a pending cancellation request, moving the case to CANCELLED."""
    case = await get_case(case_code, db)
    if not case.cancellation_requested:
        raise CancellationNotRequestedError(case_code)

    return await _finalize_cancellation(case, admin_id, reason, db)


async def reject_cancellation(
    case_code: str,
    admin_id: str | None,
    db: AsyncSession,
) -> tuple[SurgicalCase, PhaseEvent]:
    """
    Admin rejects a pending cancellation request — the case unfreezes and
    continues from its current phase. The resolution is logged as a PhaseEvent
    (from == to, REJECTED) so the event log keeps the full request/deny trail.
    """
    case = await get_case(case_code, db)
    if not case.cancellation_requested:
        raise CancellationNotRequestedError(case_code)

    event = PhaseEvent(
        case_id=case.id,
        room_id=case.room_id or case.scheduled_room_id,
        scheduled_room_id=case.scheduled_room_id,
        room_reassigned=case.room_id != case.scheduled_room_id if case.room_id else False,
        from_phase=case.current_phase,
        to_phase=case.current_phase,
        source=InputSource.SYSTEM,
        outcome=TransitionOutcome.REJECTED,
        raw_transcript=None,
        confidence_score=None,
        triggered_by_nurse_id=None,
        nurse_shift_id=None,
        induction_physician_id=None,
        actual_time=datetime.now(UTC),
        delay_minutes=None,
    )
    db.add(event)

    case.cancellation_requested = False
    case.cancellation_requested_at = None
    case.cancellation_requested_by_nurse_id = None

    await db.commit()
    await db.refresh(case)
    await db.refresh(event)
    logger.info("Cancellation request rejected case=%s admin=%s", case_code, admin_id)
    return case, event


async def cancel_case_directly(
    case_code: str,
    admin_id: str | None,
    reason: str,
    db: AsyncSession,
) -> tuple[SurgicalCase, PhaseEvent]:
    """Admin cancels a case directly, without a prior nurse request."""
    case = await get_case(case_code, db)
    if case.current_phase == CasePhase.CANCELLED:
        raise CancellationAlreadyRequestedError(case_code)

    return await _finalize_cancellation(case, admin_id, reason, db)


async def _finalize_cancellation(
    case: SurgicalCase,
    admin_id: str | None,
    reason: str,
    db: AsyncSession,
) -> tuple[SurgicalCase, PhaseEvent]:
    room_id = case.room_id or case.scheduled_room_id
    room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == room_id))
    room = room_result.scalar_one_or_none()

    from_phase = case.current_phase
    now = datetime.now(UTC)

    event = PhaseEvent(
        case_id=case.id,
        room_id=room_id,
        scheduled_room_id=case.scheduled_room_id,
        room_reassigned=case.room_id != case.scheduled_room_id if case.room_id else False,
        from_phase=from_phase,
        to_phase=CasePhase.CANCELLED,
        source=InputSource.SYSTEM,
        outcome=TransitionOutcome.ACCEPTED,
        raw_transcript=None,
        confidence_score=None,
        triggered_by_nurse_id=None,
        nurse_shift_id=None,
        induction_physician_id=None,
        actual_time=now,
        delay_minutes=None,
    )
    db.add(event)
    await db.flush()

    case.current_phase = CasePhase.CANCELLED
    case.cancellation_requested = False
    case.cancellation_reason = reason
    case.cancellation_confirmed_at = now
    case.cancellation_confirmed_by_admin_id = UUID(admin_id) if admin_id else None
    if from_phase != CasePhase.IDLE:
        case.actual_end_at = now

    if room and room.active_case_id == case.id:
        room.status = RoomStatus.AVAILABLE
        room.active_case_id = None

    await db.commit()
    await db.refresh(event)
    await db.refresh(case)

    logger.info("Cancellation confirmed case=%s admin=%s", case.case_code, admin_id)
    return case, event
