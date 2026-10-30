import logging

import numpy as np

from app.stt.engine import AudioPacket
from app.stt.intent_parser import ParsedIntent, parse_intent
from app.stt.pipeline_types import (
    WAKE_BUFFER_SECONDS,
    WAKE_CONFIDENCE_MIN,
    WAKE_RMS_GATE,
    WAKE_WORDS,
    RoomState,
)

logger = logging.getLogger(__name__)


def _compute_buffer_rms(wake_buffer: bytes) -> float:
    audio = np.frombuffer(wake_buffer, dtype=np.float32)
    return float(np.sqrt(np.mean(audio**2))) if len(audio) > 0 else 0.0


def _has_enough_audio(wake_buffer: bytes, sample_rate: int) -> bool:
    samples = len(wake_buffer) // 4  # float32 = 4 bytes per sample
    duration = samples / max(sample_rate, 1)
    return duration >= WAKE_BUFFER_SECONDS


def _passes_rms_gate(rms: float) -> bool:
    return rms >= WAKE_RMS_GATE


def _passes_confidence_gate(confidence: float) -> bool:
    return confidence >= WAKE_CONFIDENCE_MIN


def _matches_wake_word(text: str) -> bool:
    normalized = text.lower().strip().rstrip(".,!?")
    return any(ww in normalized for ww in WAKE_WORDS)


def _normalize_transcript(text: str) -> str:
    return text.lower().strip().rstrip(".,!?")


def build_wake_check_packet(packet: AudioPacket, state: RoomState) -> AudioPacket:
    return AudioPacket(
        room_id=packet.room_id,
        timestamp=packet.timestamp,
        sample_rate=state.wake_buffer_sr,
        channels=1,
        audio_bytes=state.wake_buffer,
    )


def extract_wake_intent(text: str, active_case_code: str | None) -> ParsedIntent | None:
    return parse_intent(_normalize_transcript(text), active_case_code)
