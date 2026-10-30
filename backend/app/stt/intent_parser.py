import re
from dataclasses import dataclass

# ── Spoken-digit → digit mapping ──────────────────────────────────────────────

_WORD_TO_DIGIT: dict[str, str] = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen": "15",
    "sixteen": "16",
    "seventeen": "17",
    "eighteen": "18",
    "nineteen": "19",
    "twenty": "20",
    "thirty": "30",
    "forty": "40",
    "fifty": "50",
    "sixty": "60",
    "seventy": "70",
    "eighty": "80",
    "ninety": "90",
}

# Compound tens+ones — "twenty one" → "21"
_TENS = {"twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"}
_ONES = {"one", "two", "three", "four", "five", "six", "seven", "eight", "nine"}
_WORD_TO_LETTER = {chr(code).lower(): chr(code) for code in range(ord("A"), ord("Z") + 1)}


def _tokens_to_number(tokens: list[str]) -> tuple[str, int] | None:
    """
    Try to parse spoken digit tokens into a numeric string.
    Returns (number_string, tokens_consumed) or None.
    """
    if not tokens:
        return None

    t = tokens[0]

    # Hundreds: "one hundred", "one hundred eleven", "one hundred and eleven".
    if t in _ONES and len(tokens) > 1 and tokens[1] == "hundred":
        rest_idx = 2
        if len(tokens) > rest_idx and tokens[rest_idx] == "and":
            rest_idx += 1

        if len(tokens) > rest_idx:
            rest = _tokens_to_number(tokens[rest_idx:])
            if rest is not None:
                rest_value, rest_consumed = rest
                if 0 < int(rest_value) < 100:
                    return str((int(_WORD_TO_DIGIT[t]) * 100) + int(rest_value)), rest_idx + rest_consumed

        return str(int(_WORD_TO_DIGIT[t]) * 100), rest_idx

    # Single digit or named number
    if t in _WORD_TO_DIGIT:
        val = _WORD_TO_DIGIT[t]
        # Check for compound: "twenty one", "thirty five", etc.
        if t in _TENS and len(tokens) > 1 and tokens[1] in _ONES:
            combined = str(int(val) + int(_WORD_TO_DIGIT[tokens[1]]))
            return combined, 2
        return val, 1

    return None


def _parse_a_prefixed_digits(tokens: list[str]) -> tuple[str, int] | None:
    digits = ""
    idx = 0
    while idx < len(tokens):
        result = _tokens_to_number(tokens[idx:])
        if result is None:
            break
        num_str, consumed = result
        digits += num_str
        idx += consumed
        if idx < len(tokens) and tokens[idx] in (_TRIGGER_WORDS | _PHASE_WORDS.keys()):
            break

    if not digits:
        return None

    return f"A{digits}", idx


def _parse_letter_prefix(tokens: list[str]) -> tuple[str, int] | None:
    prefix = ""
    idx = 0
    while idx < len(tokens) and idx < 2 and tokens[idx] in _WORD_TO_LETTER:
        if len(tokens) > idx + 1 and _tokens_to_number(tokens[idx + 1 :]) is not None:
            prefix += _WORD_TO_LETTER[tokens[idx]]
            idx += 1
            break
        if (
            len(tokens) > idx + 2
            and tokens[idx + 1] in _WORD_TO_LETTER
            and _tokens_to_number(tokens[idx + 2 :]) is not None
        ):
            prefix += _WORD_TO_LETTER[tokens[idx]]
            idx += 1
            continue
        if idx == 0 and len(tokens) > 1 and _tokens_to_number(tokens[1:]) is not None:
            prefix += _WORD_TO_LETTER[tokens[idx]]
            idx += 1
            break
        break

    if not prefix:
        return None
    return prefix, idx


def _parse_case_code(tokens: list[str]) -> tuple[str, int] | None:
    """
    Try to parse a case code from the start of tokens.
    Returns (case_code, tokens_consumed) or None.

    Patterns:
      "a one"           → A1
      "a twelve start"  → A12
      "a v eight"       → AV8
      "z twelve"        → Z12
      "a one zero zero" → A100
    """
    if not tokens:
        return None

    prefix_result = _parse_letter_prefix(tokens)
    if prefix_result is None:
        return None
    prefix, idx = prefix_result

    if idx >= len(tokens):
        return None

    # Parse digits — may be multiple spoken digits
    digits = ""
    while idx < len(tokens):
        result = _tokens_to_number(tokens[idx:])
        if result is None:
            break
        num_str, consumed = result
        digits += num_str
        idx += consumed
        # After consuming one number token, check if next token is a trigger
        # "a one start" — stop after "one"
        if idx < len(tokens) and tokens[idx] in (_TRIGGER_WORDS | _PHASE_WORDS.keys()):
            break

    if not digits:
        return None

    return f"{prefix}{digits}", idx


_TRIGGER_WORDS = {"in", "start", "started", "starting", "begin", "began"}

_PHASE_WORDS = {
    "induction": "INDUCTION",
    "incision": "INCISION",
    "closure": "CLOSURE",
    "out": "OUT",
    "clean": "CLEANING",
    "cleaning": "CLEANING",
    "done": "COMPLETE",
    "complete": "COMPLETE",
    "completed": "COMPLETE",
    "finish": "COMPLETE",
    "finished": "COMPLETE",
    "cancel": "CANCELLATION_REQUEST",
}


@dataclass
class ParsedIntent:
    case_code: str | None
    phase: str


def parse_intent(text: str, active_case_code: str | None) -> ParsedIntent | None:
    """
    Parse a Vosk transcript into a ParsedIntent.

    Vosk returns spoken forms like "a one start" or "incision".
    We convert spoken digits back to case codes and extract the phase.
    """
    cleaned = text.lower().strip()
    # Remove [unk] tokens
    cleaned = re.sub(r"\[unk\]", "", cleaned).strip()
    cleaned = re.sub(r"[.,!?]+", "", cleaned).strip()
    if not cleaned:
        return None

    tokens = cleaned.split()

    if tokens[:2] == ["hey", "sina"]:
        tokens = tokens[2:]
    elif tokens[:1] == ["sina"]:
        tokens = tokens[1:]

    if not tokens:
        return None

    direct_code = re.match(r"^([a-z]{1,2})(\d+)$", tokens[0], re.IGNORECASE)
    if direct_code:
        rest = tokens[1:]
        if rest and rest[0] in _TRIGGER_WORDS:
            return ParsedIntent(case_code=f"{direct_code.group(1).upper()}{direct_code.group(2)}", phase="IN")
        return None

    # Try to parse a case code at the start
    code_result = _parse_case_code(tokens)
    if code_result:
        case_code, consumed = code_result
        rest = tokens[consumed:]

        # Next token should be a trigger word
        if rest and rest[0] in _TRIGGER_WORDS:
            return ParsedIntent(case_code=case_code, phase="IN")

        # Case code with no trigger — might be phase-only with code prefix, ignore
        return None

    # Fallback — 'a' prefix may have been clipped during wake→command transition.
    # Vosk outputs "[unk] one one one start"; after stripping [unk] we get
    # "one one one start". Interpret the leading number sequence as an A code.
    fallback_code = _parse_a_prefixed_digits(tokens)
    if fallback_code:
        case_code, consumed = fallback_code
        rest = tokens[consumed:]
        if rest and rest[0] in _TRIGGER_WORDS:
            return ParsedIntent(case_code=case_code, phase="IN")

    # Phase-only command
    if tokens and tokens[0] in _PHASE_WORDS:
        if active_case_code is None:
            return None
        return ParsedIntent(case_code=active_case_code, phase=_PHASE_WORDS[tokens[0]])

    return None
