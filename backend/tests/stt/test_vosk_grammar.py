import json

from app.stt.vosk.grammar import (
    build_command_endpoint_grammar,
    build_focused_grammar,
    build_grammar,
    build_wake_grammar,
    spell_case_code_variants,
)


def test_case_code_variants_include_natural_three_digit_forms() -> None:
    assert spell_case_code_variants("A111") == [
        "a one one one",
        "a one hundred eleven",
        "a one hundred and eleven",
        "a one eleven",
    ]


def test_grammar_includes_a111_command_variants() -> None:
    grammar = set(json.loads(build_grammar(["A111"])))

    assert "a one one one start" in grammar
    assert "a one eleven start" in grammar
    assert "a one hundred eleven start" in grammar
    assert "a one hundred and eleven in" in grammar


def test_grammar_includes_general_voice_code_prefixes() -> None:
    grammar = set(json.loads(build_grammar(["Z12", "AV8"])))

    assert "z twelve in" in grammar
    assert "z one two start" in grammar
    assert "a v eight in" in grammar
    assert "a v eight start" in grammar


def test_grammar_excludes_wake_word_command_variants() -> None:
    """'hey sina' / 'sina' are wake-only triggers — they must not appear
    fused with command phrases, or Vosk confuses the wake prefix with the
    leading letter of a case code (e.g. 'hey sina a one in')."""
    grammar = set(json.loads(build_grammar(["A1"])))
    focused = set(json.loads(build_focused_grammar("IN")))

    assert "hey sina a one in" not in grammar
    assert "sina a one in" not in grammar
    assert "hey sina incision" not in focused
    assert "sina incision" not in focused
    assert not any(phrase.startswith(("hey sina ", "sina ")) for phrase in grammar)
    assert not any(phrase.startswith(("hey sina ", "sina ")) for phrase in focused)


def test_wake_grammar_contains_only_wake_phrases() -> None:
    grammar = set(json.loads(build_wake_grammar()))

    assert "hey sina" in grammar
    assert "sina" in grammar
    assert "[unk]" in grammar
    assert "finish" not in grammar
    assert "incision" not in grammar
    assert "a one in" not in grammar


def test_command_grammar_includes_period_end_marker() -> None:
    grammar = set(json.loads(build_grammar(["A1"])))
    focused = set(json.loads(build_focused_grammar("IN")))

    assert "period" not in grammar
    assert "a one in period" in grammar
    assert "induction period" in focused
    assert "period" not in focused
    assert "period" not in set(json.loads(build_wake_grammar()))


def test_command_endpoint_grammar_contains_only_markers() -> None:
    grammar = set(json.loads(build_command_endpoint_grammar()))

    assert grammar == {"period", "[unk]"}
