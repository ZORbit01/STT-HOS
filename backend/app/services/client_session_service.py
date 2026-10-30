from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

LEASE_SECONDS = 45


@dataclass
class ClientRoomSession:
    session_id: str
    room_code: str
    nurse_id: str
    nurse_name: str
    induction_physician_id: str
    induction_physician_name: str
    expires_at: datetime
    nurse_shift_id: str | None = None


_sessions: dict[str, ClientRoomSession] = {}


def _now() -> datetime:
    return datetime.now(UTC)


def _is_expired(session: ClientRoomSession) -> bool:
    return session.expires_at <= _now()


def prune_expired_sessions() -> list[ClientRoomSession]:
    now = _now()
    expired = [session for session in _sessions.values() if session.expires_at <= now]
    for session in expired:
        _sessions.pop(session.room_code, None)
    return expired


def attach_shift_id(room_code: str, session_id: str, nurse_shift_id: str) -> None:
    session = _sessions.get(room_code.upper())
    if session and session.session_id == session_id:
        session.nurse_shift_id = nurse_shift_id


def clear_sessions() -> None:
    _sessions.clear()


def active_sessions() -> list[ClientRoomSession]:
    return [session for session in _sessions.values() if not _is_expired(session)]


def get_room_session(room_code: str) -> ClientRoomSession | None:
    session = _sessions.get(room_code.upper())
    if session is None or _is_expired(session):
        return None
    return session


def claim_room(
    room_code: str,
    nurse_id: str,
    nurse_name: str,
    induction_physician_id: str | None = None,
    induction_physician_name: str | None = None,
    session_id: str | None = None,
) -> ClientRoomSession | None:
    room = room_code.upper()
    current = _sessions.get(room)
    if current and _is_expired(current):
        current = None
    if current and current.session_id != session_id:
        if current.nurse_id != nurse_id:
            return None
        session_id = current.session_id
        induction_physician_id = induction_physician_id or current.induction_physician_id
        induction_physician_name = induction_physician_name or current.induction_physician_name
        nurse_shift_id = current.nurse_shift_id
    elif current and current.session_id == session_id:
        induction_physician_id = induction_physician_id or current.induction_physician_id
        induction_physician_name = induction_physician_name or current.induction_physician_name
        nurse_shift_id = current.nurse_shift_id
    else:
        nurse_shift_id = None

    if not induction_physician_id or not induction_physician_name:
        return None

    session = ClientRoomSession(
        session_id=session_id or uuid4().hex,
        room_code=room,
        nurse_id=nurse_id,
        nurse_name=nurse_name,
        induction_physician_id=induction_physician_id,
        induction_physician_name=induction_physician_name,
        expires_at=_now() + timedelta(seconds=LEASE_SECONDS),
        nurse_shift_id=nurse_shift_id,
    )
    _sessions[room] = session
    return session


def release_room(room_code: str, session_id: str) -> bool:
    room = room_code.upper()
    current = _sessions.get(room)
    if not current or current.session_id != session_id:
        return False
    _sessions.pop(room, None)
    return True
