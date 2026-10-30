from datetime import UTC, date, datetime
from io import BytesIO
from types import SimpleNamespace

from openpyxl import load_workbook

from app.domain.enums import CasePhase
from app.services.schedule_export_service import _room_sort_key, build_schedule_workbook, schedule_day_bounds_utc


def _case(room, *, code: str, phase: CasePhase, hour: int, patient=None, actual_start=None, actual_end=None):
    return SimpleNamespace(
        scheduled_room=room,
        scheduled_start=datetime(2026, 6, 5, hour, 30, tzinfo=UTC),
        estimated_duration_min=90,
        actual_start_at=actual_start,
        actual_end_at=actual_end,
        case_code=code,
        current_phase=phase,
        patient=patient,
        patient_age=None,
        patient_gender=None,
        procedure_name="عملية تجريبية",
        doctor=SimpleNamespace(first_name="رعد", last_name="رحاب"),
        companies=[SimpleNamespace(name="Acme Medical"), SimpleNamespace(name="Vision Lenses")],
        isolation_required=True,
        patient_room="Ward 4 / 218",
        notes="Use lens model XR-20",
    )


def test_schedule_day_bounds_use_beirut_summer_calendar_day() -> None:
    start, end = schedule_day_bounds_utc(date(2026, 6, 5))

    assert start == datetime(2026, 6, 4, 21, 0, tzinfo=UTC)
    assert end == datetime(2026, 6, 5, 21, 0, tzinfo=UTC)


def test_schedule_day_bounds_use_beirut_winter_calendar_day() -> None:
    start, end = schedule_day_bounds_utc(date(2026, 1, 5))

    assert start == datetime(2026, 1, 4, 22, 0, tzinfo=UTC)
    assert end == datetime(2026, 1, 5, 22, 0, tzinfo=UTC)


def test_room_codes_sort_naturally() -> None:
    room_codes = ["OR1", "OR10", "OR2", "OR12", "OR3"]

    assert sorted(room_codes, key=_room_sort_key) == ["OR1", "OR2", "OR3", "OR10", "OR12"]


def test_workbook_is_flat_single_table_and_preserves_unicode() -> None:
    room1 = SimpleNamespace(room_code="OR1")
    room2 = SimpleNamespace(room_code="OR2")
    patient = SimpleNamespace(first_name="علي", last_name="حسن", mrn="MRN-22", age=45, sex="M")
    cases = [
        _case(room1, code="S20260605001", phase=CasePhase.IDLE, hour=4, patient=patient),
        _case(room1, code="S20260605002", phase=CasePhase.CANCELLED, hour=6),
        _case(
            room2,
            code="S20260605003",
            phase=CasePhase.COMPLETE,
            hour=5,
            actual_start=datetime(2026, 6, 5, 5, 40, tzinfo=UTC),  # 08:40 Beirut (summer)
            actual_end=datetime(2026, 6, 5, 7, 25, tzinfo=UTC),  # 10:25 Beirut (summer) -> 105 min
        ),
    ]

    payload = build_schedule_workbook(
        date(2026, 6, 5),
        [room1, room2],
        cases,
        generated_at=datetime(2026, 6, 5, 8, 0, tzinfo=UTC),
    )
    workbook = load_workbook(BytesIO(payload))
    sheet = workbook["Daily Schedule"]
    values = [cell.value for row in sheet.iter_rows() for cell in row]

    assert sheet["A1"].value == "OPERATING ROOM DAILY SCHEDULE"
    assert sheet["A1"].fill.fgColor.rgb.endswith("0F2044")
    # Only the single header row (row 4) is frozen/repeated — no per-room banners.
    assert sheet.freeze_panes == "A5"
    assert sheet.page_setup.orientation == "landscape"
    assert sheet.print_title_rows == "$4:$4"

    # Header row appears exactly once, and "Room" is now its own column.
    assert values.count("Room") == 1
    assert values.count("Companies") == 1
    assert sheet["A4"].value == "Room"
    # Room lives in the data cells now, not a grouped banner.
    assert "OR1" in values
    assert not any(isinstance(v, str) and "scheduled case(s)" in v for v in values)
    # Rooms with no cases simply do not appear as rows.
    assert not any(isinstance(v, str) and v.startswith("No cases") for v in values)

    assert "علي حسن" in values
    assert "عملية تجريبية" in values
    assert "رعد رحاب" in values
    assert "Acme Medical, Vision Lenses" in values
    assert "Yes" in values
    assert "Ward 4 / 218" in values
    assert "Use lens model XR-20" in values
    assert "Cancelled" in values

    # Completed case exposes real in/out clock times and elapsed minutes.
    assert values.count("Actual in") == 1
    assert "08:40" in values
    assert "10:25" in values
    assert 105 in values

    cancelled_cell = next(cell for row in sheet.iter_rows() for cell in row if cell.value == "Cancelled")
    assert cancelled_cell.fill.fgColor.rgb.endswith("FEE2E2")
    # The room cell (column 1) is struck through for cancelled rows.
    assert sheet.cell(cancelled_cell.row, 1).font.strike is True


def test_workbook_handles_a_day_without_cases() -> None:
    room = SimpleNamespace(room_code="OR1")
    payload = build_schedule_workbook(date(2026, 6, 5), [room], [])
    sheet = load_workbook(BytesIO(payload))["Daily Schedule"]
    values = [cell.value for row in sheet.iter_rows() for cell in row]

    assert "No cases scheduled for this date" in values
    assert any(isinstance(v, str) and v == "Total cases\n0" for v in values)


def test_filtered_workbook_preserves_the_current_view_order() -> None:
    room = SimpleNamespace(room_code="OR1")
    first = _case(room, code="S20260605002", phase=CasePhase.COMPLETE, hour=6)
    second = _case(room, code="S20260605001", phase=CasePhase.COMPLETE, hour=4)

    payload = build_schedule_workbook(
        None,
        [room],
        [first, second],
        report_label="Filtered admin view",
        preserve_order=True,
    )
    sheet = load_workbook(BytesIO(payload))["Daily Schedule"]

    assert sheet["A1"].value == "OPERATING ROOM CASE EXPORT"
    assert sheet["A2"].value == "Filtered admin view"
    assert sheet["H5"].value == "S20260605002"
    assert sheet["H6"].value == "S20260605001"
