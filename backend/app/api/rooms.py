from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_db
from app.domain.enums import RoomStatus
from app.models.orm import OperatingRoom
from app.schemas.rooms import RoomOut
from app.services.room_service import list_rooms

router = APIRouter(prefix="/api/v1/rooms", tags=["rooms"])


class RoomStatusUpdate(BaseModel):
    status: RoomStatus


@router.get("", response_model=list[RoomOut])
async def get_rooms(db: AsyncSession = Depends(get_db)) -> list[RoomOut]:
    rooms = await list_rooms(db)
    return [RoomOut.model_validate(r) for r in rooms]


@router.patch("/{room_id}/status", response_model=RoomOut)
async def update_room_status(
    room_id: UUID,
    body: RoomStatusUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> RoomOut:
    result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == room_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    room.status = body.status
    if body.status == RoomStatus.AVAILABLE:
        room.active_case_id = None
    await db.commit()
    await db.refresh(room)

    return RoomOut.model_validate(
        {
            "id": room.id,
            "room_code": room.room_code,
            "status": room.status,
            "active_case_code": room.active_case.case_code if room.active_case else None,
        }
    )
