from dataclasses import dataclass
from typing import Any


@dataclass
class WSMessage:
    event: str
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"event": self.event, "payload": self.payload}


def phase_transition_msg(
    case_code: str,
    room_code: str,
    from_phase: str,
    to_phase: str,
    source: str,
    confidence: float,
    raw_transcript: str | None,
    delay_minutes: float | None,
) -> WSMessage:
    return WSMessage(
        event="phase_transition",
        payload={
            "case_code": case_code,
            "room_code": room_code,
            "from_phase": from_phase,
            "to_phase": to_phase,
            "source": source,
            "confidence": confidence,
            "raw_transcript": raw_transcript,
            "delay_minutes": delay_minutes,
        },
    )


def schedule_changed_msg(reason: str) -> WSMessage:
    return WSMessage(
        event="schedule_changed",
        payload={"reason": reason},
    )


def review_needed_msg(
    room_code: str,
    raw_transcript: str,
    parsed_case_code: str,
    parsed_phase: str,
    confidence: float,
    review_id: str,
) -> WSMessage:
    return WSMessage(
        event="review_needed",
        payload={
            "room_code": room_code,
            "raw_transcript": raw_transcript,
            "parsed_intent": {"case_code": parsed_case_code, "phase": parsed_phase},
            "confidence": confidence,
            "review_id": review_id,
        },
    )


def room_reassigned_msg(
    case_code: str,
    from_room: str,
    to_room: str,
) -> WSMessage:
    return WSMessage(
        event="room_reassigned",
        payload={
            "case_code": case_code,
            "from_room": from_room,
            "to_room": to_room,
        },
    )


def alert_msg(
    case_code: str,
    room_code: str,
    alert_level: str,
    phase: str,
    elapsed_minutes: float,
) -> WSMessage:
    return WSMessage(
        event="alert",
        payload={
            "case_code": case_code,
            "room_code": room_code,
            "alert_level": alert_level,
            "phase": phase,
            "elapsed_minutes": elapsed_minutes,
        },
    )


def schedule_shifted_msg(room_code: str, shifts: list[dict]) -> WSMessage:
    return WSMessage(
        event="schedule_shifted",
        payload={"room_code": room_code, "shifts": shifts},
    )


def schedule_loaded_msg(cases_created: int) -> WSMessage:
    return WSMessage(
        event="schedule_loaded",
        payload={"cases_created": cases_created},
    )


def screen_state_msg(audience: str, state: Any) -> WSMessage:
    return WSMessage(
        event="screen_state",
        payload={
            "audience": audience,
            "state": state.model_dump(mode="json"),
        },
    )


def cancellation_requested_msg(
    case_code: str,
    room_code: str,
    requested_by_nurse_name: str | None,
    requested_at: str,
) -> WSMessage:
    return WSMessage(
        event="cancellation_requested",
        payload={
            "case_code": case_code,
            "room_code": room_code,
            "requested_by_nurse_name": requested_by_nurse_name,
            "requested_at": requested_at,
        },
    )


def screen_feed_event_msg(event: Any) -> WSMessage:
    return WSMessage(
        event="screen_feed_event",
        payload=event.model_dump(mode="json"),
    )
