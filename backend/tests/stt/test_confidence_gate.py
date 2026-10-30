import pytest

from app.stt.confidence_gate import ConfidenceDecision, evaluate_confidence, logprob_to_confidence


@pytest.mark.parametrize(
    "avg_logprob,expected_min,expected_max",
    [
        (-0.05, 0.90, 1.00),  # very confident
        (-0.30, 0.70, 0.75),  # moderate
        (-0.51, 0.59, 0.61),  # just below review threshold
        (-1.00, 0.35, 0.38),  # low confidence
        (-5.00, 0.00, 0.01),  # near zero
    ],
)
def test_logprob_to_confidence(avg_logprob: float, expected_min: float, expected_max: float) -> None:
    score = logprob_to_confidence(avg_logprob)
    assert expected_min <= score <= expected_max


def test_logprob_to_confidence_clamped() -> None:
    # Should never go above 1.0 or below 0.0
    assert logprob_to_confidence(0.0) == 1.0
    assert logprob_to_confidence(-100.0) < 0.001


@pytest.mark.parametrize(
    "confidence,expected",
    [
        (0.95, ConfidenceDecision.ACCEPT),
        (0.75, ConfidenceDecision.ACCEPT),  # exactly at threshold
        (0.74, ConfidenceDecision.REVIEW),  # just below accept
        (0.60, ConfidenceDecision.REVIEW),  # exactly at review floor
        (0.59, ConfidenceDecision.REJECT),  # just below review
        (0.00, ConfidenceDecision.REJECT),
    ],
)
def test_evaluate_confidence(confidence: float, expected: ConfidenceDecision) -> None:
    assert evaluate_confidence(confidence) == expected
