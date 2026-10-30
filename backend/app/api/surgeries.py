from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_nurse_or_admin
from app.db import get_db
from app.models.orm import Surgery, SurgicalCase

router = APIRouter(prefix="/api/v1/surgeries", tags=["surgeries"])


class SurgeryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)

    model_config = {"str_strip_whitespace": True}


class SurgeryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    is_active: bool | None = None

    model_config = {"str_strip_whitespace": True}


class SurgeryOut(BaseModel):
    id: UUID
    name: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


async def _get_surgery(surgery_id: UUID, db: AsyncSession) -> Surgery:
    surgery = (await db.execute(select(Surgery).where(Surgery.id == surgery_id))).scalar_one_or_none()
    if surgery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Surgery not found")
    return surgery


async def _ensure_unique_name(name: str, db: AsyncSession, exclude_id: UUID | None = None) -> None:
    query = select(Surgery).where(func.lower(Surgery.name) == name.lower())
    if exclude_id is not None:
        query = query.where(Surgery.id != exclude_id)
    if (await db.execute(query)).scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Surgery '{name}' already exists",
        )


@router.get("", response_model=list[SurgeryOut])
async def list_surgeries(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> list[Surgery]:
    query = select(Surgery).order_by(Surgery.name)
    if not include_inactive:
        query = query.where(Surgery.is_active.is_(True))
    return list((await db.execute(query)).scalars().all())


@router.post("", response_model=SurgeryOut, status_code=status.HTTP_201_CREATED)
async def create_surgery(
    body: SurgeryCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Surgery:
    await _ensure_unique_name(body.name, db)
    surgery = Surgery(name=body.name)
    db.add(surgery)
    await db.commit()
    await db.refresh(surgery)
    return surgery


@router.patch("/{surgery_id}", response_model=SurgeryOut)
async def update_surgery(
    surgery_id: UUID,
    body: SurgeryUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Surgery:
    surgery = await _get_surgery(surgery_id, db)
    if body.name is not None and body.name != surgery.name:
        await _ensure_unique_name(body.name, db, exclude_id=surgery_id)
        await db.execute(
            update(SurgicalCase).where(SurgicalCase.procedure_name == surgery.name).values(procedure_name=body.name)
        )
        surgery.name = body.name
    if body.is_active is not None:
        surgery.is_active = body.is_active
    await db.commit()
    await db.refresh(surgery)
    return surgery


@router.delete("/{surgery_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_surgery(
    surgery_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> None:
    surgery = await _get_surgery(surgery_id, db)
    case_count = await db.scalar(
        select(func.count()).select_from(SurgicalCase).where(SurgicalCase.procedure_name == surgery.name)
    )
    if case_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Surgery has {case_count} case(s) on record — disable it instead of deleting",
        )
    await db.delete(surgery)
    await db.commit()
