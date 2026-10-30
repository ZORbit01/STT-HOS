import logging
from dataclasses import dataclass
from datetime import UTC, date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import CasePhase, CaseType
from app.importer.excel_parser import ParseWarning, RawCaseRow, parse_excel
from app.models.orm import Company, Doctor, OperatingRoom, ScheduleImport, SurgicalCase
from app.services.case_identifier_service import generate_case_identifiers
from app.services.patient_service import get_or_create_patient
from app.services.voice_case_code_service import assign_voice_case_codes

logger = logging.getLogger(__name__)

# The source sheet carries no duration, so it is inferred from when the next case in
# the same room is due to start. The last case in a room has no successor.
DEFAULT_DURATION_MIN = 60
MIN_DURATION_MIN = 15
MAX_DURATION_MIN = 480


@dataclass
class ImportResult:
    record: ScheduleImport
    schedule_date: date
    warnings: list[str]


def derive_durations(rows: list[RawCaseRow]) -> list[ParseWarning]:
    """
    Fill estimated_duration_min in place from the gap to the next case in the same room.

    Returns a warning per row so the inferred figure is visible to the admin.
    """
    warnings: list[ParseWarning] = []
    by_room: dict[str, list[RawCaseRow]] = {}
    for row in rows:
        by_room.setdefault(row.room_code, []).append(row)

    for room_rows in by_room.values():
        room_rows.sort(key=lambda r: r.scheduled_start)
        for idx, row in enumerate(room_rows):
            if idx + 1 < len(room_rows):
                gap = (room_rows[idx + 1].scheduled_start - row.scheduled_start).total_seconds() / 60
                duration = int(gap)
                source = f"gap to the next case in {row.room_code}"
            else:
                duration = DEFAULT_DURATION_MIN
                source = f"default — last case in {row.room_code}"

            clamped = max(MIN_DURATION_MIN, min(MAX_DURATION_MIN, duration))
            if clamped != duration:
                source += f", clamped from {duration}"
            row.estimated_duration_min = clamped
            warnings.append(
                ParseWarning(
                    row.source_row, f"Duration set to {clamped} min ({source})", notable=clamped != duration
                )
            )

    return warnings


async def _get_or_create_doctor(
    first_name: str,
    last_name: str,
    db: AsyncSession,
) -> Doctor:
    result = await db.execute(
        select(Doctor).where(
            Doctor.first_name == first_name,
            Doctor.last_name == last_name,
        )
    )
    doctor = result.scalar_one_or_none()
    if doctor is None:
        doctor = Doctor(first_name=first_name, last_name=last_name)
        db.add(doctor)
        await db.flush()  # get the id without committing
    return doctor


async def _load_companies_by_name(db: AsyncSession) -> dict[str, Company]:
    """
    Existing companies, keyed by casefolded name.

    The sheet's Company column is used inconsistently — an insurer on one row
    ("SATER"), a lens specification on the next ("mono 23.5"). Auto-creating from it
    would fill the companies table with junk, so an import only ever *links* to a
    company that already exists; anything unrecognised is kept as a case note.
    """
    result = await db.execute(select(Company))
    return {company.name.casefold(): company for company in result.scalars().all()}


async def _get_room(room_code: str, db: AsyncSession) -> OperatingRoom | None:
    result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == room_code))
    return result.scalar_one_or_none()


async def import_schedule(
    file_bytes: bytes,
    filename: str,
    imported_by: str,
    db: AsyncSession,
) -> ImportResult:
    """
    Parse Excel file, create SurgicalCase records, return the import record.

    Case identifiers are internal schedule IDs; voice codes are assigned separately.
    The returned warnings describe everything the parser had to infer (schedule date,
    AM/PM, durations) plus any rows that were skipped.
    """
    import_record = ScheduleImport(
        source_filename=filename,
        imported_by=imported_by,
        cases_created=0,
        status="pending",
    )
    db.add(import_record)
    await db.flush()

    try:
        parsed = parse_excel(file_bytes, filename)
    except ValueError as e:
        import_record.status = "failed"
        import_record.error_detail = str(e)
        await db.commit()
        raise

    rows = parsed.rows
    warnings = list(parsed.warnings)
    warnings.extend(derive_durations(rows))

    # Sort by scheduled_start so imported rows receive stable schedule identifiers.
    rows.sort(key=lambda r: r.scheduled_start)
    room_codes = {row.room_code for row in rows}
    room_result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code.in_(room_codes)))
    rooms_by_code = {room.room_code: room for room in room_result.scalars().all()}

    unknown_codes = sorted(room_codes - rooms_by_code.keys())
    if unknown_codes and not rooms_by_code:
        # Every room in the sheet is unknown — almost always a naming mismatch
        # (sheet says "R1", the system has "OR1"). Fail rather than quietly
        # reporting a successful import of nothing.
        known_result = await db.execute(select(OperatingRoom.room_code))
        known = sorted(known_result.scalars().all())
        message = (
            f"None of the rooms in the file match a room in the system. "
            f"File has: {', '.join(unknown_codes)}. System has: {', '.join(known) or '(no rooms configured)'}."
        )
        import_record.status = "failed"
        import_record.error_detail = message[:1024]
        await db.commit()
        raise ValueError(message)

    valid_rows = []
    for row in rows:
        if row.room_code not in rooms_by_code:
            continue
        valid_rows.append(row)
    for code in unknown_codes:
        skipped = sum(1 for row in rows if row.room_code == code)
        warnings.append(
            ParseWarning(
                None, f"Room {code} is not configured in the system — skipped {skipped} case(s)", notable=True
            )
        )

    case_codes = await generate_case_identifiers(db, [row.scheduled_start for row in valid_rows])
    doctors_by_name: dict[tuple[str, str], Doctor] = {}
    companies_by_name = await _load_companies_by_name(db)

    created = 0
    created_cases: list[SurgicalCase] = []
    for row, case_code in zip(valid_rows, case_codes, strict=True):
        room = rooms_by_code[row.room_code]

        doctor_key = (row.doctor_first_name, row.doctor_last_name)
        doctor = doctors_by_name.get(doctor_key)
        if doctor is None:
            doctor = await _get_or_create_doctor(row.doctor_first_name, row.doctor_last_name, db)
            doctors_by_name[doctor_key] = doctor
        patient = await get_or_create_patient(
            db,
            first_name=row.patient_first_name,
            last_name=row.patient_last_name,
            mrn=row.patient_mrn,
            age=row.patient_age,
            sex=row.patient_sex,
        )

        # Attach timezone if naive datetime from Excel
        scheduled_start = row.scheduled_start
        if scheduled_start.tzinfo is None:
            scheduled_start = scheduled_start.replace(tzinfo=UTC)

        # The Company column holds an insurer on some rows and free text on others.
        # Link it only when it names a company that already exists; otherwise keep
        # the text as a note rather than inventing a company record for it.
        company = None
        note = row.note
        if note:
            company = companies_by_name.get(" ".join(note.split()).casefold())
            if company is not None:
                note = None
            else:
                warnings.append(
                    ParseWarning(row.source_row, f"{row.note!r} is not a known company — kept as a case note")
                )

        case = SurgicalCase(
            case_code=case_code,
            case_type=CaseType.SCHEDULED,
            current_phase=CasePhase.IDLE,
            scheduled_room_id=room.id,
            doctor_id=doctor.id,
            patient_id=patient.id if patient else None,
            procedure_name=row.procedure_name,
            estimated_duration_min=row.estimated_duration_min,
            original_scheduled_start=scheduled_start,
            scheduled_start=scheduled_start,
            patient_age=row.patient_age,
            patient_gender=row.patient_sex,
            notes=note,
            import_id=import_record.id,
        )
        if company is not None:
            case.companies.append(company)
        db.add(case)
        await db.flush()
        created_cases.append(case)
        created += 1

    await assign_voice_case_codes(db, created_cases)
    import_record.cases_created = created
    import_record.status = "success"
    # Keep the inferences on the record so a past import stays explainable. The
    # column only holds 1024 chars, so anything needing attention is written first.
    ordered = sorted(warnings, key=lambda w: not w.notable)
    if ordered:
        import_record.error_detail = "\n".join(w.format() for w in ordered)[:1024]
    await db.commit()

    logger.info(
        "Import complete: file=%s date=%s cases_created=%d warnings=%d",
        filename,
        parsed.schedule_date.isoformat(),
        created,
        len(warnings),
    )
    return ImportResult(
        record=import_record,
        schedule_date=parsed.schedule_date,
        warnings=[w.format() for w in ordered],
    )
