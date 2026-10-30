import asyncio
import logging
import time

import numpy as np

from app.domain.enums import CasePhase, TransitionOutcome
from app.domain.state_machine import validate_transition
from app.stt.command_capture import (
    arm_command_state,
    build_command_packet,
    process_vad_frame,
    reset_command_state,
    strip_end_markers,
)
from app.stt.confidence_gate import ConfidenceDecision, evaluate_confidence
from app.stt.engine import AudioPacket, STTEngine
from app.stt.intent_parser import parse_intent
from app.stt.pipeline_types import (
    COMMAND_MIN_MS,
    COMMAND_WAIT_MAX_MS,
    VAD_FRAME_MS,
    DispatchCallback,
    NotifyCallback,
    RoomState,
    make_dispatch_payload,
)
from app.stt.vad import split_into_frames
from app.stt.vosk.grammar import build_focused_grammar, build_wake_grammar
from app.stt.wake_detector import (
    _compute_buffer_rms,
    _has_enough_audio,
    _matches_wake_word,
    _normalize_transcript,
    _passes_confidence_gate,
    _passes_rms_gate,
    build_wake_check_packet,
    extract_wake_intent,
)

logger = logging.getLogger(__name__)

_WAKE_GRAMMAR = build_wake_grammar()
WAKE_GRAMMAR = _WAKE_GRAMMAR


class STTPipeline:
    """
    Orchestrates the full STT pipeline for all OR rooms.

    Packet flow per room:
      1. Enqueue via WebSocket audio receiver
      2. Wake word detection (when wake_mode=True)
      3. Command capture with VAD (when command_armed=True)
      4. Transcription → intent parsing → state machine → dispatch
    """

    def __init__(
        self,
        stt_engine: STTEngine,
        dispatch: DispatchCallback,
        room_ids: list[str],
        notify: NotifyCallback | None = None,
    ) -> None:
        self._engine = stt_engine
        self._dispatch = dispatch
        self._notify = notify
        self._room_states: dict[str, RoomState] = {rid: RoomState(room_id=rid) for rid in room_ids}
        self._queues: dict[str, asyncio.Queue[AudioPacket]] = {rid: asyncio.Queue() for rid in room_ids}
        self._workers: list[asyncio.Task] = []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start one worker coroutine per room. Call once at app startup."""
        for room_id in self._room_states:
            task = asyncio.create_task(self._room_worker(room_id), name=f"stt-worker-{room_id}")
            self._workers.append(task)
        logger.info("STT pipeline started for rooms: %s", list(self._room_states.keys()))

    async def stop(self) -> None:
        """Cancel all room workers. Call on app shutdown."""
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        logger.info("STT pipeline stopped")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def enqueue(self, packet: AudioPacket) -> None:
        queue = self._queues.get(packet.room_id)
        if queue is None:
            logger.warning("Received audio for unknown room_id=%s — discarded", packet.room_id)
            return
        await queue.put(packet)

    def set_wake_mode(self, room_id: str, enabled: bool) -> None:
        """Enable or disable wake word scanning. Client calls this on toggle and after command_response."""
        state = self._room_states.get(room_id)
        if state:
            state.wake_mode = enabled
            state.wake_buffer = b""
            reset_command_state(state)
            logger.info("[STT] Wake mode %s for room=%s", "ON" if enabled else "OFF", room_id)

    def begin_command(self, room_id: str) -> None:
        """Exit wake mode immediately. Called when client sends command_start."""
        state = self._room_states.get(room_id)
        if state:
            state.wake_mode = False
            state.wake_buffer = b""
            reset_command_state(state)
            logger.info("[STT] command_start — wake mode off for room=%s", room_id)

    def update_room_state(self, room_id: str, active_case_code: str | None, current_phase: CasePhase) -> None:
        """Sync pipeline room state after a successful transition."""
        state = self._room_states.get(room_id)
        if state:
            state.active_case_code = active_case_code
            state.current_phase = current_phase

    # ------------------------------------------------------------------
    # Room worker
    # ------------------------------------------------------------------

    async def _room_worker(self, room_id: str) -> None:
        queue = self._queues[room_id]
        logger.info("[STT] Worker started for room=%s", room_id)
        while True:
            packet = await queue.get()
            try:
                await self._route_packet(packet)
            except Exception as exc:
                logger.exception("[STT] Unhandled error in room=%s: %s", room_id, exc)
            finally:
                queue.task_done()

    async def _route_packet(self, packet: AudioPacket) -> None:
        state = self._room_states[packet.room_id]
        logger.debug(
            "[STT] ── room=%s active_case=%s phase=%s bytes=%d wake=%s armed=%s",
            packet.room_id,
            state.active_case_code,
            state.current_phase,
            len(packet.audio_bytes),
            state.wake_mode,
            state.command_armed,
        )

        if state.command_armed:
            await self._run_command_capture(packet, state)
        elif state.wake_mode:
            await self._run_wake_detection(packet, state)
        else:
            await self._transcribe_and_dispatch(packet, state, rearm_wake_on_no_match=False)

    # ------------------------------------------------------------------
    # Wake detection
    # ------------------------------------------------------------------

    async def _run_wake_detection(self, packet: AudioPacket, state: RoomState) -> None:
        state.wake_buffer += packet.audio_bytes
        state.wake_buffer_sr = packet.sample_rate

        if not _has_enough_audio(state.wake_buffer, packet.sample_rate):
            logger.debug("[STT] Wake buffer accumulating room=%s", packet.room_id)
            return

        rms = _compute_buffer_rms(state.wake_buffer)
        logger.info("[STT] Wake buffer ready rms=%.4f room=%s", rms, packet.room_id)

        if not _passes_rms_gate(rms):
            logger.debug("[STT] Wake RMS too low (%.4f) — discarded room=%s", rms, packet.room_id)
            state.wake_buffer = b""
            return

        check_packet = build_wake_check_packet(packet, state)
        state.wake_buffer = b""
        result = await self._engine.transcribe(check_packet, focused_grammar=_WAKE_GRAMMAR)
        logger.info("[STT] Wake check: text=%r confidence=%.3f rms=%.4f", result.text, result.confidence, rms)

        if not _passes_confidence_gate(result.confidence):
            logger.info("[STT] Wake confidence too low (%.3f) room=%s", result.confidence, packet.room_id)
            return

        if not _matches_wake_word(result.text):
            return

        await self._handle_wake_match(packet, state, result.text, result.confidence)

    async def _handle_wake_match(
        self,
        packet: AudioPacket,
        state: RoomState,
        transcript: str,
        confidence: float,
    ) -> None:
        text_lower = _normalize_transcript(transcript)
        intent = extract_wake_intent(text_lower, state.active_case_code)

        if intent is not None:
            outcome = self._apply_confidence_gate(
                validate_transition(state.current_phase, CasePhase(intent.phase)),
                confidence,
            )
            logger.info(
                "[STT] WAKE+COMMAND room=%s text=%r case=%s phase=%s outcome=%s",
                packet.room_id,
                text_lower,
                intent.case_code,
                intent.phase,
                outcome,
            )
            state.wake_mode = False
            state.wake_buffer = b""
            self._flush_queue(packet.room_id)
            await self._dispatch(make_dispatch_payload(packet.room_id, intent, state, transcript, confidence, outcome))
            return

        logger.info("[STT] WAKE WORD detected room=%s — switching to command mode", packet.room_id)
        arm_command_state(state, packet.sample_rate)
        flushed = self._flush_queue(packet.room_id)
        if flushed:
            logger.info("[STT] Flushed %d stale packets after wake room=%s", flushed, packet.room_id)
        if self._notify:
            await self._notify(packet.room_id, "wake_activated", "")

    # ------------------------------------------------------------------
    # Command capture
    # ------------------------------------------------------------------

    async def _run_command_capture(self, packet: AudioPacket, state: RoomState) -> None:
        audio = np.frombuffer(packet.audio_bytes, dtype=np.float32)
        if audio.size == 0:
            return

        now = time.monotonic()
        if not state.command_recording and (now - state.command_armed_at) * 1000 > COMMAND_WAIT_MAX_MS:
            logger.info("[STT] Command wait expired room=%s — rearming wake", packet.room_id)
            await self._rearm_wake(state, "no_match", "")
            return

        for frame in split_into_frames(audio, packet.sample_rate):
            result = await process_vad_frame(frame, packet, state, self._engine)
            if result in ("endpoint", "forced_endpoint"):
                await self._finalize_command(packet, state, force=result == "forced_endpoint")
                return

    def _arm_command_capture(self, state: RoomState, sample_rate: int) -> None:
        arm_command_state(state, sample_rate)

    async def _process_command_capture(self, packet: AudioPacket, state: RoomState) -> None:
        await self._run_command_capture(packet, state)

    async def _finalize_command(self, packet: AudioPacket, state: RoomState, *, force: bool = False) -> None:
        frames = list(state.command_frames)
        command_ms = len(frames) * VAD_FRAME_MS
        self._flush_queue(packet.room_id)
        reset_command_state(state)
        state.wake_mode = False

        if command_ms < COMMAND_MIN_MS and not force:
            logger.info("[STT] Command too short room=%s duration=%dms", packet.room_id, command_ms)
            await self._rearm_wake(state, "no_match", "")
            return

        command_packet = build_command_packet(packet, frames)
        logger.info(
            "[STT] Command finalized room=%s duration=%dms bytes=%d",
            packet.room_id,
            command_ms,
            len(command_packet.audio_bytes),
        )
        await self._transcribe_and_dispatch(command_packet, state, rearm_wake_on_no_match=True)
        self._flush_queue(packet.room_id)

    # ------------------------------------------------------------------
    # Transcription → intent → dispatch
    # ------------------------------------------------------------------

    async def _transcribe_and_dispatch(
        self,
        packet: AudioPacket,
        room_state: RoomState,
        rearm_wake_on_no_match: bool,
    ) -> None:
        if room_state.cached_grammar_phase != room_state.current_phase:
            room_state.cached_grammar = build_focused_grammar(room_state.current_phase.value)
            room_state.cached_grammar_phase = room_state.current_phase
        result = await self._engine.transcribe(packet, focused_grammar=room_state.cached_grammar)
        logger.info("[STT] TRANSCRIPT room=%s text=%r confidence=%.3f", packet.room_id, result.text, result.confidence)

        if not result.text.strip():
            logger.info("[STT] Empty transcript — discarded room=%s", packet.room_id)
            await self._send_no_match(room_state, rearm_wake_on_no_match, "no_match", "")
            return

        command_text = strip_end_markers(result.text)
        intent = parse_intent(command_text, room_state.active_case_code)

        if intent is None and len(command_text.strip().split()) > 4:
            logger.warning("[STT] HALLUCINATION_GUARD room=%s text=%r — discarded", packet.room_id, command_text)
            await self._send_no_match(room_state, rearm_wake_on_no_match, "rejected", command_text)
            return

        if intent is None:
            logger.info("[STT] NO_INTENT room=%s text=%r", packet.room_id, command_text)
            await self._send_no_match(room_state, rearm_wake_on_no_match, "no_match", command_text)
            return

        logger.info("[STT] INTENT room=%s case=%s phase=%s", packet.room_id, intent.case_code, intent.phase)

        if intent.phase == "CANCELLATION_REQUEST":
            outcome = self._apply_confidence_gate(TransitionOutcome.ACCEPTED, result.confidence)
            logger.info("[STT] CANCELLATION_REQUEST room=%s outcome=%s", packet.room_id, outcome)
            await self._dispatch(
                make_dispatch_payload(packet.room_id, intent, room_state, command_text, result.confidence, outcome)
            )
            return

        to_phase = CasePhase(intent.phase)
        outcome = self._apply_confidence_gate(
            validate_transition(room_state.current_phase, to_phase),
            result.confidence,
        )
        logger.info("[STT] STATE_MACHINE from=%s to=%s outcome=%s", room_state.current_phase, to_phase, outcome)

        await self._dispatch(
            make_dispatch_payload(packet.room_id, intent, room_state, command_text, result.confidence, outcome)
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _apply_confidence_gate(self, outcome: TransitionOutcome, confidence: float) -> TransitionOutcome:
        if outcome != TransitionOutcome.ACCEPTED:
            return outcome
        decision = evaluate_confidence(confidence)
        if decision == ConfidenceDecision.ACCEPT:
            return outcome
        if decision == ConfidenceDecision.REVIEW:
            return TransitionOutcome.REVIEW
        return TransitionOutcome.REJECTED

    async def _rearm_wake(self, state: RoomState, outcome: str, transcript: str) -> None:
        reset_command_state(state)
        state.wake_mode = True
        state.wake_buffer = b""
        if self._notify:
            await self._notify(state.room_id, outcome, transcript)

    async def _send_no_match(
        self,
        state: RoomState,
        rearm_wake: bool,
        outcome: str,
        transcript: str,
    ) -> None:
        if rearm_wake:
            await self._rearm_wake(state, outcome, transcript)
        elif self._notify:
            await self._notify(state.room_id, outcome, transcript)

    def _flush_queue(self, room_id: str) -> int:
        queue = self._queues.get(room_id)
        if queue is None:
            return 0
        flushed = 0
        while not queue.empty():
            try:
                queue.get_nowait()
                queue.task_done()
                flushed += 1
            except Exception:
                break
        return flushed
