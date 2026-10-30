from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Table, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.domain.enums import (
    AlertLevel,
    CasePhase,
    CaseType,
    DelayReasonCode,
    InputSource,
    RoomStatus,
    TransitionOutcome,
)


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class ScreenAccount(Base):
    __tablename__ = "screen_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    location: Mapped[str] = mapped_column(String(128), nullable=False)  # e.g. "Main Corridor"
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class AdminAccount(Base):
    __tablename__ = "admin_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    cases: Mapped[list[SurgicalCase]] = relationship("SurgicalCase", back_populates="doctor")


class InductionPhysician(Base):
    __tablename__ = "induction_physicians"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    mrn: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    cases: Mapped[list[SurgicalCase]] = relationship("SurgicalCase", back_populates="patient")


case_companies = Table(
    "case_companies",
    Base.metadata,
    Column(
        "case_id",
        UUID(as_uuid=True),
        ForeignKey("surgical_cases.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "company_id",
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    cases: Mapped[list[SurgicalCase]] = relationship(
        "SurgicalCase", secondary=case_companies, back_populates="companies"
    )


class HospitalRoom(Base):
    __tablename__ = "hospital_rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class Surgery(Base):
    __tablename__ = "surgeries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class OperatingRoom(Base):
    __tablename__ = "operating_rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    room_code: Mapped[str] = mapped_column(String(8), unique=True, nullable=False)
    mic_stream_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[RoomStatus] = mapped_column(SAEnum(RoomStatus), nullable=False, default=RoomStatus.AVAILABLE)
    active_case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surgical_cases.id", use_alter=True, name="fk_room_active_case"), nullable=True
    )
    device_username: Mapped[str] = mapped_column(String(64), nullable=False)

    active_case: Mapped[SurgicalCase | None] = relationship("SurgicalCase", foreign_keys=[active_case_id])
    device_accounts: Mapped[list[DeviceAccount]] = relationship("DeviceAccount", back_populates="room")


class VoiceCodeCycle(Base):
    __tablename__ = "voice_code_cycles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class VoiceCodeState(Base):
    __tablename__ = "voice_code_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    current_cycle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("voice_code_cycles.id"), nullable=False
    )


class SurgicalCase(Base):
    __tablename__ = "surgical_cases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    case_code: Mapped[str] = mapped_column(String(16), nullable=False)
    voice_case_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    voice_code_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    voice_code_cycle_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("voice_code_cycles.id"), nullable=True, index=True
    )
    case_type: Mapped[CaseType] = mapped_column(SAEnum(CaseType), nullable=False)
    current_phase: Mapped[CasePhase] = mapped_column(SAEnum(CasePhase), nullable=False, default=CasePhase.IDLE)
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=True
    )
    scheduled_room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=False
    )
    doctor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("doctors.id"), nullable=False)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=True)
    procedure_name: Mapped[str] = mapped_column(String(256), nullable=False)
    estimated_duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    original_scheduled_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scheduled_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    alert_level: Mapped[AlertLevel] = mapped_column(SAEnum(AlertLevel), nullable=False, default=AlertLevel.NONE)
    patient_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    patient_gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    isolation_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient_room: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Actual timing — set by mic events
    actual_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expected_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the case starts late and the gap is NOT explained by a cascade push
    # from the previous case — the nurse must record why (set once, at start)
    delay_reason_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    delay_reason: Mapped[DelayReasonCode | None] = mapped_column(SAEnum(DelayReasonCode), nullable=True)
    delay_reason_note: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Cancellation workflow — request freezes the case until an admin confirms or cancels directly
    cancellation_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cancellation_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_requested_by_nurse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("nurse_accounts.id"), nullable=True
    )
    cancellation_reason: Mapped[str | None] = mapped_column(String(512), nullable=True)
    cancellation_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_confirmed_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_accounts.id"), nullable=True
    )
    # Set once when the first IDLE→IN accepted transition fires — the physician on shift at that moment
    induction_physician_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("induction_physicians.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    import_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_imports.id"), nullable=True
    )

    doctor: Mapped[Doctor] = relationship("Doctor", back_populates="cases")
    patient: Mapped[Patient | None] = relationship("Patient", back_populates="cases")
    companies: Mapped[list[Company]] = relationship(
        "Company", secondary=case_companies, back_populates="cases", order_by="Company.name"
    )
    room: Mapped[OperatingRoom | None] = relationship("OperatingRoom", foreign_keys=[room_id])
    scheduled_room: Mapped[OperatingRoom] = relationship("OperatingRoom", foreign_keys=[scheduled_room_id])
    induction_physician: Mapped[InductionPhysician | None] = relationship("InductionPhysician")
    phase_events: Mapped[list[PhaseEvent]] = relationship("PhaseEvent", back_populates="case")
    cancellation_requested_by_nurse: Mapped[NurseAccount | None] = relationship(
        "NurseAccount", foreign_keys=[cancellation_requested_by_nurse_id]
    )


class PhaseEvent(Base):
    __tablename__ = "phase_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surgical_cases.id"), nullable=False)
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=False)
    scheduled_room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=False
    )
    room_reassigned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    from_phase: Mapped[CasePhase] = mapped_column(SAEnum(CasePhase), nullable=False)
    to_phase: Mapped[CasePhase] = mapped_column(SAEnum(CasePhase), nullable=False)
    source: Mapped[InputSource] = mapped_column(SAEnum(InputSource), nullable=False)
    outcome: Mapped[TransitionOutcome] = mapped_column(SAEnum(TransitionOutcome), nullable=False)
    raw_transcript: Mapped[str | None] = mapped_column(String(256), nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    triggered_by_nurse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("nurse_accounts.id"), nullable=True
    )
    nurse_shift_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("nurse_shifts.id"), nullable=True
    )
    induction_physician_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("induction_physicians.id"), nullable=True
    )
    scheduled_phase_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delay_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)

    case: Mapped[SurgicalCase] = relationship("SurgicalCase", back_populates="phase_events")
    room: Mapped[OperatingRoom] = relationship("OperatingRoom", foreign_keys=[room_id])
    scheduled_room: Mapped[OperatingRoom] = relationship("OperatingRoom", foreign_keys=[scheduled_room_id])
    triggered_by_nurse: Mapped[NurseAccount | None] = relationship("NurseAccount")
    nurse_shift: Mapped[NurseShift | None] = relationship("NurseShift")
    induction_physician: Mapped[InductionPhysician | None] = relationship("InductionPhysician")


class NurseAccount(Base):
    __tablename__ = "nurse_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class NurseShift(Base):
    __tablename__ = "nurse_shifts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=False)
    nurse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("nurse_accounts.id"), nullable=False)
    induction_physician_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("induction_physicians.id"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)

    room: Mapped[OperatingRoom] = relationship("OperatingRoom")
    nurse: Mapped[NurseAccount] = relationship("NurseAccount")
    induction_physician: Mapped[InductionPhysician] = relationship("InductionPhysician")


class InductionPhysicianAssignment(Base):
    __tablename__ = "induction_physician_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    nurse_shift_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("nurse_shifts.id"), nullable=False)
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=False)
    nurse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("nurse_accounts.id"), nullable=False)
    induction_physician_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("induction_physicians.id"), nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="SESSION")

    nurse_shift: Mapped[NurseShift] = relationship("NurseShift")
    room: Mapped[OperatingRoom] = relationship("OperatingRoom")
    nurse: Mapped[NurseAccount] = relationship("NurseAccount")
    induction_physician: Mapped[InductionPhysician] = relationship("InductionPhysician")


class DeviceAccount(Base):
    __tablename__ = "device_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=False)
    device_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    room: Mapped[OperatingRoom] = relationship("OperatingRoom", back_populates="device_accounts")


class ScheduleImport(Base):
    __tablename__ = "schedule_imports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    source_filename: Mapped[str] = mapped_column(String(256), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    imported_by: Mapped[str] = mapped_column(String(64), nullable=False)
    cases_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    error_detail: Mapped[str | None] = mapped_column(String(1024), nullable=True)


class ScreenFeedEvent(Base):
    __tablename__ = "screen_feed_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    audience: Mapped[str] = mapped_column(String(24), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    room_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    case_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    message: Mapped[str] = mapped_column(String(512), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    event_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class ScheduleChangeEvent(Base):
    __tablename__ = "schedule_change_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surgical_cases.id"), nullable=False)
    old_scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    new_scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    old_room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=True
    )
    new_room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    change_type: Mapped[str] = mapped_column(String(32), nullable=False)
    trigger_case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surgical_cases.id"), nullable=True
    )
    trigger_phase_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=True
    )
    created_by_nurse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("nurse_accounts.id"), nullable=True
    )
    created_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_accounts.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class CaseTimingEvent(Base):
    __tablename__ = "case_timing_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("surgical_cases.id"), nullable=False)
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operating_rooms.id"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    planned_reference_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_reference_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expected_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trigger_phase_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
