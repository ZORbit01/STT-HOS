import pytest

from app.stt.intent_parser import parse_intent

# --- Full commands (case code + "in") ---


@pytest.mark.parametrize(
    "text,expected_code",
    [
        ("A1 in", "A1"),
        ("A12 in", "A12"),
        ("AU2 in", "AU2"),
        ("AA1 in", "AA1"),
        ("a1 in", "A1"),  # case insensitive
        ("A1 in.", "A1"),  # Whisper punctuation artifact
        ("A1 IN", "A1"),  # uppercase keyword
        ("a one one one start", "A111"),
        ("a one eleven start", "A111"),
        ("a one hundred eleven start", "A111"),
        ("a one hundred and eleven start", "A111"),
        ("one one one start", "A111"),
        ("one eleven start", "A111"),
        ("z twelve in", "Z12"),
        ("z one two start", "Z12"),
        ("a v eight in", "AV8"),
        ("av8 start", "AV8"),
    ],
)
def test_full_command_valid(text: str, expected_code: str) -> None:
    result = parse_intent(text, active_case_code=None)
    assert result is not None
    assert result.case_code == expected_code
    assert result.phase == "IN"


# --- Phase-only commands with active case ---


@pytest.mark.parametrize(
    "text,expected_phase",
    [
        ("induction", "INDUCTION"),
        ("incision", "INCISION"),
        ("closure", "CLOSURE"),
        ("out", "OUT"),
        ("clean", "CLEANING"),
        ("done", "COMPLETE"),
        ("complete", "COMPLETE"),
        ("finished", "COMPLETE"),
        ("INCISION", "INCISION"),  # case insensitive
        ("closure.", "CLOSURE"),  # punctuation artifact
    ],
)
def test_phase_only_with_active_case(text: str, expected_phase: str) -> None:
    result = parse_intent(text, active_case_code="A1")
    assert result is not None
    assert result.case_code == "A1"  # active case carried through
    assert result.phase == expected_phase


# --- Phase-only commands with NO active case → must return None ---


@pytest.mark.parametrize(
    "text",
    [
        "incision",
        "induction",
        "closure",
        "out",
        "clean",
        "done",
        "complete",
    ],
)
def test_phase_only_without_active_case(text: str) -> None:
    assert parse_intent(text, active_case_code=None) is None


# --- Invalid / ambient speech ---


@pytest.mark.parametrize(
    "text",
    [
        "patient is ready",
        "how long until incision",
        "A1 incision",  # old full-command format no longer valid
        "A1 closure",  # same
        "A1 out",  # same
        "A1 clean",  # same
        "A1",  # code only, no phase
        "in",  # "in" alone is not a phase-only keyword
        "",
        "   ",
    ],
)
def test_invalid_commands(text: str) -> None:
    assert parse_intent(text, active_case_code="A1") is None
