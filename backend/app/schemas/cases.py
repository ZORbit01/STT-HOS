from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.enums import AlertLevel, CasePhase, CaseType, DelayReasonCode, InputSource, TransitionOutcome


class DoctorOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str

    model_config = {"from_attributes": True}


class PatientOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    mrn: str | None = None
    age: int | None = None
    sex: str | None = None

    model_config = {"from_attributes": True}


class CompanyOut(BaseModel):
    id: UUID
    name: str

    model_config = {"from_attributes": True}


class PhaseEventOut(BaseModel):
    id: UUID
    from_phase: CasePhase
    to_phase: CasePhase
    source: InputSource
    outcome: TransitionOutcome
    raw_transcript: str | None
    confidence_score: float | None
    triggered_by_nurse_id: UUID | None = None
    triggered_by_nurse_name: str | None = None
    nurse_shift_id: UUID | None = None
    induction_physician_id: UUID | None = None
    induction_physician_name: str | None = None
    actual_time: datetime
    delay_minutes: float | None

    model_config = {"from_attributes": True}


class InductionPhysicianAssignmentOut(BaseModel):
    id: UUID
    nurse_shift_id: UUID
    induction_physician_id: UUID
    induction_physician_name: str | None = None
    assigned_at: datetime
    ended_at: datetime | None = None

    model_config = {"from_attributes": True}


class CaseOut(BaseModel):
    id: UUID
    case_code: str
    voice_case_code: str | None = None
    voice_code_day: date | None = None
    case_type: CaseType
    current_phase: CasePhase
    alert_level: AlertLevel
    procedure_name: str
    estimated_duration_min: int
    original_scheduled_start: datetime
    scheduled_start: datetime
    doctor: DoctorOut
    patient: PatientOut | None = None
    companies: list[CompanyOut] = Field(default_factory=list)
    isolation_required: bool = False
    notes: str | None = None
    patient_room: str | None = None
    scheduled_room_code: str = ""
    patient_name: str | None = None
    patient_age: int | None = None
    patient_sex: str | None = None
    actual_start_at: datetime | None = None
    expected_end_at: datetime | None = None
    actual_end_at: datetime | None = None
    induction_physician_id: UUID | None = None
    induction_physician_name: str | None = None
    delay_reason_required: bool = False
    delay_reason: DelayReasonCode | None = None
    delay_reason_note: str | None = None
    cancellation_requested: bool = False
    cancellation_requested_at: datetime | None = None
    cancellation_requested_by_nurse_name: str | None = None
    cancellation_reason: str | None = None
    cancellation_confirmed_at: datetime | None = None

    model_config = {"from_attributes": True}


class CaseDetailOut(CaseOut):
    phase_events: list[PhaseEventOut] = []
    induction_assignments: list[InductionPhysicianAssignmentOut] = []


class CaseCreate(BaseModel):
    procedure_name: str
    estimated_duration_min: int
    scheduled_start: datetime
    scheduled_room_code: str
    # Surgeons are managed in their own admin tab — cases only reference them,
    # they are never created implicitly from a case form.
    doctor_id: UUID
    case_code: str | None = None  # auto-generated if omitted
    patient_id: UUID | None = None
    patient_first_name: str | None = None
    patient_last_name: str | None = None
    patient_mrn: str | None = None
    patient_age: int | None = None
    patient_sex: str | None = None
    company_names: list[str] = Field(default_factory=list, max_length=20)
    isolation_required: bool = False
    notes: str | None = Field(default=None, max_length=2000)
    patient_room: str | None = Field(default=None, max_length=64)

    model_config = {"str_strip_whitespace": True}


class CaseUpdate(BaseModel):
    procedure_name: str | None = None
    estimated_duration_min: int | None = None
    scheduled_start: datetime | None = None
    scheduled_room_code: str | None = None
    doctor_id: UUID | None = None
    patient_id: UUID | None = None
    patient_first_name: str | None = None
    patient_last_name: str | None = None
    patient_mrn: str | None = None
    patient_age: int | None = None
    patient_sex: str | None = None
    company_names: list[str] | None = Field(default=None, max_length=20)
    isolation_required: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)
    patient_room: str | None = Field(default=None, max_length=64)
    alert_level: AlertLevel | None = None
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    expected_end_at: datetime | None = None

    model_config = {"str_strip_whitespace": True}


class DelayReasonSubmit(BaseModel):
    reason: DelayReasonCode
    note: str | None = None


class CancellationReasonSubmit(BaseModel):
    reason: str = Field(min_length=1)

    model_config = {"str_strip_whitespace": True}


class TransitionRequest(BaseModel):
    to_phase: CasePhase
    # Mic client's room — when set it overrides the case's scheduled room,
    # mirroring the STT rule that the mic's room always wins.
    room_code: str | None = None


class TransitionResponse(BaseModel):
    outcome: TransitionOutcome
    from_phase: CasePhase
    to_phase: CasePhase
