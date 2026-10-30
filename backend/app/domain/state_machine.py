from app.domain.enums import CasePhase, TransitionOutcome

VALID_TRANSITIONS: dict[CasePhase, list[CasePhase]] = {
    CasePhase.IDLE: [CasePhase.IN, CasePhase.CANCELLED],
    CasePhase.IN: [CasePhase.INDUCTION, CasePhase.CANCELLED],
    CasePhase.INDUCTION: [CasePhase.INCISION, CasePhase.CANCELLED],
    CasePhase.INCISION: [CasePhase.CLOSURE, CasePhase.CANCELLED],
    CasePhase.CLOSURE: [CasePhase.OUT, CasePhase.CANCELLED],
    CasePhase.OUT: [CasePhase.CLEANING, CasePhase.CANCELLED],
    CasePhase.CLEANING: [CasePhase.COMPLETE, CasePhase.CANCELLED],
    CasePhase.COMPLETE: [],
    CasePhase.CANCELLED: [],
}


def validate_transition(
    current: CasePhase,
    requested: CasePhase,
) -> TransitionOutcome:
    if requested == current:
        return TransitionOutcome.DUPLICATE
    if requested in VALID_TRANSITIONS.get(current, []):
        return TransitionOutcome.ACCEPTED
    return TransitionOutcome.REJECTED
