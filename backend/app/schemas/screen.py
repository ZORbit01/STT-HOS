from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.domain.enums import AlertLevel, CasePhase, CaseType, RoomStatus, ScreenTimingStatus


class ScreenTimelineOut(BaseModel):
    start_hour: int
    end_hour: int
    split_hour: int


class ScreenCaseOut(BaseModel):
    id: UUID
    case_code: str
    voice_case_code: str | None = None
    case_type: CaseType
    room_id: UUID
    room_code: str
    current_phase: CasePhase
    phase_label: str
    alert_level: AlertLevel
    timing_status: ScreenTimingStatus
    status_label: str
    public_status_label: str
    procedure_name: str
    procedure_label: str
    physician_label: str
    patient_label: str
    public_patient_label: str
    original_planned_start: datetime
    original_planned_end: datetime
    scheduled_start: datetime
    display_start: datetime
    planned_end: datetime
    visual_end: datetime
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    expected_end_at: datetime | None = None
    estimated_duration_min: int
    remaining_minutes: int | None = None
    overrun_minutes: int
    is_active: bool
    is_complete: bool


class ScreenGapOut(BaseModel):
    room_id: UUID
    room_code: str
    start: datetime
    end: datetime
    minutes: int
    label: str


class ScreenRoomOut(BaseModel):
    id: UUID
    room_code: str
    status: RoomStatus
    active_case_code: str | None = None
    phase: CasePhase
    phase_label: str
    alert_level: AlertLevel
    timing_status: ScreenTimingStatus
    status_label: str
    gap_count: int
    progress_percent: int


class ScreenStateOut(BaseModel):
    generated_at: datetime
    audience: str
    timeline: ScreenTimelineOut
    rooms: list[ScreenRoomOut]
    cases: list[ScreenCaseOut]
    gaps: list[ScreenGapOut]


class ScreenFeedEventOut(BaseModel):
    id: UUID
    audience: str
    kind: str
    room_code: str | None = None
    case_code: str | None = None
    message: str
    metadata: dict | None = None
    created_at: datetime
