from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_db
from app.models.orm import NurseAccount
from app.services.auth_service import hash_password

router = APIRouter(prefix="/api/v1/nurses", tags=["nurses"])


class NurseCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)


class NurseUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=6, max_length=128)
    first_name: str | None = Field(default=None, min_length=1, max_length=64)
    last_name: str | None = Field(default=None, min_length=1, max_length=64)
    is_active: bool | None = None


class NurseOut(BaseModel):
    id: UUID
    username: str
    first_name: str
    last_name: str
    is_active: bool
    created_at: datetime


async def _get_nurse(nurse_id: UUID, db: AsyncSession) -> NurseAccount:
    result = await db.execute(select(NurseAccount).where(NurseAccount.id == nurse_id))
    nurse = result.scalar_one_or_none()
    if nurse is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nurse not found")
    return nurse


async def _username_exists(username: str, db: AsyncSession, exclude_id: UUID | None = None) -> bool:
    query = select(NurseAccount.id).where(NurseAccount.username == username)
    if exclude_id is not None:
        query = query.where(NurseAccount.id != exclude_id)
    result = await db.execute(query)
    return result.scalar_one_or_none() is not None


@router.get("", response_model=list[NurseOut])
async def list_nurses(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> list[NurseAccount]:
    query = select(NurseAccount).order_by(NurseAccount.last_name, NurseAccount.first_name)
    if not include_inactive:
        query = query.where(NurseAccount.is_active.is_(True))
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("", response_model=NurseOut, status_code=status.HTTP_201_CREATED)
async def create_nurse(
    body: NurseCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> NurseAccount:
    username = body.username.strip()
    if await _username_exists(username, db):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    nurse = NurseAccount(
        username=username,
        hashed_password=hash_password(body.password),
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
    )
    db.add(nurse)
    await db.commit()
    await db.refresh(nurse)
    return nurse


@router.patch("/{nurse_id}", response_model=NurseOut)
async def update_nurse(
    nurse_id: UUID,
    body: NurseUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> NurseAccount:
    nurse = await _get_nurse(nurse_id, db)

    if body.username is not None:
        username = body.username.strip()
        if await _username_exists(username, db, exclude_id=nurse.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
        nurse.username = username
    if body.password is not None:
        nurse.hashed_password = hash_password(body.password)
    if body.first_name is not None:
        nurse.first_name = body.first_name.strip()
    if body.last_name is not None:
        nurse.last_name = body.last_name.strip()
    if body.is_active is not None:
        nurse.is_active = body.is_active

    await db.commit()
    await db.refresh(nurse)
    return nurse


@router.delete("/{nurse_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_nurse(
    nurse_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> None:
    nurse = await _get_nurse(nurse_id, db)
    nurse.is_active = False
    await db.commit()
