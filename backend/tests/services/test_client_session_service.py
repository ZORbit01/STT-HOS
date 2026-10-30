from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.services.client_session_service import (
    active_sessions,
    attach_shift_id,
    claim_room,
    clear_sessions,
    get_room_session,
    prune_expired_sessions,
    release_room,
)
from app.services.nurse_shift_service import session_metadata


def setup_function() -> None:
    clear_sessions()


def teardown_function() -> None:
    clear_sessions()


def test_session_metadata_carries_shift_and_induction_context() -> None:
    nurse_id = uuid4()
    physician_id = uuid4()
    shift_id = uuid4()

    session = claim_room(
        "or1",
        str(nurse_id),
        "Nurse One",
        str(physician_id),
        "Dr Induction",
    )
    assert session is not None

    attach_shift_id("OR1", session.session_id, str(shift_id))
    session = get_room_session("OR1")

    assert session is not None
    assert session_metadata(session) == {
        "triggered_by_nurse_id": nurse_id,
        "nurse_shift_id": shift_id,
        "induction_physician_id": physician_id,
    }


def test_same_nurse_can_change_induction_physician_during_active_session() -> None:
    nurse_id = uuid4()
    first_physician_id = uuid4()
    second_physician_id = uuid4()

    session = claim_room(
        "OR1",
        str(nurse_id),
        "Nurse One",
        str(first_physician_id),
        "Dr First",
    )
    assert session is not None

    updated = claim_room(
        "OR1",
        str(nurse_id),
        "Nurse One",
        str(second_physician_id),
        "Dr Second",
        session.session_id,
    )

    assert updated is not None
    assert updated.session_id == session.session_id
    assert updated.induction_physician_id == str(second_physician_id)
    assert updated.induction_physician_name == "Dr Second"


def test_expired_sessions_are_hidden_until_cleanup_returns_them() -> None:
    session = claim_room(
        "OR2",
        str(uuid4()),
        "Nurse Two",
        str(uuid4()),
        "Dr Induction",
    )
    assert session is not None
    session.expires_at = datetime.now(UTC) - timedelta(seconds=1)

    assert active_sessions() == []
    assert get_room_session("OR2") is None

    expired = prune_expired_sessions()
    assert [item.session_id for item in expired] == [session.session_id]
    assert release_room("OR2", session.session_id) is False
