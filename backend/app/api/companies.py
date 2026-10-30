from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_nurse_or_admin
from app.db import get_db
from app.models.orm import Company, case_companies

router = APIRouter(prefix="/api/v1/companies", tags=["companies"])


class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    model_config = {"str_strip_whitespace": True}


class CompanyUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    model_config = {"str_strip_whitespace": True}


class CompanyOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


async def _get_company(company_id: UUID, db: AsyncSession) -> Company:
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


async def _ensure_unique_name(name: str, db: AsyncSession, exclude_id: UUID | None = None) -> None:
    query = select(Company).where(func.lower(Company.name) == name.lower())
    if exclude_id is not None:
        query = query.where(Company.id != exclude_id)
    if (await db.execute(query)).scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Company '{name}' already exists",
        )


@router.get("", response_model=list[CompanyOut])
async def list_companies(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> list[Company]:
    result = await db.execute(select(Company).order_by(Company.name))
    return list(result.scalars().all())


@router.post("", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
async def create_company(
    body: CompanyCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Company:
    await _ensure_unique_name(body.name, db)
    company = Company(name=body.name)
    db.add(company)
    await db.commit()
    await db.refresh(company)
    return company


@router.patch("/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: UUID,
    body: CompanyUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Company:
    company = await _get_company(company_id, db)
    await _ensure_unique_name(body.name, db, exclude_id=company_id)
    company.name = body.name
    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_company(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> None:
    company = await _get_company(company_id, db)
    case_count = await db.scalar(
        select(func.count()).select_from(case_companies).where(case_companies.c.company_id == company_id)
    )
    if case_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Company has {case_count} case(s) on record and cannot be deleted",
        )
    await db.delete(company)
    await db.commit()
