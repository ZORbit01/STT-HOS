from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.enums import CasePhase
from app.models.orm import SurgicalCase, VoiceCodeCycle, VoiceCodeState
from app.ws.messages import WSMessage, schedule_changed_msg

VOICE_CODE_LOOKBACK_HOURS = 48


def normalize_voice_case_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


def iter_voice_case_codes() -> Iterator[str]:
    letters = [chr(code) for code in range(ord("A"), ord("Z") + 1)]
    one_letter_prefixes = letters
    two_letter_prefixes = [first + second for first in letters for second in letters]
    one_digit_numbers = [str(num) for num in range(1, 10)]
    two_digit_numbers = [str(num) for num in range(11, 100) if "0" not in str(num)]

    # Prefer the shortest, clearest daily voice aliases before expanding.
    for prefixes, numbers in (
        (one_letter_prefixes, one_digit_numbers),
        (one_letter_prefixes, two_digit_numbers),
        (two_letter_prefixes, one_digit_numbers),
        (two_letter_prefixes, two_digit_numbers),
    ):
        for prefix in prefixes:
            for number in numbers:
                yield f"{prefix}{number}"


def _recent_cutoff() -> datetime:
    return datetime.now(UTC) - timedelta(hours=VOICE_CODE_LOOKBACK_HOURS)


async def _lock_current_state(db: AsyncSession) -> VoiceCodeState:
    # This singleton row serializes allocation and reset transactions.
    result = await db.execute(select(VoiceCodeState).where(VoiceCodeState.id == 1).with_for_update())
    state = result.scalar_one_or_none()
    if state is None:
        cycle = VoiceCodeCycle(id=uuid4())
        state = VoiceCodeState(id=1, current_cycle_id=cycle.id)
        db.add_all([cycle, state])
        await db.flush()
    return state


async def _current_cycle_id(db: AsyncSession) -> UUID | None:
    result = await db.execute(select(VoiceCodeState.current_cycle_id).where(VoiceCodeState.id == 1))
    return result.scalar_one_or_none()


async def list_voice_code_eligible_cases(db: AsyncSession) -> list[SurgicalCase]:
    result = await db.execute(
        select(SurgicalCase)
        .options(
            selectinload(SurgicalCase.doctor),
            selectinload(SurgicalCase.patient),
            selectinload(SurgicalCase.companies),
            selectinload(SurgicalCase.scheduled_room),
            selectinload(SurgicalCase.induction_physician),
        )
        .where(
            SurgicalCase.scheduled_start >= _recent_cutoff(),
            SurgicalCase.current_phase.not_in((CasePhase.COMPLETE, CasePhase.CANCELLED)),
        )
        .order_by(SurgicalCase.scheduled_start, SurgicalCase.case_code, SurgicalCase.id)
    )
    return list(result.scalars().all())


async def reset_voice_case_codes(
    db: AsyncSession,
    *,
    voice_code_day: date | None = None,
    refresh_stt_grammar: Callable[[], Awaitable[None]] | None = None,
    broadcast_fn: Callable[[WSMessage], Awaitable[None]] | None = None,
    broadcast_rooms_fn: Callable[[WSMessage], Awaitable[None]] | None = None,
) -> list[SurgicalCase]:
    assigned_day = voice_code_day or datetime.now(UTC).date()
    state_result = await db.execute(select(VoiceCodeState).where(VoiceCodeState.id == 1).with_for_update())
    state = state_result.scalar_one_or_none()
    new_cycle = VoiceCodeCycle(id=uuid4())
    if state is None:
        state = VoiceCodeState(id=1, current_cycle_id=new_cycle.id)
        db.add_all([new_cycle, state])
    else:
        db.add(new_cycle)
    await db.flush()
    state.current_cycle_id = new_cycle.id

    cases = await list_voice_code_eligible_cases(db)
    _assign_codes(cases, cycle_id=new_cycle.id, assigned_day=assigned_day, used_codes=set())
    await db.commit()

    if refresh_stt_grammar is not None:
        await refresh_stt_grammar()

    message = schedule_changed_msg("voice_codes_reset")
    if broadcast_fn is not None:
        await broadcast_fn(message)
    if broadcast_rooms_fn is not None:
        await broadcast_rooms_fn(message)
    return cases


def _assign_codes(
    cases: list[SurgicalCase],
    *,
    cycle_id: UUID,
    assigned_day: date,
    used_codes: set[str],
) -> None:
    codes = (code for code in iter_voice_case_codes() if code not in used_codes)
    for case in cases:
        code = next(codes, None)
        if code is None:
            raise RuntimeError("No voice case codes available")
        case.voice_case_code = code
        case.voice_code_day = assigned_day
        case.voice_code_cycle_id = cycle_id
        used_codes.add(code)


async def assign_voice_case_codes(
    db: AsyncSession,
    cases: list[SurgicalCase],
    *,
    voice_code_day: date | None = None,
) -> None:
    if not cases:
        return
    assigned_day = voice_code_day or datetime.now(UTC).date()
    state = await _lock_current_state(db)
    cycle_id = state.current_cycle_id
    result = await db.execute(
        select(SurgicalCase.voice_case_code).where(
            SurgicalCase.voice_code_cycle_id == cycle_id,
            SurgicalCase.voice_case_code.is_not(None),
        )
    )
    used_codes = {normalize_voice_case_code(code) for code in result.scalars().all() if code}
    _assign_codes(cases, cycle_id=cycle_id, assigned_day=assigned_day, used_codes=used_codes)
    await db.flush()


async def assign_next_voice_case_code(
    db: AsyncSession,
    case: SurgicalCase,
    *,
    voice_code_day: date | None = None,
) -> None:
    await assign_voice_case_codes(db, [case], voice_code_day=voice_code_day)


async def fetch_stt_voice_case_codes(db: AsyncSession) -> list[str]:
    """
    Voice case codes eligible for the "start" grammar — only IDLE cases can be
    started, so cases already in progress (or complete) must not appear here,
    or Vosk would keep matching "<code> in" for a case that's already running.
    """
    cycle_id = await _current_cycle_id(db)
    if cycle_id is None:
        return []

    result = await db.execute(
        select(SurgicalCase.voice_case_code)
        .where(
            SurgicalCase.voice_code_cycle_id == cycle_id,
            SurgicalCase.scheduled_start >= _recent_cutoff(),
            SurgicalCase.current_phase == CasePhase.IDLE,
            SurgicalCase.voice_case_code.is_not(None),
        )
        .distinct()
        .order_by(SurgicalCase.voice_case_code)
    )
    return [code for code in result.scalars().all() if code]


async def resolve_voice_case_code(db: AsyncSession, spoken_code: str) -> SurgicalCase | None:
    code = normalize_voice_case_code(spoken_code)
    cycle_id = await _current_cycle_id(db)
    if cycle_id is None:
        return None

    result = await db.execute(
        select(SurgicalCase)
        .where(
            SurgicalCase.voice_code_cycle_id == cycle_id,
            SurgicalCase.voice_case_code == code,
            SurgicalCase.scheduled_start >= _recent_cutoff(),
            SurgicalCase.current_phase.not_in((CasePhase.COMPLETE, CasePhase.CANCELLED)),
        )
        .order_by(
            SurgicalCase.voice_code_day.desc().nullslast(),
            SurgicalCase.scheduled_start.desc(),
            SurgicalCase.case_code.desc(),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()
