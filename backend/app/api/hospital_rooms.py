from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_nurse_or_admin
from app.db import get_db
from app.models.orm import HospitalRoom, SurgicalCase

router = APIRouter(prefix="/api/v1/hospital-rooms", tags=["hospital rooms"])


class HospitalRoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)

    model_config = {"str_strip_whitespace": True}


class HospitalRoomUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    is_active: bool | None = None

    model_config = {"str_strip_whitespace": True}


class HospitalRoomOut(BaseModel):
    id: UUID
    name: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


async def _get_hospital_room(room_id: UUID, db: AsyncSession) -> HospitalRoom:
    room = (await db.execute(select(HospitalRoom).where(HospitalRoom.id == room_id))).scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hospital room not found")
    return room


async def _ensure_unique_name(name: str, db: AsyncSession, exclude_id: UUID | None = None) -> None:
    query = select(HospitalRoom).where(func.lower(HospitalRoom.name) == name.lower())
    if exclude_id is not None:
        query = query.where(HospitalRoom.id != exclude_id)
    if (await db.execute(query)).scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Hospital room '{name}' already exists",
        )


@router.get("", response_model=list[HospitalRoomOut])
async def list_hospital_rooms(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> list[HospitalRoom]:
    query = select(HospitalRoom).order_by(HospitalRoom.name)
    if not include_inactive:
        query = query.where(HospitalRoom.is_active.is_(True))
    return list((await db.execute(query)).scalars().all())


@router.post("", response_model=HospitalRoomOut, status_code=status.HTTP_201_CREATED)
async def create_hospital_room(
    body: HospitalRoomCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> HospitalRoom:
    await _ensure_unique_name(body.name, db)
    room = HospitalRoom(name=body.name)
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return room


@router.patch("/{room_id}", response_model=HospitalRoomOut)
async def update_hospital_room(
    room_id: UUID,
    body: HospitalRoomUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> HospitalRoom:
    room = await _get_hospital_room(room_id, db)
    if body.name is not None and body.name != room.name:
        await _ensure_unique_name(body.name, db, exclude_id=room_id)
        await db.execute(
            update(SurgicalCase).where(SurgicalCase.patient_room == room.name).values(patient_room=body.name)
        )
        room.name = body.name
    if body.is_active is not None:
        room.is_active = body.is_active
    await db.commit()
    await db.refresh(room)
    return room


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_hospital_room(
    room_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> None:
    room = await _get_hospital_room(room_id, db)
    case_count = await db.scalar(
        select(func.count()).select_from(SurgicalCase).where(SurgicalCase.patient_room == room.name)
    )
    if case_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Hospital room has {case_count} case(s) on record — disable it instead of deleting",
        )
    await db.delete(room)
    await db.commit()
