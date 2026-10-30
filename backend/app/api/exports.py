from datetime import date
from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_db
from app.services.schedule_export_service import build_schedule_workbook, load_daily_schedule, load_filtered_schedule

router = APIRouter(prefix="/api/v1/exports", tags=["exports"])

EXCEL_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class FilteredCaseExportRequest(BaseModel):
    case_ids: list[UUID] = Field(default_factory=list, max_length=10_000)


@router.get("/schedule.xlsx")
async def export_daily_schedule(
    schedule_date: date = Query(alias="date"),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> StreamingResponse:
    rooms, cases = await load_daily_schedule(db, schedule_date)
    workbook = build_schedule_workbook(schedule_date, rooms, cases)
    filename = f"OR-Schedule-{schedule_date.isoformat()}.xlsx"
    return StreamingResponse(
        BytesIO(workbook),
        media_type=EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/cases.xlsx")
async def export_filtered_cases(
    body: FilteredCaseExportRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> StreamingResponse:
    rooms, cases = await load_filtered_schedule(db, body.case_ids)
    workbook = build_schedule_workbook(
        None,
        rooms,
        cases,
        report_label="Filtered admin view",
        preserve_order=True,
    )
    return StreamingResponse(
        BytesIO(workbook),
        media_type=EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="OR-Cases-filtered.xlsx"'},
    )
