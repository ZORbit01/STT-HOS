# Excel schedule import

How the OR schedule spreadsheets are read into the system, what the parser infers,
and what is still open.

## Why this exists

The import pipeline (upload → cases → WebSocket broadcast) already worked, but its
parser assumed a clean machine-generated table: header in row 1 with columns named
`doctor_first_name`, `doctor_last_name`, `procedure`, `room`, `scheduled_start`,
`estimated_duration_min`. The real files are maintained by hand for human readers and
match none of that, so every import failed with `Missing required columns`.

## The source layout

Taken from `5-6-2026.xlsx`, which is representative.

| Aspect | Reality |
|---|---|
| Header row | Row **4**. Rows 1–3 are a merged title block; `E3` holds `Date:5-6-2026` |
| Columns | `A` room marker, `B` Time schedule, `C` Time Req, `D` Arrive time, `E` Name, `F` case no, `G` DOB, `H` Room *(always empty)*, `I` Procedure, `J` Surgeon, `K` code, `L` Company, `M`–`P` delay/postpond/visit/audit |
| Room | Merged cells in column A (`A4:A10`=R1, `A11:A17`=R2, …), **not** a per-row value |
| Date | Once, in the title block. No per-row date |
| Time | Text with dot separators, no AM/PM: `7.30.`, `1.00.`, `12.00.` |
| Duration | **Absent** — but `SurgicalCase.estimated_duration_min` is `NOT NULL` |
| Surgeon | One Arabic string with a `د.` honorific; occasionally two: `د.بشناق +د.عزالدين` |
| Patient name | Column E was empty on every row |
| case no | A float, e.g. `5690.753905` |
| DOB | A birth **year** only |
| Junk | A time-only row, an empty room block (R5), an `Add on` footer, stray `` ` `` cells |

## What the parser infers

All of it is recorded as a `ParseWarning` and surfaced in the preview, so an import can
be checked rather than trusted.

- **Header row** is located by content (a row containing both `Procedure` and `Surgeon`)
  rather than by position, and columns are matched on substrings so the source's typos
  and trailing spaces (`Time schedu`, `Procedure `) still resolve.
- **Schedule date** is read day-month-year. A cell labelled `Date` wins over any other
  date in the title block — the sheets also carry a revision stamp (`Apd 12/06/2024`)
  that is *not* the schedule date. Falls back to the filename, then errors.
- **Room** comes from the merged ranges in column A, with a forward-fill for unmerged
  markers. Room blocks with no cases contribute nothing. The sheet labels theatres
  `R1`–`R6`; these are normalized to the system's `OR1`–`OR6` naming (the seeded
  operating rooms, per migration `20260718_0001`). `OR1` spelling is accepted as-is.
- **Time** is read on a 12-hour OR-day clock: hours 7–11 are AM, 12 is noon, 1–6 are PM.
- **Surgeon** has the honorific stripped, then splits first token → given name, rest →
  family name. A lone token becomes the family name. With two surgeons the first is
  used and the second is reported as dropped (a case has one `doctor_id`).
- **Age** is `schedule_year − birth_year`, ignoring implausible years.
- **Duration** is derived in `import_service.derive_durations()` from the gap to the
  next case in the same room; the last case in a room gets 60 min. Clamped to 15–480.

A row becomes a case only if it has a time, a procedure and a surgeon. Anything else is
skipped, and reported if it held any data.

## Known limitations

- **`case no` is lossy.** Excel stored it as a number, so a value ending in a zero
  (`5690.753900`) lost it when the file was written. Unrecoverable at parse time. It is
  currently mapped to `Patient.mrn`; confirm that is what the field means.
- **Durations absorb gaps.** A case at 10:30 followed by one at 13:00 is recorded as
  150 minutes, lunch break included.
- **Timezone.** `import_service` stamps these naive times as UTC
  (`scheduled_start.replace(tzinfo=UTC)`), but they are hospital *local* time. Cases
  will render at the wrong hour unless the deployment runs UTC. Not addressed here.
- **`Company` (col L)** is linked to the case *only* when it names a company that
  already exists (matched case-insensitively). The column is used inconsistently in the
  source — an insurer on one row (`SATER`), a lens spec on the next (`mono 23.5`) — so
  the parser never auto-creates companies from it; anything unrecognised is kept as a
  case `note` and flagged in the warnings.
- **`code` (col K)** is parsed and shown in the preview but has no DB column, so it is
  not persisted.
- **Rooms are not seeded.** `R1`–`R6` must exist before an import lands; the admin rooms
  UI is the only creation path. A total room-name mismatch now fails loudly instead of
  reporting a successful import of zero cases.

## Flow

| Step | File |
|---|---|
| Parse | `backend/app/importer/excel_parser.py` → `ParseResult(rows, schedule_date, warnings)` |
| Durations, doctors, patients, cases | `backend/app/services/import_service.py` → `ImportResult` |
| `POST /api/v1/import/excel/preview` (parse only, no writes) | `backend/app/api/imports.py` |
| `POST /api/v1/import/excel` (commits, broadcasts, refreshes STT grammar) | `backend/app/api/imports.py` |
| Preview table, warnings, Confirm | `frontend/src/pages/admin/AdminPage.tsx`, `frontend/src/api/imports.ts` |

Warnings are ordered notable-first. `ScheduleImport.error_detail` only holds 1024
characters, so the entries worth acting on are written before the routine ones.

## Verifying

```bash
cd backend && pytest tests/services/test_excel_parser.py -v   # 30 tests
pytest                                                        # full suite
```

End-to-end: bring up `docker-compose`, create rooms `R1`–`R6` in the admin UI, then
upload `5-6-2026.xlsx`. Expect **21 cases** dated 2026-06-05 across R1–R4 and R6 (R5 is
empty), the first being R1 07:30 *Umbilical hernia* / د.رعد رحاب رعد at 90 minutes.
The preview should list the AM/PM resolutions, the skipped time-only row, and the
dropped co-surgeon on `د.بشناق +د.عزالدين`.
