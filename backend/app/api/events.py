from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_nurse
from app.db import get_db
from app.domain.enums import InputSource, TransitionOutcome
from app.models.orm import PhaseEvent, SurgicalCase
from app.schemas.events import EventOut

router = APIRouter(prefix="/api/v1/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def list_events(
    case_code: str | None = Query(None),
    room_id: UUID | None = Query(None),
    source: InputSource | None = Query(None),
    outcome: TransitionOutcome | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_nurse),
) -> list[EventOut]:
    q = select(PhaseEvent).order_by(PhaseEvent.actual_time.desc())

    if case_code:
        subq = select(SurgicalCase.id).where(SurgicalCase.case_code == case_code)
        q = q.where(PhaseEvent.case_id.in_(subq))
    if room_id:
        q = q.where(PhaseEvent.room_id == room_id)
    if source:
        q = q.where(PhaseEvent.source == source)
    if outcome:
        q = q.where(PhaseEvent.outcome == outcome)

    result = await db.execute(q.limit(500))
    return [EventOut.model_validate(e) for e in result.scalars().all()]
