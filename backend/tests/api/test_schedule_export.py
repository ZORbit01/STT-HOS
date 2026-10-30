from datetime import date
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from app.api import exports as exports_api
from app.main import create_app


@pytest.mark.asyncio
async def test_export_endpoint_returns_named_excel_attachment(monkeypatch) -> None:
    db = AsyncMock()
    rooms = [MagicMock()]
    cases = [MagicMock()]
    load_schedule = AsyncMock(return_value=(rooms, cases))
    build_workbook = MagicMock(return_value=b"xlsx-data")
    monkeypatch.setattr(exports_api, "load_daily_schedule", load_schedule)
    monkeypatch.setattr(exports_api, "build_schedule_workbook", build_workbook)
    schedule_date = date(2026, 6, 5)

    response = await exports_api.export_daily_schedule(
        schedule_date=schedule_date,
        db=db,
        _={"type": "admin"},
    )

    assert response.media_type == exports_api.EXCEL_MEDIA_TYPE
    assert response.headers["content-disposition"] == 'attachment; filename="OR-Schedule-2026-06-05.xlsx"'
    load_schedule.assert_awaited_once_with(db, schedule_date)
    build_workbook.assert_called_once_with(schedule_date, rooms, cases)


def test_export_and_import_routes_coexist() -> None:
    # Export was added when import was removed; import has since been reinstated for
    # the hand-maintained OR schedules, so both are expected to be registered.
    paths = {route.path for route in create_app().routes}

    assert "/api/v1/exports/schedule.xlsx" in paths
    assert "/api/v1/exports/cases.xlsx" in paths
    assert "/api/v1/import/excel" in paths
    assert "/api/v1/import/excel/preview" in paths


@pytest.mark.asyncio
async def test_filtered_export_uses_exact_ordered_admin_selection(monkeypatch) -> None:
    db = AsyncMock()
    rooms = [MagicMock()]
    cases = [MagicMock(), MagicMock()]
    case_ids = [
        UUID("11111111-1111-1111-1111-111111111111"),
        UUID("22222222-2222-2222-2222-222222222222"),
    ]
    load_schedule = AsyncMock(return_value=(rooms, cases))
    build_workbook = MagicMock(return_value=b"filtered-xlsx-data")
    monkeypatch.setattr(exports_api, "load_filtered_schedule", load_schedule)
    monkeypatch.setattr(exports_api, "build_schedule_workbook", build_workbook)

    response = await exports_api.export_filtered_cases(
        body=exports_api.FilteredCaseExportRequest(case_ids=case_ids),
        db=db,
        _={"type": "admin"},
    )

    assert response.media_type == exports_api.EXCEL_MEDIA_TYPE
    assert response.headers["content-disposition"] == 'attachment; filename="OR-Cases-filtered.xlsx"'
    load_schedule.assert_awaited_once_with(db, case_ids)
    build_workbook.assert_called_once_with(
        None,
        rooms,
        cases,
        report_label="Filtered admin view",
        preserve_order=True,
    )
