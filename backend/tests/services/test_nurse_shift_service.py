from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import nurse_shift_service


@pytest.mark.asyncio
async def test_room_actor_metadata_falls_back_to_open_room_shift(monkeypatch) -> None:
    nurse_id = uuid4()
    shift = SimpleNamespace(
        id=uuid4(),
        nurse_id=nurse_id,
        induction_physician_id=uuid4(),
    )

    monkeypatch.setattr(nurse_shift_service, "get_room_session", lambda _room_code: None)

    async def fake_open_shift(_db, *, room, nurse_id=None):
        return shift

    monkeypatch.setattr(nurse_shift_service, "get_open_room_shift", fake_open_shift)

    metadata = await nurse_shift_service.room_actor_metadata(None, SimpleNamespace(room_code="OR1"))

    assert metadata == {
        "triggered_by_nurse_id": shift.nurse_id,
        "nurse_shift_id": shift.id,
        "induction_physician_id": shift.induction_physician_id,
    }
