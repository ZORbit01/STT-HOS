import logging
import time

import numpy as np

from app.stt.engine import AudioPacket, STTEngine
from app.stt.intent_parser import parse_intent
from app.stt.pipeline_types import (
    COMMAND_END_MARKERS,
    COMMAND_END_SILENCE_MS,
    COMMAND_ENDPOINT_CHECK_MS,
    COMMAND_ENDPOINT_MIN_MS,
    COMMAND_MAX_MS,
    COMMAND_MIN_MS,
    COMMAND_ON_FACTOR,
    COMMAND_PREFIX_MS,
    COMMAND_STREAM_CHECK_MS,
    VAD_FRAME_MS,
    RoomState,
)
from app.stt.vad import compute_rms, is_voiced, update_noise_floor
from app.stt.vosk.grammar import build_command_endpoint_grammar, build_focused_grammar

logger = logging.getLogger(__name__)

_ENDPOINT_GRAMMAR = build_command_endpoint_grammar()

_PREFIX_FRAME_LIMIT = max(1, int(COMMAND_PREFIX_MS / VAD_FRAME_MS))


# ---------------------------------------------------------------------------
# State mutation helpers
# ---------------------------------------------------------------------------


def reset_command_state(state: RoomState) -> None:
    state.command_armed = False
    state.command_recording = False
    state.command_started_at = 0.0
    state.command_armed_at = 0.0
    state.command_noise_floor = 0.0025
    state.command_voiced_ms = 0.0
    state.command_unvoiced_ms = 0.0
    state.command_prefix_frames = []
    state.command_frames = []
    state.command_sample_rate = 16000
    state.command_last_check_ms = 0.0
    state.command_endpoint_last_check_ms = 0.0


def arm_command_state(state: RoomState, sample_rate: int) -> None:
    state.wake_mode = False
    state.wake_buffer = b""
    state.command_armed = True
    state.command_recording = False
    state.command_started_at = 0.0
    state.command_armed_at = time.monotonic()
    state.command_noise_floor = 0.0025
    state.command_voiced_ms = 0.0
    state.command_unvoiced_ms = 0.0
    state.command_prefix_frames = []
    state.command_frames = []
    state.command_sample_rate = sample_rate
    state.command_last_check_ms = 0.0
    state.command_endpoint_last_check_ms = 0.0


# ---------------------------------------------------------------------------
# Transcript utilities
# ---------------------------------------------------------------------------


def contains_end_marker(text: str) -> bool:
    words = text.lower().strip().rstrip(".,!?").split()
    return any(word in COMMAND_END_MARKERS for word in words)


def strip_end_markers(text: str) -> str:
    words = text.strip().split()
    return " ".join(w for w in words if w.lower().strip(".,!?") not in COMMAND_END_MARKERS)


def build_command_packet(packet: AudioPacket, frames: list[bytes]) -> AudioPacket:
    return AudioPacket(
        room_id=packet.room_id,
        timestamp=packet.timestamp,
        sample_rate=packet.sample_rate,
        channels=1,
        audio_bytes=b"".join(frames),
    )


# ---------------------------------------------------------------------------
# Pre-speech prefix buffer
# ---------------------------------------------------------------------------


def _update_prefix_buffer(state: RoomState, frame_bytes: bytes) -> None:
    state.command_prefix_frames.append(frame_bytes)
    if len(state.command_prefix_frames) > _PREFIX_FRAME_LIMIT:
        state.command_prefix_frames = state.command_prefix_frames[-_PREFIX_FRAME_LIMIT:]


# ---------------------------------------------------------------------------
# Speech onset
# ---------------------------------------------------------------------------


def _handle_speech_onset(state: RoomState, frame_bytes: bytes, rms: float, speech_on: float) -> None:
    state.command_recording = True
    state.command_started_at = time.monotonic()
    state.command_voiced_ms = VAD_FRAME_MS
    state.command_unvoiced_ms = 0.0
    state.command_frames = list(state.command_prefix_frames)
    state.command_frames.append(frame_bytes)
    logger.info(
        "[STT] Command speech start room=%s rms=%.4f noise=%.4f on=%.4f",
        state.room_id,
        rms,
        state.command_noise_floor,
        speech_on,
    )


# ---------------------------------------------------------------------------
# Endpoint checks
# ---------------------------------------------------------------------------


async def _check_endpoint_marker(
    packet: AudioPacket,
    state: RoomState,
    engine: STTEngine,
) -> bool:
    """Transcribe current frames with endpoint grammar; return True if end marker detected."""
    frames_since_check = state.command_voiced_ms - state.command_endpoint_last_check_ms
    if frames_since_check < COMMAND_ENDPOINT_CHECK_MS:
        return False
    if state.command_voiced_ms < COMMAND_ENDPOINT_MIN_MS:
        return False

    state.command_endpoint_last_check_ms = state.command_voiced_ms
    marker_packet = build_command_packet(packet, state.command_frames)
    result = await engine.transcribe(marker_packet, focused_grammar=_ENDPOINT_GRAMMAR)
    logger.info(
        "[STT] Endpoint marker check room=%s voiced=%.0fms text=%r",
        packet.room_id,
        state.command_voiced_ms,
        result.text,
    )
    return contains_end_marker(result.text)


async def _check_streaming_match(
    packet: AudioPacket,
    state: RoomState,
    engine: STTEngine,
) -> bool:
    """Transcribe current frames with phase grammar; return True if early exit warranted."""
    frames_since_check = state.command_voiced_ms - state.command_last_check_ms
    if frames_since_check < COMMAND_STREAM_CHECK_MS:
        return False
    if state.command_voiced_ms < COMMAND_MIN_MS:
        return False

    state.command_last_check_ms = state.command_voiced_ms
    interim_packet = build_command_packet(packet, state.command_frames)
    focused = build_focused_grammar(state.current_phase.value)
    result = await engine.transcribe(interim_packet, focused_grammar=focused)
    logger.info(
        "[STT] Interim check room=%s voiced=%.0fms phase=%s text=%r",
        packet.room_id,
        state.command_voiced_ms,
        state.current_phase.value,
        result.text,
    )

    if not result.text.strip():
        return False

    force_endpoint = contains_end_marker(result.text)
    command_text = strip_end_markers(result.text)
    intent = parse_intent(command_text, state.active_case_code)

    if intent is not None or force_endpoint:
        logger.info(
            "[STT] Streaming endpoint room=%s text=%r marker=%s intent=%s",
            packet.room_id,
            result.text,
            force_endpoint,
            intent is not None,
        )
        return True

    return False


def _has_reached_silence_endpoint(state: RoomState, elapsed_ms: float) -> bool:
    return elapsed_ms >= COMMAND_MAX_MS or (
        elapsed_ms >= COMMAND_MIN_MS and state.command_unvoiced_ms >= COMMAND_END_SILENCE_MS
    )


# ---------------------------------------------------------------------------
# VAD frame processor
# ---------------------------------------------------------------------------


async def process_vad_frame(
    frame: np.ndarray,
    packet: AudioPacket,
    state: RoomState,
    engine: STTEngine,
) -> str:
    """
    Process one VAD frame against the current command state.

    Returns:
        "endpoint" — caller should finalize and transcribe the command
        "forced_endpoint" — endpoint marker was heard; finalize even if short
        "continue" — keep accumulating
    """
    frame_bytes = frame.astype(np.float32, copy=False).tobytes()
    rms = compute_rms(frame)
    speech_on = max(0.009, state.command_noise_floor * COMMAND_ON_FACTOR)
    voiced = is_voiced(rms, state.command_noise_floor, state.command_recording)

    if not state.command_recording:
        state.command_noise_floor = update_noise_floor(state.command_noise_floor, rms)
        _update_prefix_buffer(state, frame_bytes)
        if voiced:
            _handle_speech_onset(state, frame_bytes, rms, speech_on)
        return "continue"

    state.command_frames.append(frame_bytes)
    elapsed_ms = (time.monotonic() - state.command_started_at) * 1000

    if voiced:
        state.command_voiced_ms += VAD_FRAME_MS
        state.command_unvoiced_ms = 0.0
    elif elapsed_ms >= COMMAND_MIN_MS:
        state.command_unvoiced_ms += VAD_FRAME_MS

    if await _check_endpoint_marker(packet, state, engine):
        logger.info("[STT] Command endpoint marker room=%s text=<period>", packet.room_id)
        return "forced_endpoint"

    if await _check_streaming_match(packet, state, engine):
        return "endpoint"

    if _has_reached_silence_endpoint(state, elapsed_ms):
        return "endpoint"

    return "continue"
