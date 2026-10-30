from uuid import UUID

from pydantic import BaseModel


class PatientBase(BaseModel):
    first_name: str
    last_name: str
    mrn: str | None = None
    age: int | None = None
    sex: str | None = None


class PatientCreate(PatientBase):
    pass


class PatientUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    mrn: str | None = None
    age: int | None = None
    sex: str | None = None


class PatientOut(PatientBase):
    id: UUID

    model_config = {"from_attributes": True}
