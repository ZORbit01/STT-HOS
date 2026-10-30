import math
from enum import Enum

# Vosk grammar-constrained recognition is much less prone to free-form
# hallucination than the old Whisper path, so the gate can be more permissive.
_LOGPROB_FLOOR = -1.6
_LOGPROB_CEIL = 0.0

ACCEPT_THRESHOLD = 0.75
REVIEW_THRESHOLD = 0.60


class ConfidenceDecision(str, Enum):
    ACCEPT = "ACCEPT"
    REVIEW = "REVIEW"
    REJECT = "REJECT"


def logprob_to_confidence(avg_logprob: float) -> float:
    """
    Map Vosk/STT avg_logprob linearly to a 0.0-1.0 confidence score.
    """
    if avg_logprob <= _LOGPROB_FLOOR:
        return 0.0
    if avg_logprob >= _LOGPROB_CEIL:
        return 1.0
    return math.exp(avg_logprob)


def evaluate_confidence(
    confidence: float,
    accept_threshold: float = ACCEPT_THRESHOLD,
    review_threshold: float = REVIEW_THRESHOLD,
) -> ConfidenceDecision:
    """
    Apply the three-tier confidence gate.
    Thresholds are parameters so callers can override from config without
    coupling this pure function to the settings module.
    """
    if confidence >= accept_threshold:
        return ConfidenceDecision.ACCEPT
    if confidence >= review_threshold:
        return ConfidenceDecision.REVIEW
    return ConfidenceDecision.REJECT
