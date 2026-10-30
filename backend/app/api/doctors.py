from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_nurse_or_admin
from app.db import get_db
from app.models.orm import Doctor, SurgicalCase

router = APIRouter(prefix="/api/v1/doctors", tags=["doctors"])


class DoctorCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)

    model_config = {"str_strip_whitespace": True}


class DoctorUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=64)
    last_name: str | None = Field(default=None, min_length=1, max_length=64)
    is_active: bool | None = None

    model_config = {"str_strip_whitespace": True}


class DoctorOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    is_active: bool
    created_at: datetime


async def _get_doctor(doctor_id: UUID, db: AsyncSession) -> Doctor:
    result = await db.execute(select(Doctor).where(Doctor.id == doctor_id))
    doctor = result.scalar_one_or_none()
    if doctor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Surgeon not found")
    return doctor


@router.get("", response_model=list[DoctorOut])
async def list_doctors(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> list[Doctor]:
    query = select(Doctor).order_by(Doctor.last_name, Doctor.first_name)
    if not include_inactive:
        query = query.where(Doctor.is_active.is_(True))
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("", response_model=DoctorOut, status_code=status.HTTP_201_CREATED)
async def create_doctor(
    body: DoctorCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Doctor:
    existing = await db.execute(
        select(Doctor).where(
            func.lower(Doctor.first_name) == body.first_name.lower(),
            func.lower(Doctor.last_name) == body.last_name.lower(),
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Surgeon '{body.first_name} {body.last_name}' already exists",
        )
    doctor = Doctor(first_name=body.first_name, last_name=body.last_name)
    db.add(doctor)
    await db.commit()
    await db.refresh(doctor)
    return doctor


@router.patch("/{doctor_id}", response_model=DoctorOut)
async def update_doctor(
    doctor_id: UUID,
    body: DoctorUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Doctor:
    doctor = await _get_doctor(doctor_id, db)
    if body.first_name is not None:
        doctor.first_name = body.first_name
    if body.last_name is not None:
        doctor.last_name = body.last_name
    if body.is_active is not None:
        doctor.is_active = body.is_active
    await db.commit()
    await db.refresh(doctor)
    return doctor


@router.delete("/{doctor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_doctor(
    doctor_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> None:
    doctor = await _get_doctor(doctor_id, db)
    case_count = await db.scalar(
        select(func.count()).select_from(SurgicalCase).where(SurgicalCase.doctor_id == doctor_id)
    )
    if case_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Surgeon has {case_count} case(s) on record — deactivate instead of deleting",
        )
    await db.delete(doctor)
    await db.commit()
