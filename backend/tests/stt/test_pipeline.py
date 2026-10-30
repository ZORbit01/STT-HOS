import asyncio
import struct
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.domain.enums import CasePhase, TransitionOutcome
from app.stt.engine import AudioPacket, TranscriptResult
from app.stt.pipeline import WAKE_GRAMMAR, STTPipeline
from app.stt.pipeline_types import DispatchPayload

ROOMS = ["OR1", "OR2"]
SILENCE = b"\x00" * 32000  # 1s silence as int16 bytes
WAKE_AUDIO = struct.pack("<" + "f" * 19200, *([0.02] * 19200))


def _packet(room_id: str, text: str = "", audio_bytes: bytes = SILENCE) -> AudioPacket:
    return AudioPacket(
        room_id=room_id,
        timestamp="2026-05-09T10:00:00Z",
        sample_rate=16000,
        channels=1,
        audio_bytes=audio_bytes,
    )


def _engine(text: str, confidence: float) -> MagicMock:
    engine = MagicMock()
    engine.transcribe = AsyncMock(return_value=TranscriptResult(text=text, confidence=confidence, language="en"))
    return engine


def _engine_sequence(*texts: str, confidence: float = 0.90) -> MagicMock:
    engine = MagicMock()
    engine.transcribe = AsyncMock(
        side_effect=[TranscriptResult(text=text, confidence=confidence, language="en") for text in texts]
    )
    return engine


async def _run(pipeline: STTPipeline, packet: AudioPacket) -> None:
    """Start pipeline, enqueue one packet, wait for it to be processed."""
    await pipeline.start()
    await pipeline.enqueue(packet)
    await asyncio.sleep(0.05)  # let the worker coroutine process it
    await pipeline.stop()


@pytest.mark.asyncio
async def test_accepted_full_command() -> None:
    """A1 in — valid full command, room IDLE → IN."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("A1 in", 0.90), dispatch, ROOMS)

    await _run(pipeline, _packet("OR1"))

    dispatch.assert_awaited_once()
    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.case_code == "A1"
    assert payload.from_phase == CasePhase.IDLE
    assert payload.to_phase == CasePhase.IN
    assert payload.outcome == TransitionOutcome.ACCEPTED
    assert payload.confidence == 0.90


@pytest.mark.asyncio
async def test_long_spoken_case_code_bypasses_hallucination_guard() -> None:
    """A121 as 'a one two one start' is 5 words but still a valid case command."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("a one two one start", 0.90), dispatch, ROOMS)

    await _run(pipeline, _packet("OR1"))

    dispatch.assert_awaited_once()
    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.case_code == "A121"
    assert payload.to_phase == CasePhase.IN
    assert payload.outcome == TransitionOutcome.ACCEPTED


@pytest.mark.asyncio
async def test_phase_only_with_active_case() -> None:
    """'induction' spoken when A1 is active in OR1 -> INDUCTION."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("induction", 0.88), dispatch, ROOMS)

    # Set OR1 to already have A1 active in IN phase
    pipeline.update_room_state("OR1", active_case_code="A1", current_phase=CasePhase.IN)

    await _run(pipeline, _packet("OR1"))

    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.case_code == "A1"
    assert payload.to_phase == CasePhase.INDUCTION
    assert payload.outcome == TransitionOutcome.ACCEPTED


@pytest.mark.asyncio
async def test_incision_after_induction() -> None:
    """'incision' spoken after induction -> INCISION."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("incision", 0.88), dispatch, ROOMS)
    pipeline.update_room_state("OR1", active_case_code="A1", current_phase=CasePhase.INDUCTION)

    await _run(pipeline, _packet("OR1"))

    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.case_code == "A1"
    assert payload.to_phase == CasePhase.INCISION
    assert payload.outcome == TransitionOutcome.ACCEPTED


@pytest.mark.asyncio
async def test_phase_only_without_active_case_discarded() -> None:
    """'incision' with no active case → discarded, dispatch never called."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("incision", 0.90), dispatch, ROOMS)
    # OR1 is IDLE, no active case

    await _run(pipeline, _packet("OR1"))

    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_low_confidence_rejected() -> None:
    """Valid command but confidence < 0.60 → REJECTED outcome dispatched."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("A1 in", 0.45), dispatch, ROOMS)

    await _run(pipeline, _packet("OR1"))

    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.outcome == TransitionOutcome.REJECTED


@pytest.mark.asyncio
async def test_review_confidence_dispatched() -> None:
    """Valid command with confidence 0.60–0.74 → REVIEW outcome dispatched."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("A1 in", 0.65), dispatch, ROOMS)

    await _run(pipeline, _packet("OR1"))

    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.outcome == TransitionOutcome.REVIEW


@pytest.mark.asyncio
async def test_ambient_speech_discarded() -> None:
    """Ambient speech that doesn't match grammar → dispatch never called."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("the patient is ready", 0.95), dispatch, ROOMS)

    await _run(pipeline, _packet("OR1"))

    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_invalid_transition_rejected() -> None:
    """Valid command but wrong phase order → REJECTED by state machine."""
    dispatch = AsyncMock()
    # Room is IN phase, nurse says "closure" (skipping INCISION)
    pipeline = STTPipeline(_engine("closure", 0.90), dispatch, ROOMS)
    pipeline.update_room_state("OR1", active_case_code="A1", current_phase=CasePhase.INDUCTION)

    await _run(pipeline, _packet("OR1"))

    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.outcome == TransitionOutcome.REJECTED


@pytest.mark.asyncio
async def test_unknown_room_discarded() -> None:
    """Audio from unregistered room → silently discarded."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("A1 in", 0.90), dispatch, ROOMS)
    unknown_packet = _packet("OR99")

    await pipeline.start()
    await pipeline.enqueue(unknown_packet)
    await asyncio.sleep(0.05)
    await pipeline.stop()

    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_wake_mode_uses_wake_only_grammar() -> None:
    dispatch = AsyncMock()
    notify = AsyncMock()
    engine = _engine("finish", 0.90)
    pipeline = STTPipeline(engine, dispatch, ROOMS, notify=notify)
    pipeline.update_room_state("OR1", active_case_code="A1", current_phase=CasePhase.OUT)
    pipeline.set_wake_mode("OR1", True)

    await _run(pipeline, _packet("OR1", audio_bytes=WAKE_AUDIO))

    engine.transcribe.assert_awaited_once()
    assert engine.transcribe.call_args.kwargs["focused_grammar"] == WAKE_GRAMMAR
    dispatch.assert_not_awaited()
    notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_period_forces_command_endpoint_and_is_stripped() -> None:
    dispatch = AsyncMock()
    notify = AsyncMock()
    engine = _engine_sequence("period", "incision period")
    pipeline = STTPipeline(engine, dispatch, ROOMS, notify=notify)
    pipeline.update_room_state("OR1", active_case_code="A1", current_phase=CasePhase.INDUCTION)
    state = pipeline._room_states["OR1"]
    pipeline._arm_command_capture(state, sample_rate=16000)

    await pipeline._process_command_capture(_packet("OR1", audio_bytes=WAKE_AUDIO), state)

    assert engine.transcribe.await_count == 2
    dispatch.assert_awaited_once()
    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.to_phase == CasePhase.INCISION
    assert payload.raw_transcript == "incision"


@pytest.mark.asyncio
async def test_period_alone_forces_command_endpoint_and_notifies_no_match() -> None:
    dispatch = AsyncMock()
    notify = AsyncMock()
    engine = _engine_sequence("period", "period")
    pipeline = STTPipeline(engine, dispatch, ROOMS, notify=notify)
    pipeline.update_room_state("OR1", active_case_code="A1", current_phase=CasePhase.IN)
    state = pipeline._room_states["OR1"]
    pipeline._arm_command_capture(state, sample_rate=16000)

    await pipeline._process_command_capture(_packet("OR1", audio_bytes=WAKE_AUDIO), state)

    assert engine.transcribe.await_count == 2
    dispatch.assert_not_awaited()
    notify.assert_awaited_once_with("OR1", "no_match", "")


@pytest.mark.asyncio
async def test_rooms_are_isolated() -> None:
    """OR1 and OR2 process independently — OR2 dispatch not affected by OR1 state."""
    dispatch = AsyncMock()
    pipeline = STTPipeline(_engine("incision", 0.90), dispatch, ROOMS)

    # Only OR1 has an active case; OR2 is IDLE.
    pipeline.update_room_state("OR1", active_case_code="A1", current_phase=CasePhase.INDUCTION)

    await pipeline.start()
    await pipeline.enqueue(_packet("OR1"))
    await pipeline.enqueue(_packet("OR2"))
    await asyncio.sleep(0.05)
    await pipeline.stop()

    # Only OR1 dispatch should have fired
    assert dispatch.await_count == 1
    payload: DispatchPayload = dispatch.call_args[0][0]
    assert payload.room_id == "OR1"
