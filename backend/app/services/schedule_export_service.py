from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from io import BytesIO
from uuid import UUID
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.enums import CasePhase
from app.models.orm import OperatingRoom, SurgicalCase

HOSPITAL_TIMEZONE = ZoneInfo("Asia/Beirut")

NAVY = "0F2044"
BLUE = "1D4ED8"
LIGHT_BLUE = "EAF2FF"
PALE_BLUE = "F6F9FE"
WHITE = "FFFFFF"
TEXT = "0F172A"
MUTED = "64748B"
BORDER = "CBD5E1"
AMBER = "FEF3C7"
AMBER_TEXT = "92400E"
GREEN = "DCFCE7"
GREEN_TEXT = "166534"
RED = "FEE2E2"
RED_TEXT = "991B1B"

TABLE_HEADERS = (
    "Room",
    "Planned start",
    "Planned end",
    "Planned (min)",
    "Actual in",
    "Actual out",
    "Actual (min)",
    "Case code",
    "Patient",
    "MRN",
    "Age / Sex",
    "Procedure",
    "Surgeon",
    "Companies",
    "Isolation",
    "Patient room",
    "Notes",
    "Status",
)
COLUMN_COUNT = len(TABLE_HEADERS)
LAST_COLUMN = get_column_letter(COLUMN_COUNT)
# 1-based column indices, keyed off TABLE_HEADERS order.
# Room, Planned start/end/min, Actual in/out/min, Case, MRN, Age/Sex, Isolation, Status
_CENTER_COLUMNS = {1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 15, 18}
_WRAP_COLUMNS = {9, 12, 14, 16, 17}  # Patient, Procedure, Companies, Patient room, Notes
_COLUMN_WIDTHS = (8, 11, 11, 10, 9, 9, 9, 12, 20, 13, 10, 28, 20, 22, 9, 13, 26, 11)


def schedule_day_bounds_utc(schedule_date: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(schedule_date, time.min, tzinfo=HOSPITAL_TIMEZONE)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


async def load_daily_schedule(
    db: AsyncSession,
    schedule_date: date,
) -> tuple[list[OperatingRoom], list[SurgicalCase]]:
    start_utc, end_utc = schedule_day_bounds_utc(schedule_date)
    room_result = await db.execute(select(OperatingRoom))
    case_result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.companies),
            selectinload(SurgicalCase.scheduled_room),
        )
        .where(SurgicalCase.scheduled_start >= start_utc, SurgicalCase.scheduled_start < end_utc)
        .order_by(SurgicalCase.scheduled_start)
    )
    rooms = sorted(room_result.scalars().all(), key=lambda room: _room_sort_key(room.room_code))
    return rooms, list(case_result.scalars().all())


async def load_filtered_schedule(
    db: AsyncSession,
    case_ids: Sequence[UUID],
) -> tuple[list[OperatingRoom], list[SurgicalCase]]:
    """Load an exact, ordered admin-view selection for Excel export."""
    room_result = await db.execute(select(OperatingRoom))
    rooms = sorted(room_result.scalars().all(), key=lambda room: _room_sort_key(room.room_code))
    unique_ids = list(dict.fromkeys(case_ids))
    if not unique_ids:
        return rooms, []

    case_result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.companies),
            selectinload(SurgicalCase.scheduled_room),
        )
        .where(SurgicalCase.id.in_(unique_ids))
    )
    cases_by_id = {case.id: case for case in case_result.scalars().all()}
    return rooms, [cases_by_id[case_id] for case_id in unique_ids if case_id in cases_by_id]


def _room_sort_key(room_code: str) -> tuple[str, int | str]:
    prefix = room_code.rstrip("0123456789")
    suffix = room_code[len(prefix) :]
    return prefix, int(suffix) if suffix else room_code


def _local_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(HOSPITAL_TIMEZONE)


def _case_status(case: SurgicalCase) -> str:
    if case.current_phase == CasePhase.CANCELLED:
        return "Cancelled"
    if case.current_phase == CasePhase.COMPLETE:
        return "Completed"
    if case.current_phase == CasePhase.IDLE:
        return "Upcoming"
    return "Active"


def _patient_values(case: SurgicalCase) -> tuple[str, str, str]:
    if case.patient:
        patient_name = f"{case.patient.first_name} {case.patient.last_name}".strip()
        mrn = case.patient.mrn or ""
        age = case.patient.age
        sex = case.patient.sex
    else:
        patient_name = ""
        mrn = ""
        age = case.patient_age
        sex = case.patient_gender
    age_sex = " / ".join(str(value) for value in (age, sex) if value not in (None, ""))
    return patient_name, mrn, age_sex


def _actual_timing(case: SurgicalCase) -> tuple[str, str, int | str]:
    """Real in/out clock times and elapsed minutes, blank until they exist."""
    actual_in = _local_datetime(case.actual_start_at).strftime("%H:%M") if case.actual_start_at else ""
    actual_out = _local_datetime(case.actual_end_at).strftime("%H:%M") if case.actual_end_at else ""
    actual_min: int | str = ""
    if case.actual_start_at and case.actual_end_at:
        elapsed = (case.actual_end_at - case.actual_start_at).total_seconds() / 60
        actual_min = max(0, round(elapsed))
    return actual_in, actual_out, actual_min


def _status_style(status: str) -> tuple[str, str]:
    return {
        "Active": (AMBER, AMBER_TEXT),
        "Completed": (GREEN, GREEN_TEXT),
        "Cancelled": (RED, RED_TEXT),
        "Upcoming": (LIGHT_BLUE, BLUE),
    }[status]


def build_schedule_workbook(
    schedule_date: date | None,
    rooms: Sequence[OperatingRoom],
    cases: Sequence[SurgicalCase],
    *,
    generated_at: datetime | None = None,
    report_label: str | None = None,
    preserve_order: bool = False,
) -> bytes:
    generated_local = _local_datetime(generated_at or datetime.now(UTC))
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Daily Schedule"
    sheet.sheet_view.showGridLines = False

    thin_border = Border(
        left=Side(style="thin", color=BORDER),
        right=Side(style="thin", color=BORDER),
        top=Side(style="thin", color=BORDER),
        bottom=Side(style="thin", color=BORDER),
    )

    # ── Title band
    sheet.merge_cells(f"A1:{LAST_COLUMN}1")
    title = sheet["A1"]
    title.value = "OPERATING ROOM CASE EXPORT" if report_label else "OPERATING ROOM DAILY SCHEDULE"
    title.fill = PatternFill("solid", fgColor=NAVY)
    title.font = Font(name="Arial", size=18, bold=True, color=WHITE)
    title.alignment = Alignment(horizontal="center", vertical="center")
    sheet.row_dimensions[1].height = 34

    # ── Summary band spread evenly across the row
    rooms_used = len({case.scheduled_room.room_code for case in cases if case.scheduled_room})
    quarter = max(1, COLUMN_COUNT // 4)
    schedule_summary = report_label or (
        f"Schedule date\n{schedule_date.strftime('%A, %d %B %Y')}" if schedule_date else "Schedule date\nNot specified"
    )
    spans = [
        (1, quarter, schedule_summary),
        (quarter + 1, 2 * quarter, f"Total cases\n{len(cases)}"),
        (2 * quarter + 1, 3 * quarter, f"Rooms used\n{rooms_used} of {len(rooms)}"),
        (3 * quarter + 1, COLUMN_COUNT, f"Generated\n{generated_local.strftime('%d %b %Y %H:%M')}"),
    ]
    for start_col, end_col, value in spans:
        sheet.merge_cells(start_row=2, start_column=start_col, end_row=3, end_column=end_col)
        cell = sheet.cell(2, start_col, value)
        cell.fill = PatternFill("solid", fgColor=LIGHT_BLUE)
        cell.font = Font(name="Arial", size=10, bold=True, color=NAVY)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
    sheet.row_dimensions[2].height = 25
    sheet.row_dimensions[3].height = 25

    # ── One header row for the whole table
    header_row = 4
    for column, header in enumerate(TABLE_HEADERS, start=1):
        cell = sheet.cell(header_row, column, header)
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.font = Font(name="Arial", size=9, bold=True, color=WHITE)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
    sheet.row_dimensions[header_row].height = 28

    # ── Flat body, sorted by room then start time (Room is its own column now)
    room_order = {room.room_code: index for index, room in enumerate(rooms)}
    ordered_cases = list(cases)
    if not preserve_order:
        ordered_cases.sort(
            key=lambda item: (
                room_order.get(item.scheduled_room.room_code if item.scheduled_room else "", len(rooms)),
                item.scheduled_start,
            )
        )

    current_row = header_row + 1
    if not ordered_cases:
        sheet.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=COLUMN_COUNT)
        empty_cell = sheet.cell(current_row, 1, "No cases scheduled for this date")
        empty_cell.fill = PatternFill("solid", fgColor=PALE_BLUE)
        empty_cell.font = Font(name="Arial", size=10, italic=True, color=MUTED)
        empty_cell.alignment = Alignment(horizontal="center", vertical="center")
        empty_cell.border = thin_border
        sheet.row_dimensions[current_row].height = 24
        current_row += 1
    else:
        for index, case in enumerate(ordered_cases):
            start = _local_datetime(case.scheduled_start)
            planned_end = start + timedelta(minutes=case.estimated_duration_min)
            actual_in, actual_out, actual_min = _actual_timing(case)
            patient_name, mrn, age_sex = _patient_values(case)
            status = _case_status(case)
            surgeon = f"{case.doctor.first_name} {case.doctor.last_name}".strip()
            companies = ", ".join(company.name for company in case.companies)
            room_code = case.scheduled_room.room_code if case.scheduled_room else "Unassigned"
            values = (
                room_code,
                start.strftime("%H:%M"),
                planned_end.strftime("%H:%M"),
                case.estimated_duration_min,
                actual_in,
                actual_out,
                actual_min,
                case.case_code,
                patient_name,
                mrn,
                age_sex,
                case.procedure_name,
                surgeon,
                companies,
                "Yes" if case.isolation_required else "No",
                case.patient_room or "",
                case.notes or "",
                status,
            )
            row_fill = WHITE if index % 2 == 0 else PALE_BLUE
            for column, value in enumerate(values, start=1):
                cell = sheet.cell(current_row, column, value)
                cell.fill = PatternFill("solid", fgColor=row_fill)
                cell.font = Font(name="Arial", size=9, color=TEXT)
                cell.alignment = Alignment(
                    horizontal="center" if column in _CENTER_COLUMNS else "left",
                    vertical="center",
                    wrap_text=column in _WRAP_COLUMNS,
                )
                cell.border = thin_border
            sheet.cell(current_row, 1).font = Font(name="Arial", size=9, bold=True, color=NAVY)
            status_fill, status_text = _status_style(status)
            status_cell = sheet.cell(current_row, COLUMN_COUNT)
            status_cell.fill = PatternFill("solid", fgColor=status_fill)
            status_cell.font = Font(name="Arial", size=9, bold=True, color=status_text)
            if status == "Cancelled":
                for column in range(1, COLUMN_COUNT):
                    sheet.cell(current_row, column).font = Font(name="Arial", size=9, color=MUTED, strike=True)
            sheet.row_dimensions[current_row].height = 30
            current_row += 1

    for index, width in enumerate(_COLUMN_WIDTHS, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width

    last_row = max(current_row - 1, header_row)
    # Freeze title/summary/header — only the single header row stays pinned while scrolling.
    sheet.freeze_panes = f"A{header_row + 1}"
    sheet.auto_filter.ref = f"A{header_row}:{LAST_COLUMN}{last_row}"
    sheet.print_area = f"A1:{LAST_COLUMN}{last_row}"
    sheet.print_title_rows = f"{header_row}:{header_row}"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins.left = 0.25
    sheet.page_margins.right = 0.25
    sheet.page_margins.top = 0.4
    sheet.page_margins.bottom = 0.4
    sheet.oddFooter.center.text = "Page &P of &N"
    sheet.oddFooter.center.size = 8
    sheet.oddFooter.center.color = MUTED

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
