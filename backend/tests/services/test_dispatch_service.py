from types import SimpleNamespace

from app.domain.enums import CasePhase, InputSource, TransitionOutcome
from app.services.dispatch_service import _sync_payload_to_case_state
from app.stt.pipeline_types import DispatchPayload


def _payload(from_phase: CasePhase, to_phase: CasePhase, outcome: TransitionOutcome, confidence: float = 1.0):
    return DispatchPayload(
        room_id="OR1",
        case_code="A3",
        from_phase=from_phase,
        to_phase=to_phase,
        outcome=outcome,
        source=InputSource.VOICE,
        raw_transcript="a three in",
        confidence=confidence,
    )


def test_dispatch_revalidates_explicit_voice_case_against_database_case_phase() -> None:
    payload = _payload(CasePhase.COMPLETE, CasePhase.IN, TransitionOutcome.REJECTED)
    case = SimpleNamespace(case_code="S20260601003", current_phase=CasePhase.IDLE)

    _sync_payload_to_case_state(payload, case)

    assert payload.from_phase == CasePhase.IDLE
    assert payload.outcome == TransitionOutcome.ACCEPTED


def test_dispatch_preserves_confidence_gate_when_correcting_stale_room_state() -> None:
    payload = _payload(CasePhase.COMPLETE, CasePhase.IN, TransitionOutcome.REJECTED, confidence=0.65)
    case = SimpleNamespace(case_code="S20260601003", current_phase=CasePhase.IDLE)

    _sync_payload_to_case_state(payload, case)

    assert payload.from_phase == CasePhase.IDLE
    assert payload.outcome == TransitionOutcome.REVIEW
