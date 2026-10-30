import json
import re

_DIGIT_WORDS = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
}

_LETTER_WORDS = {chr(code): chr(code).lower() for code in range(ord("A"), ord("Z") + 1)}

_TWO_DIGIT_WORDS = {
    "10": "ten",
    "11": "eleven",
    "12": "twelve",
    "13": "thirteen",
    "14": "fourteen",
    "15": "fifteen",
    "16": "sixteen",
    "17": "seventeen",
    "18": "eighteen",
    "19": "nineteen",
    "20": "twenty",
    "30": "thirty",
    "40": "forty",
    "50": "fifty",
    "60": "sixty",
    "70": "seventy",
    "80": "eighty",
    "90": "ninety",
}

_TENS_DIGITS = {"2", "3", "4", "5", "6", "7", "8", "9"}

_COMMAND_END_MARKERS = ["period"]


def spell_case_code(code: str) -> str:
    """
    Convert a case code to Vosk-recognizable spoken form.
    A1 -> "a one", A12 -> "a twelve", AV8 -> "a v eight".
    """
    match = re.match(r"^([A-Z]{1,2})(\d+)$", code, re.IGNORECASE)
    if not match:
        return code.lower()

    prefix = match.group(1).upper()
    digits = match.group(2)
    prefix_spoken = _spell_letter_prefix(prefix)

    return f"{prefix_spoken} {_spell_number_digit_sequence(digits)}"


def _spell_letter_prefix(prefix: str) -> str:
    return " ".join(_LETTER_WORDS.get(letter, letter.lower()) for letter in prefix)


def _spell_number_digit_sequence(digits: str) -> str:
    if len(digits) == 1:
        digit_spoken = _DIGIT_WORDS[digits]
    elif len(digits) == 2 and digits in _TWO_DIGIT_WORDS:
        digit_spoken = _TWO_DIGIT_WORDS[digits]
    elif len(digits) == 2:
        tens_word = _TWO_DIGIT_WORDS.get(str(int(digits[0]) * 10), _DIGIT_WORDS[digits[0]])
        ones = int(digits[1])
        digit_spoken = f"{tens_word} {_DIGIT_WORDS[digits[1]]}" if ones else tens_word
    else:
        digit_spoken = " ".join(_DIGIT_WORDS[digit] for digit in digits)

    return digit_spoken


def _spell_three_digit_variants(digits: str) -> list[str]:
    if len(digits) != 3 or digits[0] == "0":
        return []

    hundred = _DIGIT_WORDS[digits[0]]
    tail = digits[1:]
    variants = []
    if tail == "00":
        variants.append(f"{hundred} hundred")
    else:
        variants.append(f"{hundred} hundred {_spell_number_digit_sequence(tail)}")
        variants.append(f"{hundred} hundred and {_spell_number_digit_sequence(tail)}")
        if tail in _TWO_DIGIT_WORDS or tail[0] in _TENS_DIGITS:
            variants.append(f"{hundred} {_spell_number_digit_sequence(tail)}")
    return variants


def spell_case_code_variants(code: str) -> list[str]:
    """
    Return recognized spoken forms for a case code.

    Keep the digit-by-digit form first because it is the safest grammar phrase,
    then add natural three-digit variants like "a one eleven" and
    "a one hundred eleven" for codes such as A111.
    """
    match = re.match(r"^([A-Z]{1,2})(\d+)$", code, re.IGNORECASE)
    if not match:
        return [code.lower()]

    prefix = match.group(1).upper()
    digits = match.group(2)
    prefix_spoken = _spell_letter_prefix(prefix)
    variants = [spell_case_code(code)]

    digit_by_digit = f"{prefix_spoken} {' '.join(_DIGIT_WORDS[digit] for digit in digits)}"
    variants.append(digit_by_digit)

    variants.extend(f"{prefix_spoken} {number_variant}" for number_variant in _spell_three_digit_variants(digits))

    return list(dict.fromkeys(variants))


def build_grammar(case_codes: list[str]) -> str:
    """
    Grammar for the IDLE/start path: only case-code "in"/"start" phrases.
    Other phase keywords (induction, incision, ...) only matter once a case
    is already running — build_focused_grammar handles those, scoped to
    exactly the keyword(s) that advance from the current phase.
    """
    command_phrases: list[str] = []
    for code in case_codes:
        for spoken in spell_case_code_variants(code):
            command_phrases.append(f"{spoken} in")
            command_phrases.append(f"{spoken} start")

    # "hey sina" / "sina" are wake-word entry triggers only (see build_wake_grammar) —
    # they must not appear inside command phrases, or Vosk's grammar matcher confuses
    # the wake prefix with the leading letter of a case code (e.g. "hey sina a one in").
    phrases = list(command_phrases)
    for phrase in command_phrases:
        for marker in _COMMAND_END_MARKERS:
            phrases.append(f"{phrase} {marker}")

    phrases.append("[unk]")
    return json.dumps(phrases)


def build_wake_grammar() -> str:
    """Return the wake-only grammar used before command capture is armed."""
    return json.dumps(["hey sina", "hey jarvis", "jarvis", "sina", "[unk]"])


def build_command_endpoint_grammar() -> str:
    """Return grammar for spoken command endpoint markers, not commands."""
    return json.dumps([*_COMMAND_END_MARKERS, "[unk]"])


# Map each phase to the exact keywords that trigger the NEXT phase.
# Only these words matter once the current phase is known.
_NEXT_PHASE_KEYWORDS: dict[str, list[str]] = {
    "IN": ["induction", "cancel"],
    "INDUCTION": ["incision", "cancel"],
    "INCISION": ["closure", "cancel"],
    "CLOSURE": ["out", "cancel"],
    "OUT": ["clean", "cleaning", "cancel"],
    "CLEANING": ["done", "complete", "finish", "finished", "cancel"],
}


def build_focused_grammar(current_phase: str) -> str | None:
    """
    Return a minimal grammar containing only the keyword(s) that advance
    from current_phase to the next phase.  Returns None for phases where
    the full grammar is needed (IDLE needs case codes, COMPLETE has no next).
    """
    keywords = _NEXT_PHASE_KEYWORDS.get(current_phase)
    if not keywords:
        return None

    # "hey sina" / "sina" are wake-word entry triggers only — omit them here too,
    # for the same reason as build_grammar (see comment there).
    phrases: list[str] = list(keywords)
    for kw in keywords:
        for marker in _COMMAND_END_MARKERS:
            phrases.append(f"{kw} {marker}")
    phrases.append("[unk]")
    return json.dumps(phrases)
