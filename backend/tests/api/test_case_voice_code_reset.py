from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api import cases as cases_api


@pytest.mark.asyncio
async def test_reset_endpoint_only_wires_dependencies_and_serializes_response(monkeypatch) -> None:
    db = AsyncMock()
    runtime = MagicMock()
    runtime.refresh_stt_grammar = AsyncMock()
    runtime.ws_manager.broadcast = AsyncMock()
    runtime.ws_manager.broadcast_to_all_rooms = AsyncMock()
    reset = AsyncMock(return_value=[])
    monkeypatch.setattr(cases_api, "reset_voice_case_codes", reset)

    response = await cases_api.reset_case_voice_codes(db=db, runtime=runtime, _={"type": "admin"})

    assert response == []
    reset.assert_awaited_once_with(
        db,
        refresh_stt_grammar=runtime.refresh_stt_grammar,
        broadcast_fn=runtime.ws_manager.broadcast,
        broadcast_rooms_fn=runtime.ws_manager.broadcast_to_all_rooms,
    )
    db.commit.assert_not_awaited()
    runtime.refresh_stt_grammar.assert_not_awaited()
    runtime.ws_manager.broadcast.assert_not_awaited()
    runtime.ws_manager.broadcast_to_all_rooms.assert_not_awaited()
