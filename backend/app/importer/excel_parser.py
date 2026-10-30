"""
Parser for the hospital's hand-maintained OR schedule spreadsheets.

These files are laid out for humans, not machines: a merged title block sits above
the header row, the room is a merged cell spanning each room's block of rows rather
than a per-row value, times are free text with no AM/PM, and the schedule date
appears once in the title block. Everything this module infers is recorded as a
ParseWarning so an admin can check the import instead of trusting it blindly.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from io import BytesIO

import openpyxl

logger = logging.getLogger(__name__)

# How far down to look for the header row before giving up.
_HEADER_SEARCH_ROWS = 12

# A header row must contain both of these (substring match, case-insensitive).
_HEADER_ANCHORS = ("procedure", "surgeon")

# Canonical field -> substrings that identify its column in the header row.
# Matched as substrings because the source headers carry typos and trailing
# spaces ("Time schedu", "Procedure ").
_COLUMN_PATTERNS: dict[str, tuple[str, ...]] = {
    "time": ("time schedu", "time sched", "scheduled time"),
    "patient_name": ("name",),
    "case_no": ("case no", "case number", "file no"),
    "dob": ("dob", "birth"),
    "procedure": ("procedure",),
    "surgeon": ("surgeon", "doctor"),
    "code": ("code",),
    "company": ("company", "insurance"),
}

_ROOM_RE = re.compile(r"^(?:OR|R)\s*(\d+)$", re.IGNORECASE)
_DATE_RE = re.compile(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})")
_TIME_RE = re.compile(r"^(\d{1,2})\s*[.:]\s*(\d{1,2})?")

# Arabic honorifics prefixing surgeon names: "د." / "د" (Dr.), "دكتور".
_HONORIFIC_RE = re.compile(r"^\s*(?:دكتورة|دكتور|د)\s*[.،]?\s*")

# An OR day runs from the early morning into the afternoon. Times are written on a
# 12-hour clock with no meridiem, so hours at or above this are read as AM and the
# rest as PM: 7.30 -> 07:30, 12.00 -> 12:00, 1.00 -> 13:00.
_AM_CUTOFF_HOUR = 7

_MIN_BIRTH_YEAR = 1900


@dataclass
class ParseWarning:
    row: int | None
    message: str
    # True for anything a human should look at (a skipped row, dropped data, a
    # fallback); False for routine notes that merely record a resolved value.
    notable: bool = False

    def format(self) -> str:
        return f"Row {self.row}: {self.message}" if self.row else self.message


@dataclass
class RawCaseRow:
    doctor_first_name: str
    doctor_last_name: str
    procedure_name: str
    room_code: str
    scheduled_start: datetime
    patient_first_name: str | None
    patient_last_name: str | None
    patient_mrn: str | None
    patient_age: int | None
    patient_sex: str | None
    procedure_code: str | None
    note: str | None
    source_row: int
    # Not present in the source sheet — derived from the gap to the next case in
    # the same room by app.services.import_service.
    estimated_duration_min: int | None = None


@dataclass
class ParseResult:
    rows: list[RawCaseRow]
    schedule_date: date
    warnings: list[ParseWarning] = field(default_factory=list)


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _find_header_row(ws) -> tuple[int, dict[str, int]]:
    """Locate the header row and map canonical field names to column indexes."""
    for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=_HEADER_SEARCH_ROWS), start=1):
        texts = [_cell_text(cell.value).lower() for cell in row]
        joined = " | ".join(texts)
        if not all(anchor in joined for anchor in _HEADER_ANCHORS):
            continue

        columns: dict[str, int] = {}
        for field_name, patterns in _COLUMN_PATTERNS.items():
            for col_idx, text in enumerate(texts):
                if not text:
                    continue
                if any(pattern in text for pattern in patterns):
                    columns.setdefault(field_name, col_idx)
                    break
        return row_idx, columns

    raise ValueError(
        "Could not find a header row — expected a row containing both 'Procedure' and 'Surgeon' "
        f"within the first {_HEADER_SEARCH_ROWS} rows."
    )


def _parse_dmy(text: str) -> date | None:
    """Read a day-month-year date out of arbitrary text ('Date:5-6-2026' -> 2026-06-05)."""
    match = _DATE_RE.search(text)
    if not match:
        return None
    day, month, year = (int(g) for g in match.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _find_schedule_date(ws, header_row: int, filename: str | None) -> tuple[date, list[ParseWarning]]:
    """The date lives once in the title block above the header; the filename is the fallback."""
    warnings: list[ParseWarning] = []
    labelled: date | None = None
    unlabelled: date | None = None

    # The title block holds more than one date — a revision stamp ("Apd 12/06/2024")
    # as well as the schedule date ("Date:5-6-2026"). Prefer the cell that says so.
    for row in ws.iter_rows(min_row=1, max_row=max(header_row - 1, 1)):
        for cell in row:
            text = _cell_text(cell.value)
            parsed = _parse_dmy(text)
            if not parsed:
                continue
            if "date" in text.lower():
                labelled = labelled or parsed
            else:
                unlabelled = unlabelled or parsed

    if labelled:
        return labelled, warnings
    if unlabelled:
        warnings.append(
            ParseWarning(
                None,
                f"No cell labelled 'Date' above the header — using {unlabelled.isoformat()} "
                "found in the title block.",
            )
        )
        return unlabelled, warnings

    if filename:
        parsed = _parse_dmy(filename)
        if parsed:
            warnings.append(
                ParseWarning(None, f"No date found in the sheet header — using {parsed.isoformat()} from the filename.", notable=True)
            )
            return parsed, warnings

    raise ValueError(
        "Could not determine the schedule date. Expected a cell like 'Date:5-6-2026' above the header row, "
        "or a d-m-yyyy date in the filename."
    )


def _normalize_room_code(anchor: str) -> str | None:
    """
    'R1' -> 'OR1'.

    The schedules label theatres R1–R6 while the system's operating rooms are
    OR1–OR12 (see the 20260718_0001 seed migration), so the sheet's shorthand is
    normalized to the system's naming here. 'OR1' is accepted unchanged.
    """
    match = _ROOM_RE.match(anchor)
    if not match:
        return None
    return f"OR{int(match.group(1))}"


def _build_room_map(ws, header_row: int) -> dict[int, str]:
    """
    Map each sheet row to its (normalized) room code.

    Rooms are written once per block as a merged cell in the first column
    (A4:A10 = R1, A11:A17 = R2, ...). Unmerged room cells are forward-filled to the
    rows beneath them.
    """
    row_to_room: dict[int, str] = {}

    for merged in ws.merged_cells.ranges:
        room_code = _normalize_room_code(_cell_text(ws.cell(row=merged.min_row, column=merged.min_col).value))
        if room_code is None:
            continue
        for row_idx in range(merged.min_row, merged.max_row + 1):
            row_to_room[row_idx] = room_code

    current: str | None = None
    for row_idx in range(1, ws.max_row + 1):
        anchor = _normalize_room_code(_cell_text(ws.cell(row=row_idx, column=1).value))
        if anchor is not None:
            current = anchor
        if row_idx in row_to_room:
            current = row_to_room[row_idx]
        elif current is not None and row_idx > header_row:
            row_to_room[row_idx] = current

    return row_to_room


def _parse_time(raw: str) -> time | None:
    """'7.30.' -> 07:30, '1.00.' -> 13:00, '12.00.' -> 12:00."""
    text = raw.strip().rstrip(".").strip()
    if not text:
        return None
    match = _TIME_RE.match(text)
    if not match:
        return None

    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    if minute > 59:
        return None

    if hour == 0 or hour > 24:
        return None
    if hour < _AM_CUTOFF_HOUR:
        # Afternoon on a 12-hour clock: 1.00 -> 13:00. 12 is already correct.
        hour += 12
    if hour > 23:
        return None

    return time(hour=hour, minute=minute)


def _split_surgeon(raw: str) -> tuple[str, str]:
    """
    'د.رعد رحاب رعد' -> ('رعد', 'رحاب رعد').

    Strips the Arabic honorific, then treats the first token as the given name and
    the rest as the family name. A lone token becomes the family name so it renders
    the right way round.
    """
    cleaned = _HONORIFIC_RE.sub("", raw.strip())
    tokens = cleaned.split()
    if not tokens:
        return "", ""
    if len(tokens) == 1:
        return "", tokens[0]
    return tokens[0], " ".join(tokens[1:])


def _parse_mrn(value: object) -> str | None:
    """
    Column 'case no' arrives as a float because Excel stored it as a number.

    repr() avoids scientific notation, but trailing zeros were already lost when the
    file was written — this cannot round-trip exactly and is flagged to the caller.
    """
    if value is None:
        return None
    if isinstance(value, float):
        return repr(int(value)) if value.is_integer() else repr(value)
    return str(value).strip() or None


def _parse_age(dob_value: object, schedule_date: date) -> int | None:
    """The DOB column holds a birth year only, so age is a year subtraction."""
    if dob_value is None:
        return None
    try:
        year = int(float(str(dob_value).strip()))
    except (TypeError, ValueError):
        return None
    if not (_MIN_BIRTH_YEAR <= year <= schedule_date.year):
        return None
    return schedule_date.year - year


def parse_excel(file_bytes: bytes, filename: str | None = None) -> ParseResult:
    """
    Parse an OR schedule spreadsheet into raw case rows.

    Raises ValueError if the layout cannot be recognised, the schedule date cannot be
    determined, or no usable rows are found.
    """
    try:
        wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
    except Exception as e:
        # openpyxl raises BadZipFile / KeyError / its own errors depending on how
        # the file is damaged; none of them are useful to show as a 500.
        raise ValueError(f"Could not open the file as an Excel workbook: {e}") from e

    if not wb.worksheets:
        raise ValueError("The workbook has no sheets.")
    ws = wb.worksheets[0]

    header_row, columns = _find_header_row(ws)
    schedule_date, warnings = _find_schedule_date(ws, header_row, filename)
    row_to_room = _build_room_map(ws, header_row)

    missing_fields = [name for name in ("time", "procedure", "surgeon") if name not in columns]
    if missing_fields:
        raise ValueError(f"Header row {header_row} is missing required columns: {', '.join(missing_fields)}")

    def cell(row: tuple, key: str) -> object:
        idx = columns.get(key)
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    rows: list[RawCaseRow] = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=header_row + 1, values_only=True), start=header_row + 1):
        time_text = _cell_text(cell(row, "time"))
        procedure = _cell_text(cell(row, "procedure"))
        surgeon = _cell_text(cell(row, "surgeon"))

        # A row is a case only if it has both a time and a procedure. Section
        # markers ("Add on"), spacer rows and half-filled rows are not cases.
        if not time_text or not procedure:
            if time_text or procedure or surgeon:
                warnings.append(
                    ParseWarning(row_idx, f"Skipped — incomplete row (time={time_text!r}, procedure={procedure!r})", notable=True)
                )
            continue

        scheduled_time = _parse_time(time_text)
        if scheduled_time is None:
            warnings.append(ParseWarning(row_idx, f"Skipped — could not read the time {time_text!r}", notable=True))
            continue

        room_code = row_to_room.get(row_idx)
        if not room_code:
            warnings.append(ParseWarning(row_idx, f"Skipped — no room block covers this row ({procedure!r})", notable=True))
            continue

        if not surgeon:
            warnings.append(ParseWarning(row_idx, f"Skipped — no surgeon for {procedure!r}", notable=True))
            continue

        # "د.بشناق +د.عزالدين" — two surgeons on one case. A case has a single
        # doctor, so the first is used and the other is reported.
        surgeon_parts = [part.strip() for part in surgeon.split("+") if part.strip()]
        if len(surgeon_parts) > 1:
            warnings.append(
                ParseWarning(row_idx, f"Multiple surgeons listed — using {surgeon_parts[0]!r}, "
                             f"dropped {', '.join(repr(p) for p in surgeon_parts[1:])}", notable=True)
            )
        first_name, last_name = _split_surgeon(surgeon_parts[0])
        if not first_name and not last_name:
            warnings.append(ParseWarning(row_idx, f"Skipped — could not read the surgeon name {surgeon!r}", notable=True))
            continue

        mrn = _parse_mrn(cell(row, "case_no"))
        patient_name = _cell_text(cell(row, "patient_name"))
        patient_first, patient_last = "", ""
        if patient_name:
            name_tokens = patient_name.split()
            patient_first = name_tokens[0]
            patient_last = " ".join(name_tokens[1:])

        warnings.append(
            ParseWarning(row_idx, f"Read {time_text!r} as {scheduled_time.strftime('%H:%M')} in room {room_code}")
        )

        rows.append(
            RawCaseRow(
                doctor_first_name=first_name,
                doctor_last_name=last_name,
                procedure_name=procedure,
                room_code=room_code,
                scheduled_start=datetime.combine(schedule_date, scheduled_time),
                patient_first_name=patient_first or None,
                patient_last_name=patient_last or None,
                patient_mrn=mrn,
                patient_age=_parse_age(cell(row, "dob"), schedule_date),
                patient_sex=None,
                procedure_code=_cell_text(cell(row, "code")) or None,
                note=_cell_text(cell(row, "company")) or None,
                source_row=row_idx,
            )
        )

    if not rows:
        raise ValueError(
            f"No usable case rows found below header row {header_row}. "
            "Each case needs a scheduled time, a procedure and a surgeon."
        )

    logger.info(
        "Parsed schedule: date=%s cases=%d warnings=%d", schedule_date.isoformat(), len(rows), len(warnings)
    )
    return ParseResult(rows=rows, schedule_date=schedule_date, warnings=warnings)
