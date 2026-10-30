from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_nurse, require_nurse_or_admin
from app.db import get_db
from app.models.orm import InductionPhysician, NurseAccount, OperatingRoom
from app.services.client_session_service import (
    active_sessions,
    attach_shift_id,
    claim_room,
    get_room_session,
    release_room,
)
from app.services.nurse_shift_service import (
    close_expired_room_sessions,
    end_nurse_shift,
    get_open_nurse_shift,
    upsert_nurse_shift,
)

router = APIRouter(prefix="/api/v1/client-sessions", tags=["client-sessions"])


class ClaimRoomRequest(BaseModel):
    session_id: str | None = None
    induction_physician_id: UUID | None = None


class ClientRoomSessionOut(BaseModel):
    session_id: str
    room_code: str
    nurse_id: str
    nurse_name: str
    induction_physician_id: str
    induction_physician_name: str
    expires_at: datetime
    nurse_shift_id: str | None = None


class RoomOccupancyOut(BaseModel):
    room_code: str
    occupied: bool
    session: ClientRoomSessionOut | None = None


def _session_out(session) -> ClientRoomSessionOut:
    return ClientRoomSessionOut(
        session_id=session.session_id,
        room_code=session.room_code,
        nurse_id=session.nurse_id,
        nurse_name=session.nurse_name,
        induction_physician_id=session.induction_physician_id,
        induction_physician_name=session.induction_physician_name,
        expires_at=session.expires_at,
        nurse_shift_id=session.nurse_shift_id,
    )


async def _nurse_name(nurse_id: str, db: AsyncSession) -> str:
    result = await db.execute(select(NurseAccount).where(NurseAccount.id == nurse_id))
    nurse = result.scalar_one_or_none()
    if nurse is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nurse not found")
    return f"{nurse.first_name} {nurse.last_name}"


async def _induction_physician_name(physician_id: UUID, db: AsyncSession) -> str:
    result = await db.execute(
        select(InductionPhysician).where(
            InductionPhysician.id == physician_id,
            InductionPhysician.is_active.is_(True),
        )
    )
    physician = result.scalar_one_or_none()
    if physician is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose an active induction physician")
    return f"{physician.first_name} {physician.last_name}"


@router.get("/rooms", response_model=list[RoomOccupancyOut])
async def list_client_rooms(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> list[RoomOccupancyOut]:
    close_expired_room_sessions()
    await db.commit()
    result = await db.execute(select(OperatingRoom).order_by(OperatingRoom.room_code))
    rooms = result.scalars().all()
    by_room = {session.room_code: session for session in active_sessions()}
    return [
        RoomOccupancyOut(
            room_code=room.room_code,
            occupied=room.room_code in by_room,
            session=_session_out(by_room[room.room_code]) if room.room_code in by_room else None,
        )
        for room in rooms
    ]


@router.post("/rooms/{room_code}/claim", response_model=ClientRoomSessionOut)
async def claim_client_room(
    room_code: str,
    body: ClaimRoomRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_nurse),
) -> ClientRoomSessionOut:
    close_expired_room_sessions()

    result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == room_code.upper()))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    nurse_id = str(payload["sub"])
    current = get_room_session(room_code)
    physician_id = body.induction_physician_id or (
        UUID(current.induction_physician_id) if current and current.nurse_id == nurse_id else None
    )
    if physician_id is None:
        shift = await get_open_nurse_shift(db, nurse_id=nurse_id, room=room)
        physician_id = shift.induction_physician_id if shift else None
    if physician_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Induction physician is required to start a shift",
        )

    physician_name = await _induction_physician_name(physician_id, db)
    session = claim_room(
        room_code,
        nurse_id,
        await _nurse_name(nurse_id, db),
        str(physician_id),
        physician_name,
        body.session_id,
    )
    if session is None:
        detail = f"{room_code.upper()} is already in use"
        if current:
            detail = f"{room_code.upper()} is already in use by {current.nurse_name}"
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)

    shift = await upsert_nurse_shift(db, session=session, room=room)
    attach_shift_id(session.room_code, session.session_id, str(shift.id))
    session.nurse_shift_id = str(shift.id)
    await db.commit()
    return _session_out(session)


@router.post("/rooms/{room_code}/release", status_code=status.HTTP_204_NO_CONTENT)
async def release_client_room(
    room_code: str,
    body: ClaimRoomRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_nurse),
) -> None:
    close_expired_room_sessions()
    released = None
    if body.session_id:
        release_room(room_code, body.session_id)
        released = await end_nurse_shift(db, session_id=body.session_id, end_reason="RELEASED")
    if released is None:
        result = await db.execute(select(OperatingRoom).where(OperatingRoom.room_code == room_code.upper()))
        room = result.scalar_one_or_none()
        if room is not None:
            shift = await get_open_nurse_shift(db, nurse_id=str(payload["sub"]), room=room)
            if shift is not None:
                shift.ended_at = datetime.now(UTC)
                shift.end_reason = "RELEASED"
                shift.last_seen_at = shift.ended_at
    await db.commit()
