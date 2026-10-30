from datetime import date
from itertools import islice
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.domain.enums import CasePhase
from app.models.orm import SurgicalCase, VoiceCodeState
from app.services.voice_case_code_service import (
    _assign_codes,
    assign_voice_case_codes,
    fetch_stt_voice_case_codes,
    iter_voice_case_codes,
    list_voice_code_eligible_cases,
    reset_voice_case_codes,
    resolve_voice_case_code,
)
from app.ws.messages import schedule_changed_msg


def test_voice_case_codes_prefer_short_aliases_first() -> None:
    codes = list(islice(iter_voice_case_codes(), 236))

    assert codes[:10] == ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "B1"]
    assert codes[233] == "Z9"
    assert codes[234] == "A11"
    assert codes[235] == "A12"


def test_two_letter_codes_are_reserved_until_shorter_codes_are_exhausted() -> None:
    codes = list(islice(iter_voice_case_codes(), 234 + 26 * 81 + 2))

    assert codes[-2:] == ["AA1", "AA2"]


def _result(*, scalar=None, scalars=None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    result.scalars.return_value.all.return_value = scalars or []
    return result


def test_assign_codes_skips_every_code_reserved_in_the_cycle() -> None:
    cycle_id = uuid4()
    case = SurgicalCase()

    _assign_codes([case], cycle_id=cycle_id, assigned_day=date(2026, 6, 29), used_codes={"A1"})

    assert case.voice_case_code == "A2"
    assert case.voice_code_cycle_id == cycle_id


@pytest.mark.asyncio
async def test_completed_case_code_remains_reserved_for_new_assignments() -> None:
    cycle_id = uuid4()
    state = VoiceCodeState(id=1, current_cycle_id=cycle_id)
    db = AsyncMock()
    db.execute.side_effect = [_result(scalar=state), _result(scalars=["A1"])]
    new_case = SurgicalCase()

    await assign_voice_case_codes(db, [new_case], voice_code_day=date(2026, 6, 29))

    assert new_case.voice_case_code == "A2"
    assert new_case.voice_code_cycle_id == cycle_id
    used_codes_query = db.execute.await_args_list[1].args[0]
    assert "voice_code_cycle_id" in str(used_codes_query)
    assert "current_phase" not in str(used_codes_query)


@pytest.mark.asyncio
async def test_two_same_day_resets_create_distinct_cycles_that_restart_at_a1() -> None:
    state = VoiceCodeState(id=1, current_cycle_id=uuid4())
    first_case = SurgicalCase(current_phase=CasePhase.IDLE)
    second_case = SurgicalCase(current_phase=CasePhase.IDLE)
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.side_effect = [
        _result(scalar=state),
        _result(scalars=[first_case]),
        _result(scalar=state),
        _result(scalars=[second_case]),
    ]

    await reset_voice_case_codes(db, voice_code_day=date(2026, 6, 29))
    first_cycle_id = first_case.voice_code_cycle_id
    await reset_voice_case_codes(db, voice_code_day=date(2026, 6, 29))

    assert first_case.voice_case_code == "A1"
    assert second_case.voice_case_code == "A1"
    assert first_cycle_id is not None
    assert second_case.voice_code_cycle_id != first_cycle_id


@pytest.mark.asyncio
async def test_reset_service_owns_commit_grammar_refresh_and_broadcasts() -> None:
    state = VoiceCodeState(id=1, current_cycle_id=uuid4())
    case = SurgicalCase(current_phase=CasePhase.IDLE)
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.side_effect = [_result(scalar=state), _result(scalars=[case])]
    refresh_stt_grammar = AsyncMock()
    broadcast = AsyncMock()
    broadcast_rooms = AsyncMock()

    await reset_voice_case_codes(
        db,
        voice_code_day=date(2026, 6, 29),
        refresh_stt_grammar=refresh_stt_grammar,
        broadcast_fn=broadcast,
        broadcast_rooms_fn=broadcast_rooms,
    )

    db.commit.assert_awaited_once()
    refresh_stt_grammar.assert_awaited_once()
    expected = schedule_changed_msg("voice_codes_reset").to_dict()
    assert broadcast.await_args.args[0].to_dict() == expected
    assert broadcast_rooms.await_args.args[0].to_dict() == expected


@pytest.mark.asyncio
async def test_reset_eligibility_excludes_completed_and_cancelled_cases() -> None:
    db = AsyncMock()
    db.execute.return_value = _result(scalars=[])

    await list_voice_code_eligible_cases(db)

    query = db.execute.await_args.args[0]
    terminal_phases = query.compile().params["current_phase_1"]
    assert terminal_phases == [CasePhase.COMPLETE, CasePhase.CANCELLED]


@pytest.mark.asyncio
async def test_stt_codes_are_read_from_the_current_cycle_only() -> None:
    cycle_id = uuid4()
    db = AsyncMock()
    db.execute.side_effect = [_result(scalar=cycle_id), _result(scalars=["A1", "A2"])]

    codes = await fetch_stt_voice_case_codes(db)

    assert codes == ["A1", "A2"]
    grammar_query = db.execute.await_args_list[1].args[0]
    assert grammar_query.compile().params["voice_code_cycle_id_1"] == cycle_id


@pytest.mark.asyncio
async def test_voice_code_resolution_is_scoped_to_the_current_cycle() -> None:
    cycle_id = uuid4()
    active_case = SurgicalCase(voice_case_code="A1", current_phase=CasePhase.IDLE)
    db = AsyncMock()
    db.execute.side_effect = [_result(scalar=cycle_id), _result(scalar=active_case)]

    resolved = await resolve_voice_case_code(db, "a 1")

    assert resolved is active_case
    resolve_query = db.execute.await_args_list[1].args[0]
    assert resolve_query.compile().params["voice_code_cycle_id_1"] == cycle_id
