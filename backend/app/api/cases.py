from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_runtime, require_admin, require_nurse_or_admin
from app.db import get_db
from app.domain.enums import CasePhase, InputSource
from app.domain.exceptions import (
    CancellationAlreadyRequestedError,
    CancellationNotRequestedError,
    CaseFrozenError,
    CaseNotFoundError,
    DelayReasonNotRequiredError,
    RoomNotFoundError,
    RoomOccupiedError,
)
from app.models.orm import InductionPhysician, InductionPhysicianAssignment, OperatingRoom, SurgicalCase
from app.runtime import AppRuntime
from app.schemas.cases import (
    CancellationReasonSubmit,
    CaseCreate,
    CaseDetailOut,
    CaseOut,
    CaseUpdate,
    DelayReasonSubmit,
    InductionPhysicianAssignmentOut,
    TransitionRequest,
    TransitionResponse,
)
from app.services.case_admin_service import (
    CaseScheduleUpdate,
    create_manual_case,
    delete_case_with_related_data,
    update_case_details,
)
from app.services.case_service import (
    cancel_case_directly,
    confirm_cancellation,
    get_case,
    list_all_cases,
    list_today_cases,
    manual_transition,
    reject_cancellation,
    request_cancellation,
    submit_delay_reason,
)
from app.services.voice_case_code_service import reset_voice_case_codes

router = APIRouter(prefix="/api/v1/cases", tags=["cases"])


def _case_out(case: SurgicalCase) -> CaseOut:
    out = CaseOut.model_validate(case)
    out.scheduled_room_code = case.scheduled_room.room_code if case.scheduled_room else ""
    if case.patient:
        out.patient_name = f"{case.patient.first_name} {case.patient.last_name}".strip()
        out.patient_age = case.patient.age
        out.patient_sex = case.patient.sex
    else:
        out.patient_age = case.patient_age
        out.patient_sex = case.patient_gender
    out.induction_physician_name = _person_name(case.induction_physician)
    out.cancellation_requested_by_nurse_name = _person_name(case.cancellation_requested_by_nurse)
    return out


def _person_name(person: object | None) -> str | None:
    if person is None:
        return None
    first = getattr(person, "first_name", "") or ""
    last = getattr(person, "last_name", "") or ""
    return f"{first} {last}".strip() or None


@router.post("", response_model=CaseOut, status_code=201)
async def create_case(
    body: CaseCreate,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    _: dict = Depends(require_admin),
) -> CaseOut:
    """Admin: manually create a single surgical case."""
    try:
        case = await create_manual_case(body, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None

    await runtime.refresh_stt_grammar()
    if runtime.ws_manager:
        from app.ws.messages import schedule_changed_msg

        msg = schedule_changed_msg("case_created")
        await runtime.ws_manager.broadcast(msg)
        await runtime.ws_manager.broadcast_to_all_rooms(msg)
    return _case_out(case)


@router.get("", response_model=list[CaseOut])
async def list_cases(db: AsyncSession = Depends(get_db)) -> list[CaseOut]:
    cases = await list_today_cases(db)
    return [_case_out(case) for case in cases]


@router.get("/admin", response_model=list[CaseOut])
async def list_admin_cases(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> list[CaseOut]:
    cases = await list_all_cases(db)
    return [_case_out(case) for case in cases]


@router.post("/voice-codes/reset", response_model=list[CaseOut])
async def reset_case_voice_codes(
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    _: dict = Depends(require_admin),
) -> list[CaseOut]:
    manager = runtime.ws_manager
    cases = await reset_voice_case_codes(
        db,
        refresh_stt_grammar=runtime.refresh_stt_grammar,
        broadcast_fn=manager.broadcast if manager else None,
        broadcast_rooms_fn=manager.broadcast_to_all_rooms if manager else None,
    )
    return [_case_out(case) for case in cases]


@router.get("/{code}", response_model=CaseDetailOut)
async def get_case_detail(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> CaseDetailOut:
    try:
        case = await get_case(code, db)
        return await _case_detail_out(case, db)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None


@router.patch("/{code}", response_model=CaseOut)
async def update_case(
    code: str,
    body: CaseUpdate,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    admin: dict = Depends(require_admin),
) -> CaseOut:
    """Admin: edit any field of a surgical case."""
    try:
        case, schedule_update = await update_case_details(code, body, admin, db)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None

    if schedule_update:
        await _broadcast_schedule_update(schedule_update, runtime, db)

    if runtime.ws_manager:
        from app.ws.messages import schedule_changed_msg

        msg = schedule_changed_msg("case_updated")
        await runtime.ws_manager.broadcast(msg)
        await runtime.ws_manager.broadcast_to_all_rooms(msg)
    return _case_out(case)


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    code: str,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    _: dict = Depends(require_admin),
) -> None:
    """Admin: permanently remove a surgical case and its events."""
    try:
        await delete_case_with_related_data(code, db)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None

    if runtime.ws_manager:
        from app.ws.messages import schedule_changed_msg

        msg = schedule_changed_msg("case_deleted")
        await runtime.ws_manager.broadcast(msg)
        await runtime.ws_manager.broadcast_to_all_rooms(msg)
    await runtime.refresh_stt_grammar()


@router.post("/{code}/transition", response_model=TransitionResponse)
async def transition_case(
    code: str,
    body: TransitionRequest,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    credentials: dict = Depends(require_nurse_or_admin),
) -> TransitionResponse:
    # Only pass nurse_id when the actor is actually a nurse — admin ID must not go into nurse FK
    nurse_id = credentials["sub"] if credentials.get("type") == "nurse" else None

    try:
        event, cascade_shifts = await manual_transition(
            case_code=code,
            to_phase=body.to_phase,
            nurse_id=nurse_id,
            db=db,
            room_code=body.room_code,
        )

        if event.outcome.value == "ACCEPTED":
            await _broadcast_accepted_transition(code, event, cascade_shifts, nurse_id, db, runtime)
            if event.to_phase == CasePhase.IN:
                # The case just started — it must drop out of the "start" voice grammar.
                await runtime.refresh_stt_grammar()

        return TransitionResponse(
            outcome=event.outcome,
            from_phase=event.from_phase,
            to_phase=event.to_phase,
        )
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None
    except RoomNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from None
    except RoomOccupiedError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from None
    except CaseFrozenError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from None


@router.post("/{code}/cancellation/request", response_model=CaseOut)
async def request_case_cancellation(
    code: str,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    credentials: dict = Depends(require_nurse_or_admin),
) -> CaseOut:
    """Nurse/admin: flag a case for cancellation. Freezes the case until an admin resolves it."""
    nurse_id = credentials["sub"] if credentials.get("type") == "nurse" else None

    try:
        case, _event = await request_cancellation(code, nurse_id, InputSource.BUTTON, db)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None
    except CancellationAlreadyRequestedError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from None

    case_out = _case_out(case)
    if runtime.ws_manager:
        from app.ws.messages import cancellation_requested_msg

        await runtime.ws_manager.broadcast(
            cancellation_requested_msg(
                case_code=case.case_code,
                room_code=case_out.scheduled_room_code,
                requested_by_nurse_name=case_out.cancellation_requested_by_nurse_name,
                requested_at=case.cancellation_requested_at.isoformat(),
            )
        )
    return case_out


@router.post("/{code}/cancellation/confirm", response_model=CaseOut)
async def confirm_case_cancellation(
    code: str,
    body: CancellationReasonSubmit,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    admin: dict = Depends(require_admin),
) -> CaseOut:
    """Admin: confirm a pending cancellation request, moving the case to CANCELLED."""
    try:
        case, event = await confirm_cancellation(code, admin.get("sub"), body.reason, db)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None
    except CancellationNotRequestedError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None

    await _broadcast_cancellation(code, event, case, db, runtime)
    return _case_out(case)


@router.post("/{code}/cancellation/reject", response_model=CaseOut)
async def reject_case_cancellation(
    code: str,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    admin: dict = Depends(require_admin),
) -> CaseOut:
    """Admin: reject a pending cancellation request — the case unfreezes and continues."""
    try:
        case, _event = await reject_cancellation(code, admin.get("sub"), db)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None
    except CancellationNotRequestedError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None

    if runtime.ws_manager:
        from app.ws.messages import schedule_changed_msg

        msg = schedule_changed_msg("cancellation_rejected")
        await runtime.ws_manager.broadcast(msg)
        await runtime.ws_manager.broadcast_to_all_rooms(msg)
    return _case_out(case)


@router.post("/{code}/cancellation/direct", response_model=CaseOut)
async def direct_case_cancellation(
    code: str,
    body: CancellationReasonSubmit,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    admin: dict = Depends(require_admin),
) -> CaseOut:
    """Admin: cancel a case directly, without a prior nurse request."""
    try:
        case, event = await cancel_case_directly(code, admin.get("sub"), body.reason, db)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None
    except CancellationAlreadyRequestedError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from None

    await _broadcast_cancellation(code, event, case, db, runtime)
    return _case_out(case)


@router.post("/{code}/delay-reason", response_model=CaseOut)
async def submit_case_delay_reason(
    code: str,
    body: DelayReasonSubmit,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> CaseOut:
    """Nurse/admin: record why a case started late when not auto-explained by a cascade push."""
    try:
        case = await submit_delay_reason(code, body.reason, body.note, db)
        return _case_out(case)
    except CaseNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Case '{code}' not found") from None
    except DelayReasonNotRequiredError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None


async def _broadcast_schedule_update(
    update: CaseScheduleUpdate,
    runtime: AppRuntime,
    db: AsyncSession,
) -> None:
    from app.services.screen_feed_service import (
        create_room_move_feed_event,
        create_schedule_shift_feed_events,
        remove_reschedule_events_for_case,
    )
    from app.ws.messages import schedule_shifted_msg

    if update.from_room and update.to_room and update.moved_case_code:
        from sqlalchemy import select

        from app.models.orm import SurgicalCase

        await remove_reschedule_events_for_case(db, case_code=update.moved_case_code, room_code=update.from_room)
        result = await db.execute(select(SurgicalCase).where(SurgicalCase.case_code == update.moved_case_code))
        case_obj = result.scalar_one_or_none()
        if case_obj:
            await create_room_move_feed_event(
                db,
                case=case_obj,
                from_room=update.from_room,
                to_room=update.to_room,
                broadcast_fn=runtime.ws_manager.broadcast,
            )

    if update.shifts:
        await create_schedule_shift_feed_events(
            db,
            room_code=update.room_code,
            shifts=update.shifts,
            broadcast_fn=runtime.ws_manager.broadcast,
        )
    await db.commit()
    await runtime.ws_manager.broadcast(schedule_shifted_msg(room_code=update.room_code, shifts=update.shifts))


async def _case_detail_out(case: SurgicalCase, db: AsyncSession) -> CaseDetailOut:
    out = CaseDetailOut.model_validate(case)
    base = _case_out(case)
    for field, value in base:
        setattr(out, field, value)

    events_by_id = {event.id: event for event in case.phase_events}
    for event_out in out.phase_events:
        event = events_by_id.get(event_out.id)
        if event is not None:
            _attach_event_actor_names(event_out, event)
    out.induction_assignments = await _case_induction_assignments(case, db)
    return out


async def _case_induction_assignments(
    case: SurgicalCase,
    db: AsyncSession,
) -> list[InductionPhysicianAssignmentOut]:
    shift_ids = {event.nurse_shift_id for event in case.phase_events if event.nurse_shift_id}
    if not shift_ids:
        return []

    result = await db.execute(
        select(InductionPhysicianAssignment, InductionPhysician)
        .join(InductionPhysician, InductionPhysician.id == InductionPhysicianAssignment.induction_physician_id)
        .where(InductionPhysicianAssignment.nurse_shift_id.in_(shift_ids))
        .order_by(InductionPhysicianAssignment.assigned_at)
    )
    out: list[InductionPhysicianAssignmentOut] = []
    for assignment, physician in result.all():
        item = InductionPhysicianAssignmentOut.model_validate(assignment)
        item.induction_physician_name = _person_name(physician)
        out.append(item)
    return out


def _attach_event_actor_names(event_out, event) -> None:
    shift = event.nurse_shift
    nurse = event.triggered_by_nurse or (shift.nurse if shift else None)
    physician = event.induction_physician or (shift.induction_physician if shift else None)
    event_out.triggered_by_nurse_name = _person_name(nurse)
    event_out.induction_physician_name = _person_name(physician)


async def _broadcast_accepted_transition(
    code: str,
    event,
    cascade_shifts: list[dict],
    nurse_id: str | None,
    db: AsyncSession,
    runtime: AppRuntime,
) -> None:
    case, room = await _transition_context(code, db)
    if not runtime.ws_manager or case is None or room is None:
        return

    # A button transition must sync the STT pipeline's per-room phase, exactly like
    # the voice path does (runtime._sync_pipeline_room_state). Without this the pipeline
    # stays on the stale IDLE "start" grammar and keeps offering start phrases for a case
    # that has already begun. refresh_stt_grammar() alone only refreshes the case-code
    # list, not the room's current phase.
    if runtime.pipeline:
        next_active = code if event.to_phase not in (CasePhase.IDLE, CasePhase.COMPLETE) else None
        runtime.pipeline.update_room_state(
            room_id=room.room_code,
            active_case_code=next_active,
            current_phase=event.to_phase,
        )

    await _broadcast_phase_transition(code, event, case, room, db, runtime)
    if event.room_reassigned:
        await _broadcast_room_reassignment(code, event, room, db, runtime)
    in_shifts = await _apply_in_phase_cascade(code, event, case, room, nurse_id, db)
    await _broadcast_shift_events(room.room_code, in_shifts + cascade_shifts, db, runtime)


async def _broadcast_room_reassignment(
    code: str,
    event,
    room: OperatingRoom,
    db: AsyncSession,
    runtime: AppRuntime,
) -> None:
    """Announce that a manual (button) transition moved the case out of its scheduled room — mirrors the STT path."""
    from app.ws.messages import room_reassigned_msg

    sched_result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == event.scheduled_room_id))
    sched_room = sched_result.scalar_one_or_none()
    await runtime.ws_manager.broadcast(
        room_reassigned_msg(
            case_code=code,
            from_room=sched_room.room_code if sched_room else str(event.scheduled_room_id),
            to_room=room.room_code,
        )
    )


async def _transition_context(code: str, db: AsyncSession) -> tuple[SurgicalCase | None, OperatingRoom | None]:
    result = await db.execute(select(SurgicalCase).where(SurgicalCase.case_code == code))
    case = result.scalar_one_or_none()
    if case is None:
        return None, None

    room_result = await db.execute(
        select(OperatingRoom).where(OperatingRoom.id == (case.room_id or case.scheduled_room_id))
    )
    return case, room_result.scalar_one_or_none()


async def _broadcast_phase_transition(
    code: str,
    event,
    case: SurgicalCase,
    room: OperatingRoom,
    db: AsyncSession,
    runtime: AppRuntime,
) -> None:
    from app.services.screen_feed_service import create_phase_feed_event
    from app.ws.messages import phase_transition_msg

    await create_phase_feed_event(
        db,
        case=case,
        room_code=room.room_code,
        to_phase=event.to_phase,
        broadcast_fn=runtime.ws_manager.broadcast,
    )
    await db.commit()
    msg = phase_transition_msg(
        case_code=code,
        room_code=room.room_code,
        from_phase=event.from_phase.value,
        to_phase=event.to_phase.value,
        source=event.source.value,
        confidence=1.0,
        raw_transcript=None,
        delay_minutes=event.delay_minutes,
    )
    await runtime.ws_manager.broadcast(msg)
    await runtime.ws_manager.send_to_room(room.room_code, msg)


async def _broadcast_cancellation(
    code: str,
    event,
    case: SurgicalCase,
    db: AsyncSession,
    runtime: AppRuntime,
) -> None:
    from app.services.screen_feed_service import create_phase_feed_event
    from app.ws.messages import phase_transition_msg

    if not runtime.ws_manager:
        return

    room_result = await db.execute(
        select(OperatingRoom).where(OperatingRoom.id == (case.room_id or case.scheduled_room_id))
    )
    room = room_result.scalar_one_or_none()
    room_code = room.room_code if room else ""

    if room is not None:
        await create_phase_feed_event(
            db,
            case=case,
            room_code=room_code,
            to_phase=CasePhase.CANCELLED,
            broadcast_fn=runtime.ws_manager.broadcast,
        )
        await db.commit()

        if runtime.pipeline:
            runtime.pipeline.update_room_state(
                room_id=room_code,
                active_case_code=None,
                current_phase=CasePhase.IDLE,
            )

    msg = phase_transition_msg(
        case_code=code,
        room_code=room_code,
        from_phase=event.from_phase.value,
        to_phase=event.to_phase.value,
        source=event.source.value,
        confidence=1.0,
        raw_transcript=None,
        delay_minutes=event.delay_minutes,
    )
    await runtime.ws_manager.broadcast(msg)
    if room_code:
        await runtime.ws_manager.send_to_room(room_code, msg)
    await runtime.refresh_stt_grammar()


async def _apply_in_phase_cascade(
    code: str,
    event,
    case: SurgicalCase,
    room: OperatingRoom,
    nurse_id: str | None,
    db: AsyncSession,
) -> list[dict]:
    if event.to_phase.value != "IN" or not case.expected_end_at:
        return []

    from app.services.cascade_service import apply_cascade_shift

    return await apply_cascade_shift(
        room_code=room.room_code,
        predicted_end=case.expected_end_at,
        active_case_code=code,
        db=db,
        trigger_case_id=case.id,
        trigger_phase_event_id=event.id,
        created_by_nurse_id=UUID(str(nurse_id)) if nurse_id else None,
    )


async def _broadcast_shift_events(
    room_code: str,
    shifts: list[dict],
    db: AsyncSession,
    runtime: AppRuntime,
) -> None:
    if not shifts:
        return

    await _broadcast_schedule_update(CaseScheduleUpdate(room_code=room_code, shifts=shifts), runtime, db)
