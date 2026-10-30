from dataclasses import dataclass
from typing import Protocol


@dataclass
class AudioPacket:
    room_id: str
    timestamp: str  # ISO 8601 UTC
    sample_rate: int  # always 16000
    channels: int  # always 1
    audio_bytes: bytes  # raw PCM int16


@dataclass
class TranscriptResult:
    text: str
    confidence: float  # 0.0–1.0 converted from avg_logprob
    language: str  # always "en"


class STTEngine(Protocol):
    async def transcribe(self, packet: AudioPacket) -> TranscriptResult: ...
