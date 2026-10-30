from datetime import date

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_runtime, require_admin
from app.db import get_db
from app.importer.excel_parser import parse_excel
from app.runtime import AppRuntime
from app.services.import_service import derive_durations, import_schedule
from app.ws.messages import schedule_loaded_msg

router = APIRouter(prefix="/api/v1/import", tags=["import"])


class ImportResponse(BaseModel):
    cases_created: int
    filename: str
    status: str
    schedule_date: date
    warnings: list[str] = []


class PreviewCase(BaseModel):
    source_row: int
    room_code: str
    scheduled_start: str
    estimated_duration_min: int | None
    procedure_name: str
    doctor_name: str
    patient_mrn: str | None
    patient_age: int | None
    procedure_code: str | None
    note: str | None


class PreviewResponse(BaseModel):
    filename: str
    schedule_date: date
    cases: list[PreviewCase]
    warnings: list[str] = []


def _require_excel(file: UploadFile) -> None:
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an Excel file (.xlsx or .xls)",
        )


@router.post("/excel/preview", response_model=PreviewResponse)
async def preview_schedule(
    file: UploadFile,
    admin: dict = Depends(require_admin),
) -> PreviewResponse:
    """
    Parse an uploaded schedule and report what would be imported, without writing anything.

    The source sheets leave the schedule date, AM/PM and durations implicit, so this
    lets an admin check the parser's inferences before committing them.
    """
    _require_excel(file)
    file_bytes = await file.read()

    try:
        parsed = parse_excel(file_bytes, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from None

    # Anything needing attention first, routine notes after.
    all_warnings = [*parsed.warnings, *derive_durations(parsed.rows)]
    warnings = [w.format() for w in sorted(all_warnings, key=lambda w: not w.notable)]

    cases = [
        PreviewCase(
            source_row=row.source_row,
            room_code=row.room_code,
            scheduled_start=row.scheduled_start.isoformat(),
            estimated_duration_min=row.estimated_duration_min,
            procedure_name=row.procedure_name,
            doctor_name=" ".join(part for part in (row.doctor_first_name, row.doctor_last_name) if part),
            patient_mrn=row.patient_mrn,
            patient_age=row.patient_age,
            procedure_code=row.procedure_code,
            note=row.note,
        )
        for row in sorted(parsed.rows, key=lambda r: (r.room_code, r.scheduled_start))
    ]

    return PreviewResponse(
        filename=file.filename or "",
        schedule_date=parsed.schedule_date,
        cases=cases,
        warnings=warnings,
    )


@router.post("/excel", response_model=ImportResponse)
async def upload_schedule(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    runtime: AppRuntime = Depends(get_runtime),
    admin: dict = Depends(require_admin),
) -> ImportResponse:
    _require_excel(file)

    file_bytes = await file.read()

    try:
        result = await import_schedule(
            file_bytes=file_bytes,
            filename=file.filename,
            imported_by=admin["sub"],
            db=db,
        )

        from app.services.screen_feed_service import create_schedule_loaded_feed_event

        await create_schedule_loaded_feed_event(
            db,
            cases_created=result.record.cases_created,
            broadcast_fn=runtime.ws_manager.broadcast,
        )
        await db.commit()
        await runtime.ws_manager.broadcast(schedule_loaded_msg(result.record.cases_created))
        await runtime.refresh_stt_grammar()

        return ImportResponse(
            cases_created=result.record.cases_created,
            filename=result.record.source_filename,
            status=result.record.status,
            schedule_date=result.schedule_date,
            warnings=result.warnings,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from None
