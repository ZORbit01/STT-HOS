from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_nurse_or_admin
from app.db import get_db
from app.models.orm import Patient
from app.schemas.patients import PatientCreate, PatientOut, PatientUpdate
from app.services.patient_service import get_patient, list_patients

router = APIRouter(prefix="/api/v1/patients", tags=["patients"])


@router.get("", response_model=list[PatientOut])
async def get_patients(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse_or_admin),
) -> list[Patient]:
    return await list_patients(db)


@router.post("", response_model=PatientOut, status_code=201)
async def create_patient(
    body: PatientCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Patient:
    patient = Patient(
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        mrn=body.mrn.strip() if body.mrn else None,
        age=body.age,
        sex=body.sex.strip().upper() if body.sex else None,
    )
    db.add(patient)
    await db.commit()
    await db.refresh(patient)
    return patient


@router.patch("/{patient_id}", response_model=PatientOut)
async def update_patient(
    patient_id: UUID,
    body: PatientUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> Patient:
    patient = await get_patient(patient_id, db)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    if body.first_name is not None:
        patient.first_name = body.first_name.strip()
    if body.last_name is not None:
        patient.last_name = body.last_name.strip()
    if body.mrn is not None:
        patient.mrn = body.mrn.strip() or None
    if body.age is not None:
        patient.age = body.age
    if body.sex is not None:
        patient.sex = body.sex.strip().upper() or None

    await db.commit()
    await db.refresh(patient)
    return patient


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_patient(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
) -> None:
    patient = await get_patient(patient_id, db)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    await db.delete(patient)
    await db.commit()
