import pytest

from app.domain.enums import CasePhase, TransitionOutcome
from app.domain.state_machine import validate_transition


@pytest.mark.parametrize(
    "current,requested,expected",
    [
        # Valid forward transitions
        (CasePhase.IDLE, CasePhase.IN, TransitionOutcome.ACCEPTED),
        (CasePhase.IN, CasePhase.INDUCTION, TransitionOutcome.ACCEPTED),
        (CasePhase.INDUCTION, CasePhase.INCISION, TransitionOutcome.ACCEPTED),
        (CasePhase.INCISION, CasePhase.CLOSURE, TransitionOutcome.ACCEPTED),
        (CasePhase.CLOSURE, CasePhase.OUT, TransitionOutcome.ACCEPTED),
        (CasePhase.OUT, CasePhase.CLEANING, TransitionOutcome.ACCEPTED),
        (CasePhase.CLEANING, CasePhase.COMPLETE, TransitionOutcome.ACCEPTED),
        # Duplicates — already in that phase
        (CasePhase.IDLE, CasePhase.IDLE, TransitionOutcome.DUPLICATE),
        (CasePhase.IN, CasePhase.IN, TransitionOutcome.DUPLICATE),
        (CasePhase.INDUCTION, CasePhase.INDUCTION, TransitionOutcome.DUPLICATE),
        (CasePhase.INCISION, CasePhase.INCISION, TransitionOutcome.DUPLICATE),
        (CasePhase.CLEANING, CasePhase.CLEANING, TransitionOutcome.DUPLICATE),
        # Skipping phases
        (CasePhase.IDLE, CasePhase.INDUCTION, TransitionOutcome.REJECTED),
        (CasePhase.IDLE, CasePhase.INCISION, TransitionOutcome.REJECTED),
        (CasePhase.IDLE, CasePhase.CLEANING, TransitionOutcome.REJECTED),
        (CasePhase.IN, CasePhase.INCISION, TransitionOutcome.REJECTED),
        (CasePhase.IN, CasePhase.CLOSURE, TransitionOutcome.REJECTED),
        (CasePhase.IN, CasePhase.OUT, TransitionOutcome.REJECTED),
        # Going backward
        (CasePhase.INDUCTION, CasePhase.IN, TransitionOutcome.REJECTED),
        (CasePhase.INCISION, CasePhase.IN, TransitionOutcome.REJECTED),
        (CasePhase.CLOSURE, CasePhase.INCISION, TransitionOutcome.REJECTED),
        (CasePhase.OUT, CasePhase.IN, TransitionOutcome.REJECTED),
        (CasePhase.CLEANING, CasePhase.OUT, TransitionOutcome.REJECTED),
        (CasePhase.COMPLETE, CasePhase.IDLE, TransitionOutcome.REJECTED),
    ],
)
def test_validate_transition(
    current: CasePhase,
    requested: CasePhase,
    expected: TransitionOutcome,
) -> None:
    assert validate_transition(current, requested) == expected
