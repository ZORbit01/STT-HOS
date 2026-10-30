from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_nurse_or_admin
from app.db import get_db
from app.models.orm import InductionPhysician

router = APIRouter(prefix="/api/v1/induction-physicians", tags=["induction-physicians"])


class InductionPhysicianCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)


class InductionPhysicianUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=64)
    last_name: str | None = Field(default=None, min_length=1, max_length=64)
    is_active: bool | None = None


class InductionPhysicianOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    is_active: bool
    created_at: datetime


async def _get_physician(physician_id: UUID, db: AsyncSession) -> InductionPhysician:
    result = await db.execute(select(InductionPhysician).where(InductionPhysician.id == physician_id))
    physician = result.scalar_one_or_none()
    if physician is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Induction physician not found")
    return physician


@router.get("", response_model=list[InductionPhysicianOut])
async def list_induction_physicians(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> list[InductionPhysician]:
    query = select(InductionPhysician).order_by(InductionPhysician.last_name, InductionPhysician.first_name)
    if not include_inactive:
        query = query.where(InductionPhysician.is_active.is_(True))
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("", response_model=InductionPhysicianOut, status_code=status.HTTP_201_CREATED)
async def create_induction_physician(
    body: InductionPhysicianCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> InductionPhysician:
    physician = InductionPhysician(
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
    )
    db.add(physician)
    await db.commit()
    await db.refresh(physician)
    return physician


@router.patch("/{physician_id}", response_model=InductionPhysicianOut)
async def update_induction_physician(
    physician_id: UUID,
    body: InductionPhysicianUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> InductionPhysician:
    physician = await _get_physician(physician_id, db)
    if body.first_name is not None:
        physician.first_name = body.first_name.strip()
    if body.last_name is not None:
        physician.last_name = body.last_name.strip()
    if body.is_active is not None:
        physician.is_active = body.is_active
    await db.commit()
    await db.refresh(physician)
    return physician


@router.delete("/{physician_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_induction_physician(
    physician_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> None:
    physician = await _get_physician(physician_id, db)
    physician.is_active = False
    await db.commit()
