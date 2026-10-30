import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import CasePhase, InputSource, RoomStatus, TransitionOutcome
from app.domain.exceptions import CancellationAlreadyRequestedError, CaseFrozenError
from app.domain.state_machine import validate_transition
from app.models.orm import OperatingRoom, PhaseEvent, SurgicalCase
from app.services.nurse_shift_service import room_actor_metadata
from app.services.timing_metadata_service import add_case_timing_event, evaluate_delay_reason_requirement
from app.services.voice_case_code_service import resolve_voice_case_code
from app.stt.confidence_gate import ConfidenceDecision, evaluate_confidence
from app.stt.pipeline_types import DispatchPayload

logger = logging.getLogger(__name__)

# Injected by main.py after startup so dispatch_service can broadcast cascade shifts.
# Runtime wires this broadcaster at startup so dispatch stays independent of FastAPI.
_broadcast_fn = None


def set_broadcast(fn) -> None:
    global _broadcast_fn
    _broadcast_fn = fn


async def handle_dispatch(
    payload: DispatchPayload,
    db: AsyncSession,
) -> PhaseEvent | None:
    case = await resolve_voice_case_code(db, payload.case_code)
    if case is not None:
        logger.info(
            "dispatch: resolved voice_case_code=%s to case_code=%s",
            payload.case_code,
            case.case_code,
        )
        payload.case_code = case.case_code
    else:
        case_result = await db.execute(
            select(SurgicalCase)
            .where(SurgicalCase.case_code == payload.case_code)
            .order_by(SurgicalCase.scheduled_start.desc())
            .limit(1)
        )
        case = case_result.scalar_one_or_none()
    if case is None:
        logger.warning("dispatch: unknown case_code=%s — dropped", payload.case_code)
        return None

    if payload.to_phase == CasePhase.CANCELLED:
        return await _handle_cancellation_request(payload, case, db)

    if case.cancellation_requested:
        logger.info("dispatch: case=%s is frozen pending cancellation review — dropped", case.case_code)
        return None

    _sync_payload_to_case_state(payload, case)

    room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == payload.room_id))
    room = room_result.scalar_one_or_none()
    if room is None:
        logger.warning("dispatch: unknown room_code=%s — dropped", payload.room_id)
        return None

    now = datetime.now(UTC)
    room_reassigned = room.id != case.scheduled_room_id
    metadata = await room_actor_metadata(db, room)

    # Delay relative to scheduled start
    delay_minutes: float | None = None
    if case.scheduled_start:
        delta = now - case.scheduled_start
        delay_minutes = round(delta.total_seconds() / 60, 1)

    event = PhaseEvent(
        case_id=case.id,
        room_id=room.id,
        scheduled_room_id=case.scheduled_room_id,
        room_reassigned=room_reassigned,
        from_phase=payload.from_phase,
        to_phase=payload.to_phase,
        source=payload.source,
        outcome=payload.outcome,
        raw_transcript=payload.raw_transcript,
        confidence_score=payload.confidence,
        triggered_by_nurse_id=metadata["triggered_by_nurse_id"],
        nurse_shift_id=metadata["nurse_shift_id"],
        induction_physician_id=metadata["induction_physician_id"],
        actual_time=now,
        delay_minutes=delay_minutes,
    )
    db.add(event)
    await db.flush()

    if payload.outcome == TransitionOutcome.ACCEPTED:
        case.current_phase = payload.to_phase
        case.room_id = room.id

        if payload.to_phase == CasePhase.IN:
            # Assign the induction physician on shift at the moment the case starts (set once only)
            if case.induction_physician_id is None and metadata.get("induction_physician_id"):
                case.induction_physician_id = metadata["induction_physician_id"]
            # Hard constraint — reject if a different case is already active in this room
            if room.active_case_id and room.active_case_id != case.id:
                from app.domain.exceptions import RoomOccupiedError

                occupied_result = await db.execute(select(SurgicalCase).where(SurgicalCase.id == room.active_case_id))
                occupied = occupied_result.scalar_one_or_none()
                raise RoomOccupiedError(
                    room_code=room.room_code,
                    active_case_code=occupied.case_code if occupied else str(room.active_case_id),
                )
            # Surgery actually started — record actual start and compute expected end
            case.actual_start_at = now
            case.expected_end_at = now + timedelta(minutes=case.estimated_duration_min)
            await evaluate_delay_reason_requirement(db, case=case)
            add_case_timing_event(
                db,
                case=case,
                event_type="ACTUAL_START_RECORDED",
                source=payload.source.value,
                room_id=room.id,
                planned_reference_at=case.scheduled_start,
                actual_reference_at=now,
                expected_end_at=case.expected_end_at,
                trigger_phase_event_id=event.id,
            )
            add_case_timing_event(
                db,
                case=case,
                event_type="EXPECTED_END_SET",
                source=payload.source.value,
                room_id=room.id,
                planned_reference_at=case.scheduled_start,
                actual_reference_at=now,
                expected_end_at=case.expected_end_at,
                trigger_phase_event_id=event.id,
            )
            room.status = RoomStatus.IN_USE
            room.active_case_id = case.id
            logger.info(
                "Case %s started at %s, expected end %s",
                case.case_code,
                now.strftime("%H:%M"),
                case.expected_end_at.strftime("%H:%M"),
            )
            # Late-start cascade: if actual start is after scheduled start,
            # expected_end shifts forward and may push downstream cases.
            from app.services.cascade_service import apply_cascade_shift
            from app.ws.messages import schedule_shifted_msg

            shifts = await apply_cascade_shift(
                room_code=room.room_code,
                predicted_end=case.expected_end_at,
                active_case_code=case.case_code,
                db=db,
                trigger_case_id=case.id,
                trigger_phase_event_id=event.id,
                created_by_nurse_id=metadata["triggered_by_nurse_id"],
            )
            if shifts and _broadcast_fn is not None:
                from app.services.screen_feed_service import create_schedule_shift_feed_events

                await create_schedule_shift_feed_events(
                    db,
                    room_code=room.room_code,
                    shifts=shifts,
                    broadcast_fn=_broadcast_fn,
                )
                await _broadcast_fn(schedule_shifted_msg(room_code=room.room_code, shifts=shifts))

        elif payload.to_phase == CasePhase.OUT:
            # Patient leaving OR — surgery body done
            logger.info("Case %s patient out at %s", case.case_code, now.strftime("%H:%M"))

        elif payload.to_phase == CasePhase.CLEANING:
            # Room is being cleaned — log the time but case stays active
            logger.info("Case %s entered CLEANING phase at %s", case.case_code, now.strftime("%H:%M"))

        elif payload.to_phase == CasePhase.COMPLETE:
            # Case fully complete — room free, case reset
            case.actual_end_at = now
            add_case_timing_event(
                db,
                case=case,
                event_type="ACTUAL_COMPLETION_RECORDED",
                source=payload.source.value,
                room_id=room.id,
                planned_reference_at=case.expected_end_at,
                actual_reference_at=now,
                expected_end_at=case.expected_end_at,
                trigger_phase_event_id=event.id,
            )
            room.status = RoomStatus.AVAILABLE
            room.active_case_id = None
            logger.info(
                "Case %s COMPLETED and room %s reset to AVAILABLE",
                case.case_code,
                room.room_code,
            )

        if room_reassigned:
            orig_result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == case.scheduled_room_id))
            orig_room = orig_result.scalar_one_or_none()
            if orig_room and orig_room.active_case_id == case.id:
                orig_room.status = RoomStatus.AVAILABLE
                orig_room.active_case_id = None

        if _broadcast_fn is not None:
            from app.services.screen_feed_service import create_phase_feed_event

            await create_phase_feed_event(
                db,
                case=case,
                room_code=room.room_code,
                to_phase=payload.to_phase,
                broadcast_fn=_broadcast_fn,
            )

    await db.commit()
    await db.refresh(event)

    # On case completion, cascade-shift next queued cases using actual finish time as floor
    if payload.outcome == TransitionOutcome.ACCEPTED and payload.to_phase == CasePhase.COMPLETE:
        from app.services.cascade_service import apply_cascade_shift

        shifts = await apply_cascade_shift(
            room_code=room.room_code,
            predicted_end=now,
            active_case_code=payload.case_code,
            db=db,
            trigger_case_id=case.id,
            trigger_phase_event_id=event.id,
            created_by_nurse_id=metadata["triggered_by_nurse_id"],
        )
        if shifts:
            from app.services.screen_feed_service import create_schedule_shift_feed_events
            from app.ws.messages import schedule_shifted_msg

            if _broadcast_fn is not None:
                await create_schedule_shift_feed_events(
                    db,
                    room_code=room.room_code,
                    shifts=shifts,
                    broadcast_fn=_broadcast_fn,
                )
                await _broadcast_fn(schedule_shifted_msg(room_code=room.room_code, shifts=shifts))
            await db.commit()

    return event


async def _handle_cancellation_request(
    payload: DispatchPayload,
    case: SurgicalCase,
    db: AsyncSession,
) -> PhaseEvent | None:
    """Voice 'cancel' — only acted on at high confidence (ACCEPTED); otherwise dropped."""
    if payload.outcome != TransitionOutcome.ACCEPTED:
        logger.info("dispatch: cancellation request below confidence threshold case=%s — dropped", case.case_code)
        return None

    from app.services.case_service import request_cancellation

    payload.from_phase = case.current_phase

    try:
        _case, event = await request_cancellation(
            case.case_code,
            nurse_id=None,
            source=InputSource.VOICE,
            db=db,
            raw_transcript=payload.raw_transcript,
            confidence_score=payload.confidence,
        )
    except CancellationAlreadyRequestedError:
        logger.info("dispatch: cancellation already requested case=%s — dropped", case.case_code)
        return None
    except CaseFrozenError:
        return None

    return event


def _sync_payload_to_case_state(payload: DispatchPayload, case: SurgicalCase) -> None:
    db_outcome = _apply_confidence_gate(validate_transition(case.current_phase, payload.to_phase), payload.confidence)
    if payload.from_phase == case.current_phase and payload.outcome == db_outcome:
        return

    logger.info(
        "dispatch: corrected transition state case=%s from=%s/%s to=%s/%s",
        case.case_code,
        payload.from_phase.value,
        payload.outcome.value,
        case.current_phase.value,
        db_outcome.value,
    )
    payload.from_phase = case.current_phase
    payload.outcome = db_outcome


def _apply_confidence_gate(outcome: TransitionOutcome, confidence: float) -> TransitionOutcome:
    if outcome != TransitionOutcome.ACCEPTED:
        return outcome
    decision = evaluate_confidence(confidence)
    if decision == ConfidenceDecision.ACCEPT:
        return outcome
    if decision == ConfidenceDecision.REVIEW:
        return TransitionOutcome.REVIEW
    return TransitionOutcome.REJECTED
