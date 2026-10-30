from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.domain.enums import CasePhase, InputSource, TransitionOutcome
from app.stt.intent_parser import ParsedIntent

# ---------------------------------------------------------------------------
# Callback types
# ---------------------------------------------------------------------------

DispatchCallback = Callable[["DispatchPayload"], Awaitable[None]]
NotifyCallback = Callable[[str, str, str], Awaitable[None]]  # room_id, outcome, transcript


# ---------------------------------------------------------------------------
# Pipeline payload
# ---------------------------------------------------------------------------


@dataclass
class DispatchPayload:
    """Everything the downstream handler needs to write a PhaseEvent and broadcast."""

    room_id: str
    case_code: str
    from_phase: CasePhase
    to_phase: CasePhase
    outcome: TransitionOutcome
    source: InputSource
    raw_transcript: str
    confidence: float


# ---------------------------------------------------------------------------
# Per-room live state
# ---------------------------------------------------------------------------


@dataclass
class RoomState:
    """Tracks live state for one OR room inside the pipeline."""

    room_id: str
    active_case_code: str | None = None
    current_phase: CasePhase = CasePhase.IDLE
    wake_mode: bool = False
    wake_buffer: bytes = b""
    wake_buffer_sr: int = 16000
    command_armed: bool = False
    command_recording: bool = False
    command_started_at: float = 0.0
    command_armed_at: float = 0.0
    command_noise_floor: float = 0.0025
    command_voiced_ms: float = 0.0
    command_unvoiced_ms: float = 0.0
    command_prefix_frames: list[bytes] = field(default_factory=list)
    command_frames: list[bytes] = field(default_factory=list)
    command_sample_rate: int = 16000
    command_last_check_ms: float = 0.0
    command_endpoint_last_check_ms: float = 0.0
    cached_grammar: str | None = None
    cached_grammar_phase: CasePhase | None = None


# ---------------------------------------------------------------------------
# Wake detection constants
# ---------------------------------------------------------------------------

WAKE_WORDS = ["hey sina", "hey jarvis", "jarvis", "sina"]
WAKE_BUFFER_SECONDS = 1.2
WAKE_RMS_GATE = 0.008
WAKE_CONFIDENCE_MIN = 0.50

# ---------------------------------------------------------------------------
# VAD / command capture constants
# ---------------------------------------------------------------------------

VAD_FRAME_MS = 20
COMMAND_END_MARKERS = {"period"}

COMMAND_ENDPOINT_CHECK_MS = 220
COMMAND_ENDPOINT_MIN_MS = 220
COMMAND_PREFIX_MS = 320
COMMAND_WAIT_MAX_MS = 6000
COMMAND_MIN_MS = 650
COMMAND_END_SILENCE_MS = 520
COMMAND_MAX_MS = 6000
COMMAND_ABS_ON = 0.009
COMMAND_ABS_OFF = 0.004
COMMAND_ON_FACTOR = 3.5
COMMAND_OFF_FACTOR = 1.8
COMMAND_STREAM_CHECK_MS = 300


# ---------------------------------------------------------------------------
# Shared factory
# ---------------------------------------------------------------------------


def make_dispatch_payload(
    room_id: str,
    intent: ParsedIntent,
    room_state: RoomState,
    raw_transcript: str,
    confidence: float,
    outcome: TransitionOutcome,
) -> DispatchPayload:
    to_phase = CasePhase.CANCELLED if intent.phase == "CANCELLATION_REQUEST" else CasePhase(intent.phase)
    return DispatchPayload(
        room_id=room_id,
        case_code=intent.case_code,
        from_phase=room_state.current_phase,
        to_phase=to_phase,
        outcome=outcome,
        source=InputSource.VOICE,
        raw_transcript=raw_transcript,
        confidence=confidence,
    )
