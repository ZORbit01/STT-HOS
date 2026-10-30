from datetime import date, datetime
from io import BytesIO

import openpyxl
import pytest

from app.importer.excel_parser import parse_excel
from app.services.import_service import DEFAULT_DURATION_MIN, derive_durations

HEADERS = [
    "R1",
    "Time schedu",
    "Time Req",
    "Arrive time",
    "Name ",
    "case no",
    "DOB",
    "Room",
    "Procedure ",
    "Surgeon ",
    "code",
    "Company",
]

# Column indexes within a data row, matching HEADERS above.
_TIME, _NAME, _CASE_NO, _DOB, _PROCEDURE, _SURGEON, _CODE = 1, 4, 5, 6, 8, 9, 10


def _row(time=None, procedure=None, surgeon=None, case_no=None, dob=None, name=None, code=None):
    cells = [None] * 12
    cells[_TIME] = time
    cells[_NAME] = name
    cells[_CASE_NO] = case_no
    cells[_DOB] = dob
    cells[_PROCEDURE] = procedure
    cells[_SURGEON] = surgeon
    cells[_CODE] = code
    return cells


def build_workbook(blocks, date_text="Date:5-6-2026", stamp="Apd 12/06/2024"):
    """
    Build a sheet shaped like the real OR schedules.

    `blocks` is a list of (room_code, [data rows]); the room code is written once and
    merged down its block, mirroring how the source files are laid out.
    """
    wb = openpyxl.Workbook()
    ws = wb.active

    ws.cell(row=1, column=4, value="OR SCHEDULE")
    if stamp:
        ws.cell(row=2, column=1, value=stamp)
    if date_text:
        ws.cell(row=3, column=5, value=date_text)

    header_row = 4
    for col, header in enumerate(HEADERS, start=1):
        ws.cell(row=header_row, column=col, value=header)

    current = header_row
    for room_code, rows in blocks:
        start = current + 1
        for offset, cells in enumerate(rows):
            for col, value in enumerate(cells, start=1):
                if value is not None:
                    ws.cell(row=start + offset, column=col, value=value)
        end = start + max(len(rows), 1) - 1
        # The room code is written once at the top of its block and merged downwards.
        ws.cell(row=start, column=1, value=room_code)
        if end > start:
            ws.merge_cells(start_row=start, start_column=1, end_row=end, end_column=1)
        current = end

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _parse(blocks, filename="5-6-2026.xlsx", **kwargs):
    return parse_excel(build_workbook(blocks, **kwargs), filename)


def test_finds_header_below_title_block_and_reads_a_case() -> None:
    result = _parse([("R1", [_row("7.30.", "Umbilical hernia", "د.رعد رحاب رعد", code="R49550")])])

    assert len(result.rows) == 1
    row = result.rows[0]
    # The sheet says "R1"; the system's rooms are OR1–OR6, so codes are normalized.
    assert row.room_code == "OR1"
    assert row.procedure_name == "Umbilical hernia"
    assert row.procedure_code == "R49550"


def test_schedule_date_prefers_the_labelled_cell_over_the_revision_stamp() -> None:
    # "Apd 12/06/2024" sits above the header alongside "Date:5-6-2026"; only the
    # latter is the schedule date, and both are day-month-year.
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد")])])

    assert result.schedule_date == date(2026, 6, 5)


def test_schedule_date_falls_back_to_the_filename() -> None:
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد")])], date_text=None, stamp=None)

    assert result.schedule_date == date(2026, 6, 5)
    assert any("filename" in w.message for w in result.warnings)


def test_missing_schedule_date_is_an_error() -> None:
    with pytest.raises(ValueError, match="schedule date"):
        _parse([("R1", [_row("7.30.", "Hernia", "د.رعد")])], filename="schedule.xlsx", date_text=None, stamp=None)


@pytest.mark.parametrize(
    ("raw", "expected_hour", "expected_minute"),
    [
        ("7.30.", 7, 30),
        ("9.00.", 9, 0),
        ("11.30.", 11, 30),
        ("12.00.", 12, 0),  # noon, not midnight
        ("1.00.", 13, 0),  # afternoon on a 12-hour clock
        ("1.30.", 13, 30),
        ("6.00.", 18, 0),
    ],
)
def test_dotted_times_resolve_on_the_or_day_clock(raw, expected_hour, expected_minute) -> None:
    result = _parse([("R1", [_row(raw, "Hernia", "د.رعد")])])

    assert result.rows[0].scheduled_start == datetime(2026, 6, 5, expected_hour, expected_minute)


def test_rooms_come_from_merged_blocks_in_the_first_column() -> None:
    result = _parse(
        [
            ("R1", [_row("7.30.", "Hernia", "د.رعد"), _row("9.00.", "Tibia", "د.محمود")]),
            ("R2", [_row("7.30.", "Lens extraction", "د.علي")]),
        ]
    )

    assert [(r.room_code, r.procedure_name) for r in result.rows] == [
        ("OR1", "Hernia"),
        ("OR1", "Tibia"),
        ("OR2", "Lens extraction"),
    ]


def test_room_block_with_no_cases_contributes_nothing() -> None:
    result = _parse(
        [
            ("R1", [_row("7.30.", "Hernia", "د.رعد")]),
            ("R5", [_row()]),
            ("R6", [_row("9.00.", "Cesarean", "د.مريم")]),
        ]
    )

    assert {r.room_code for r in result.rows} == {"OR1", "OR6"}


@pytest.mark.parametrize("marker", ["R1", "OR1", "r1", "R 1"])
def test_room_markers_normalize_to_the_system_naming(marker) -> None:
    result = _parse([(marker, [_row("7.30.", "Hernia", "د.رعد")])])

    assert result.rows[0].room_code == "OR1"


def test_arabic_honorific_is_stripped_and_the_name_is_split() -> None:
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد رحاب رعد")])])

    assert result.rows[0].doctor_first_name == "رعد"
    assert result.rows[0].doctor_last_name == "رحاب رعد"


def test_single_token_surgeon_becomes_the_family_name() -> None:
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.بشناق")])])

    assert result.rows[0].doctor_first_name == ""
    assert result.rows[0].doctor_last_name == "بشناق"


def test_co_surgeon_is_dropped_but_reported() -> None:
    result = _parse([("R1", [_row("7.30.", "Lcp Ulna", "د.بشناق +د.عزالدين")])])

    assert result.rows[0].doctor_last_name == "بشناق"
    assert any("عزالدين" in w.message and "dropped" in w.message for w in result.warnings)


def test_year_only_dob_becomes_an_age() -> None:
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد", dob=1992)])])

    assert result.rows[0].patient_age == 2026 - 1992


@pytest.mark.parametrize("dob", [1800, 2030, "n/a", None])
def test_implausible_dob_yields_no_age(dob) -> None:
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد", dob=dob)])])

    assert result.rows[0].patient_age is None


def test_case_no_float_is_read_without_scientific_notation() -> None:
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد", case_no=5690.753905)])])

    assert result.rows[0].patient_mrn == "5690.753905"


def test_rows_without_a_procedure_are_skipped_and_reported() -> None:
    # Mirrors the real sheet's row 26: a time was pencilled in but no case booked.
    result = _parse(
        [("R1", [_row("7.30.", "Hernia", "د.رعد"), _row("11.30."), _row(procedure="Add on")])]
    )

    assert len(result.rows) == 1
    assert sum("Skipped" in w.message for w in result.warnings) == 2


def test_row_without_a_surgeon_is_skipped() -> None:
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد"), _row("9.00.", "Tibia")])])

    assert len(result.rows) == 1


def test_no_usable_rows_is_an_error() -> None:
    with pytest.raises(ValueError, match="No usable case rows"):
        _parse([("R1", [_row(procedure="Add on")])])


def test_a_file_that_is_not_a_workbook_is_a_value_error() -> None:
    # Reaches the caller as a 422, not an unhandled 500.
    with pytest.raises(ValueError, match="Could not open the file"):
        parse_excel(b"this is not a spreadsheet", "notes.xlsx")


def test_unrecognisable_layout_is_an_error() -> None:
    wb = openpyxl.Workbook()
    wb.active.append(["patient", "when", "what"])
    buffer = BytesIO()
    wb.save(buffer)

    with pytest.raises(ValueError, match="header row"):
        parse_excel(buffer.getvalue(), "sheet.xlsx")


def test_durations_come_from_the_gap_to_the_next_case_in_the_room() -> None:
    result = _parse(
        [
            (
                "R1",
                [
                    _row("7.30.", "Hernia", "د.رعد"),
                    _row("9.00.", "Tibia", "د.محمود"),
                    _row("10.30.", "Cysto", "د.محمد"),
                ],
            ),
            ("R2", [_row("7.30.", "Lens", "د.علي")]),
        ]
    )

    derive_durations(result.rows)
    by_procedure = {r.procedure_name: r.estimated_duration_min for r in result.rows}

    assert by_procedure["Hernia"] == 90
    assert by_procedure["Tibia"] == 90
    # Last case in each room has no successor to measure against.
    assert by_procedure["Cysto"] == DEFAULT_DURATION_MIN
    assert by_procedure["Lens"] == DEFAULT_DURATION_MIN


def test_skips_are_notable_but_resolved_times_are_not() -> None:
    # The audit trail is length-capped, so only warnings a human should act on
    # are flagged; the per-row "read this time as that" notes are routine.
    result = _parse([("R1", [_row("7.30.", "Hernia", "د.رعد"), _row("11.30.")])])

    notable = [w for w in result.warnings if w.notable]
    assert len(notable) == 1
    assert "Skipped" in notable[0].message
    assert all(not w.notable for w in result.warnings if w.message.startswith("Read "))


def test_durations_are_clamped_to_a_sane_range() -> None:
    result = _parse([("R1", [_row("7.30.", "Quick", "د.رعد"), _row("7.30.", "Next", "د.محمود")])])

    derive_durations(result.rows)

    assert all(15 <= r.estimated_duration_min <= 480 for r in result.rows)
