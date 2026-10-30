from types import SimpleNamespace
from uuid import uuid4

from app.services.screen_feed_service import _to_out, _visitor_feed_case_codes


def test_room_move_feed_output_preserves_stored_voice_code_message() -> None:
    event = SimpleNamespace(
        id=uuid4(),
        audience="visitor",
        kind="reschedule",
        room_code="OR4",
        case_code="S20260601006",
        message="Case A1 moved from OR3 to OR4.",
        event_metadata={"from_room": "OR3", "to_room": "OR4", "display_case_code": "A1"},
        created_at="2026-06-01T06:00:00Z",
    )

    out = _to_out(event)

    assert out.message == "Case A1 moved from OR3 to OR4."


def test_visitor_visibility_considers_room_move_case_codes() -> None:
    room_move = SimpleNamespace(
        case_code="S20260601006",
        kind="reschedule",
        event_metadata={"from_room": "OR3", "to_room": "OR4"},
    )

    assert _visitor_feed_case_codes([room_move]) == {"S20260601006"}
