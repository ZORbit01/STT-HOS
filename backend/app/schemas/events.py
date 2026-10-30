from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.domain.enums import CasePhase, InputSource, TransitionOutcome


class EventOut(BaseModel):
    id: UUID
    case_id: UUID
    room_id: UUID
    from_phase: CasePhase
    to_phase: CasePhase
    source: InputSource
    outcome: TransitionOutcome
    raw_transcript: str | None
    confidence_score: float | None
    actual_time: datetime
    delay_minutes: float | None

    model_config = {"from_attributes": True}
