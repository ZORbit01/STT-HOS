from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api import cases as cases_api
from app.main import create_app


def test_admin_case_history_route_is_registered() -> None:
    paths = {route.path for route in create_app().routes}

    assert "/api/v1/cases/admin" in paths


@pytest.mark.asyncio
async def test_admin_case_history_returns_every_loaded_case(monkeypatch) -> None:
    db = AsyncMock()
    cases = [MagicMock(), MagicMock()]
    outputs = [MagicMock(), MagicMock()]
    load_cases = AsyncMock(return_value=cases)
    case_out = MagicMock(side_effect=outputs)
    monkeypatch.setattr(cases_api, "list_all_cases", load_cases)
    monkeypatch.setattr(cases_api, "_case_out", case_out)

    result = await cases_api.list_admin_cases(db=db, _={"type": "admin"})

    assert result == outputs
    load_cases.assert_awaited_once_with(db)
    assert case_out.call_count == 2
