from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orm import Patient


async def list_patients(db: AsyncSession) -> list[Patient]:
    result = await db.execute(select(Patient).order_by(Patient.last_name, Patient.first_name))
    return list(result.scalars().all())


async def get_patient(patient_id: UUID, db: AsyncSession) -> Patient | None:
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    return result.scalar_one_or_none()


async def get_or_create_patient(
    db: AsyncSession,
    *,
    patient_id: UUID | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    mrn: str | None = None,
    age: int | None = None,
    sex: str | None = None,
) -> Patient | None:
    if patient_id:
        return await get_patient(patient_id, db)

    first_name = (first_name or "").strip()
    last_name = (last_name or "").strip()
    mrn = (mrn or "").strip() or None
    sex = (sex or "").strip().upper() or None

    if not first_name and not last_name and mrn is None and age is None and sex is None:
        return None

    if mrn:
        result = await db.execute(select(Patient).where(Patient.mrn == mrn))
        patient = result.scalar_one_or_none()
        if patient:
            patient.first_name = first_name or patient.first_name
            patient.last_name = last_name or patient.last_name
            patient.age = age if age is not None else patient.age
            patient.sex = sex or patient.sex
            return patient

    patient = Patient(
        first_name=first_name or "Unknown",
        last_name=last_name or "Patient",
        mrn=mrn,
        age=age,
        sex=sex,
    )
    db.add(patient)
    await db.flush()
    return patient
