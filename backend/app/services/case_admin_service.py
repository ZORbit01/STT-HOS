from dataclasses import dataclass
from datetime import UTC
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.enums import CasePhase, CaseType, RoomStatus
from app.domain.exceptions import CaseNotFoundError
from app.models.orm import (
    CaseTimingEvent,
    Company,
    Doctor,
    OperatingRoom,
    PhaseEvent,
    ScheduleChangeEvent,
    ScreenFeedEvent,
    SurgicalCase,
)
from app.schemas.cases import CaseCreate, CaseUpdate
from app.services.case_identifier_service import generate_case_identifier
from app.services.patient_service import get_or_create_patient
from app.services.timing_metadata_service import add_schedule_change_event
from app.services.voice_case_code_service import assign_next_voice_case_code


@dataclass(frozen=True)
class CaseScheduleUpdate:
    room_code: str
    shifts: list[dict]
    from_room: str | None = None
    to_room: str | None = None
    moved_case_code: str | None = None


async def _get_doctor(doctor_id, db: AsyncSession) -> Doctor:
    # Surgeons must already exist (managed in the admin Surgeons tab) — cases
    # never create them implicitly.
    result = await db.execute(select(Doctor).where(Doctor.id == doctor_id))
    doctor = result.scalar_one_or_none()
    if doctor is None:
        raise ValueError("Surgeon not found. Add the surgeon in the Surgeons tab first.")
    return doctor


async def _get_room(room_code: str, db: AsyncSession) -> OperatingRoom | None:
    result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == room_code))
    return result.scalar_one_or_none()


async def _get_or_create_companies(names: list[str], db: AsyncSession) -> list[Company]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_name in names:
        name = " ".join(raw_name.split())
        key = name.casefold()
        if not name or key in seen:
            continue
        if len(name) > 128:
            raise ValueError("Company names must be 128 characters or fewer.")
        seen.add(key)
        normalized.append(name)

    if not normalized:
        return []

    result = await db.execute(
        select(Company).where(func.lower(Company.name).in_([name.lower() for name in normalized]))
    )
    by_name = {company.name.casefold(): company for company in result.scalars().all()}
    companies: list[Company] = []
    for name in normalized:
        company = by_name.get(name.casefold())
        if company is None:
            company = Company(name=name)
            db.add(company)
            by_name[name.casefold()] = company
        companies.append(company)
    await db.flush()
    return companies


async def create_manual_case(body: CaseCreate, db: AsyncSession) -> SurgicalCase:
    room = await _get_room(body.scheduled_room_code, db)
    if room is None:
        raise ValueError(f"Room '{body.scheduled_room_code}' not found")

    doctor = await _get_doctor(body.doctor_id, db)
    companies = await _get_or_create_companies(body.company_names, db)
    patient = await get_or_create_patient(
        db,
        patient_id=body.patient_id,
        first_name=body.patient_first_name,
        last_name=body.patient_last_name,
        mrn=body.patient_mrn,
        age=body.patient_age,
        sex=body.patient_sex,
    )

    scheduled_start = body.scheduled_start
    if scheduled_start.tzinfo is None:
        scheduled_start = scheduled_start.replace(tzinfo=UTC)

    case = SurgicalCase(
        case_code=body.case_code or await generate_case_identifier(db, scheduled_start),
        case_type=CaseType.SCHEDULED,
        current_phase=CasePhase.IDLE,
        scheduled_room_id=room.id,
        doctor_id=doctor.id,
        patient_id=patient.id if patient else None,
        procedure_name=body.procedure_name,
        estimated_duration_min=body.estimated_duration_min,
        original_scheduled_start=scheduled_start,
        scheduled_start=scheduled_start,
        patient_age=body.patient_age,
        patient_gender=body.patient_sex,
        isolation_required=body.isolation_required,
        notes=body.notes or None,
        patient_room=body.patient_room or None,
        companies=companies,
    )
    db.add(case)
    await db.flush()
    await assign_next_voice_case_code(db, case)
    await db.refresh(case, ["doctor", "patient", "scheduled_room", "companies"])
    await db.commit()
    return case


async def update_case_details(
    code: str,
    body: CaseUpdate,
    admin_payload: dict,
    db: AsyncSession,
) -> tuple[SurgicalCase, CaseScheduleUpdate | None]:
    case = await _get_editable_case(code, db)
    old_scheduled_start = case.scheduled_start
    old_scheduled_room_id = case.scheduled_room_id

    _apply_basic_case_updates(case, body)
    schedule_time_changed = _apply_schedule_time_update(case, body)
    schedule_room_changed = await _apply_room_update(case, body, old_scheduled_room_id, db)
    if body.doctor_id is not None and body.doctor_id != case.doctor_id:
        doctor = await _get_doctor(body.doctor_id, db)
        case.doctor_id = doctor.id
    if body.company_names is not None:
        case.companies = await _get_or_create_companies(body.company_names, db)
    await _apply_patient_update(case, body, db)

    if schedule_time_changed or schedule_room_changed:
        _record_schedule_change(
            db,
            case=case,
            body=body,
            admin_payload=admin_payload,
            old_scheduled_start=old_scheduled_start,
            old_scheduled_room_id=old_scheduled_room_id,
            schedule_time_changed=schedule_time_changed,
            schedule_room_changed=schedule_room_changed,
        )

    # Capture old room code before commit (need it for the feed event)
    old_room_code: str | None = None
    if schedule_room_changed:
        old_room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == old_scheduled_room_id))
        old_room = old_room_result.scalar_one_or_none()
        old_room_code = old_room.room_code if old_room else None

    await db.commit()
    await db.refresh(case)
    await db.refresh(case, ["doctor", "patient", "scheduled_room", "companies"])

    if not schedule_time_changed and not schedule_room_changed:
        return case, None

    new_room_code = case.scheduled_room.room_code if case.scheduled_room else ""

    return case, CaseScheduleUpdate(
        room_code=new_room_code,
        shifts=[
            {
                "case_code": case.case_code,
                "old_start": old_scheduled_start.isoformat(),
                "new_start": case.scheduled_start.isoformat(),
            }
        ] if schedule_time_changed else [],
        from_room=old_room_code if schedule_room_changed else None,
        to_room=new_room_code if schedule_room_changed else None,
        moved_case_code=case.case_code if schedule_room_changed else None,
    )


async def delete_case_with_related_data(code: str, db: AsyncSession) -> None:
    case = await _get_case_by_code(code, db)
    await _release_active_room(case, db)

    phase_events = await _case_phase_events(case, db)
    phase_ids = [event.id for event in phase_events]

    timing_filters = [CaseTimingEvent.case_id == case.id]
    schedule_filters = [
        ScheduleChangeEvent.case_id == case.id,
        ScheduleChangeEvent.trigger_case_id == case.id,
    ]
    if phase_ids:
        timing_filters.append(CaseTimingEvent.trigger_phase_event_id.in_(phase_ids))
        schedule_filters.append(ScheduleChangeEvent.trigger_phase_event_id.in_(phase_ids))

    await db.execute(delete(CaseTimingEvent).where(or_(*timing_filters)))
    await db.execute(delete(ScheduleChangeEvent).where(or_(*schedule_filters)))
    await db.execute(delete(ScreenFeedEvent).where(ScreenFeedEvent.case_code == case.case_code))

    for event in phase_events:
        await db.delete(event)

    await db.delete(case)
    await db.commit()


async def _get_editable_case(code: str, db: AsyncSession) -> SurgicalCase:
    result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.companies),
            selectinload(SurgicalCase.scheduled_room),
        )
        .where(SurgicalCase.case_code == code)
        .order_by(SurgicalCase.scheduled_start.desc())
        .limit(1)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise CaseNotFoundError(code)
    return case


async def _get_case_by_code(code: str, db: AsyncSession) -> SurgicalCase:
    result = await db.execute(select(SurgicalCase).where(SurgicalCase.case_code == code))
    case = result.scalar_one_or_none()
    if case is None:
        raise CaseNotFoundError(code)
    return case


def _apply_basic_case_updates(case: SurgicalCase, body: CaseUpdate) -> None:
    if body.procedure_name is not None:
        case.procedure_name = body.procedure_name
    if body.estimated_duration_min is not None:
        case.estimated_duration_min = body.estimated_duration_min
    if body.isolation_required is not None:
        case.isolation_required = body.isolation_required
    if "notes" in body.model_fields_set:
        case.notes = body.notes.strip() if body.notes else None
    if "patient_room" in body.model_fields_set:
        case.patient_room = body.patient_room.strip() if body.patient_room else None
    if body.alert_level is not None:
        case.alert_level = body.alert_level
    if body.actual_start_at is not None:
        case.actual_start_at = body.actual_start_at
    if body.actual_end_at is not None:
        case.actual_end_at = body.actual_end_at
    if body.expected_end_at is not None:
        case.expected_end_at = body.expected_end_at


def _apply_schedule_time_update(case: SurgicalCase, body: CaseUpdate) -> bool:
    if body.scheduled_start is None:
        return False
    old_scheduled_start = case.scheduled_start
    case.scheduled_start = body.scheduled_start
    return old_scheduled_start != body.scheduled_start


async def _apply_room_update(
    case: SurgicalCase,
    body: CaseUpdate,
    old_scheduled_room_id: UUID,
    db: AsyncSession,
) -> bool:
    if body.scheduled_room_code is None:
        return False

    result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == body.scheduled_room_code))
    room = result.scalar_one_or_none()
    if room is None:
        raise ValueError(f"Room '{body.scheduled_room_code}' not found")

    case.scheduled_room_id = room.id
    return old_scheduled_room_id != room.id


async def _apply_patient_update(case: SurgicalCase, body: CaseUpdate, db: AsyncSession) -> None:
    if not _has_patient_update(body):
        return

    patient = await get_or_create_patient(
        db,
        patient_id=body.patient_id,
        first_name=body.patient_first_name,
        last_name=body.patient_last_name,
        mrn=body.patient_mrn,
        age=body.patient_age,
        sex=body.patient_sex,
    )
    if patient is None:
        return

    case.patient_id = patient.id
    case.patient_age = patient.age
    case.patient_gender = patient.sex
    if body.patient_first_name is not None:
        patient.first_name = body.patient_first_name.strip() or patient.first_name
    if body.patient_last_name is not None:
        patient.last_name = body.patient_last_name.strip() or patient.last_name
    if body.patient_mrn is not None:
        patient.mrn = body.patient_mrn.strip() or None
    if body.patient_age is not None:
        patient.age = body.patient_age
        case.patient_age = body.patient_age
    if body.patient_sex is not None:
        patient.sex = body.patient_sex.strip().upper() or None
        case.patient_gender = patient.sex


def _has_patient_update(body: CaseUpdate) -> bool:
    return any(
        value is not None
        for value in (
            body.patient_id,
            body.patient_first_name,
            body.patient_last_name,
            body.patient_mrn,
            body.patient_age,
            body.patient_sex,
        )
    )


def _record_schedule_change(
    db: AsyncSession,
    *,
    case: SurgicalCase,
    body: CaseUpdate,
    admin_payload: dict,
    old_scheduled_start,
    old_scheduled_room_id,
    schedule_time_changed: bool,
    schedule_room_changed: bool,
) -> None:
    if schedule_time_changed and schedule_room_changed:
        change_type = "TIME_ROOM"
    elif schedule_time_changed:
        change_type = "TIME"
    else:
        change_type = "ROOM"

    try:
        admin_id = UUID(str(admin_payload["sub"]))
    except (TypeError, ValueError):
        admin_id = None

    add_schedule_change_event(
        db,
        case=case,
        source="ADMIN",
        change_type=change_type,
        old_scheduled_start=old_scheduled_start,
        new_scheduled_start=body.scheduled_start or case.scheduled_start,
        old_room_id=old_scheduled_room_id,
        new_room_id=case.scheduled_room_id,
        created_by_admin_id=admin_id,
    )


async def _release_active_room(case: SurgicalCase, db: AsyncSession) -> None:
    result = await db.execute(select(OperatingRoom).where(OperatingRoom.active_case_id == case.id))
    room = result.scalar_one_or_none()
    if room is None:
        return
    room.active_case_id = None
    room.status = RoomStatus.AVAILABLE


async def _case_phase_events(case: SurgicalCase, db: AsyncSession) -> list[PhaseEvent]:
    result = await db.execute(select(PhaseEvent).where(PhaseEvent.case_id == case.id))
    return list(result.scalars().all())
