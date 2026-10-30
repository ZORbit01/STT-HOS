from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import AlertLevel, CasePhase
from app.models.orm import ScreenFeedEvent, SurgicalCase
from app.schemas.screen import ScreenFeedEventOut
from app.ws.messages import screen_feed_event_msg

ScreenAudience = Literal["professional", "visitor"]

FEED_LIMIT = 60
FEED_RETENTION_HOURS = 48

PHASE_VISITOR_MESSAGE: dict[CasePhase, str] = {
    CasePhase.IN: "Care team has started the next step.",
    CasePhase.INDUCTION: "Care team is preparing the patient for the procedure.",
    CasePhase.INCISION: "Procedure is in progress.",
    CasePhase.CLOSURE: "Procedure is moving toward completion.",
    CasePhase.OUT: "Procedure is complete and the care team is moving to the next step.",
    CasePhase.CLEANING: "The room is being prepared after the procedure.",
    CasePhase.COMPLETE: "Procedure complete.",
    CasePhase.IDLE: "Case is scheduled.",
    CasePhase.CANCELLED: "Case has been cancelled.",
}


def _to_out(event: ScreenFeedEvent) -> ScreenFeedEventOut:
    metadata = event.event_metadata
    message = event.message

    return ScreenFeedEventOut(
        id=event.id,
        audience=event.audience,
        kind=event.kind,
        room_code=event.room_code,
        case_code=event.case_code,
        message=message,
        metadata=metadata,
        created_at=event.created_at,
    )


def _format_time(value: datetime | str) -> str:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone().strftime("%I:%M %p").lstrip("0")


def visitor_case_label(case_code: str | None) -> str:
    return f"Case {case_code}" if case_code else "A case"


def _case_display_code(case: SurgicalCase) -> str:
    return case.voice_case_code or case.case_code


def _is_room_move_event(event: ScreenFeedEvent) -> bool:
    metadata = event.event_metadata
    return (
        event.kind == "reschedule"
        and isinstance(metadata, dict)
        and bool(metadata.get("from_room"))
        and bool(metadata.get("to_room"))
    )


def _visitor_feed_case_codes(events: list[ScreenFeedEvent]) -> set[str]:
    return {
        event.case_code
        for event in events
        if event.case_code and event.kind == "reschedule"
    }


async def _visitor_visible_case_codes(db: AsyncSession, events: list[ScreenFeedEvent]) -> set[str]:
    case_codes = _visitor_feed_case_codes(events)
    if not case_codes:
        return set()

    result = await db.execute(
        select(SurgicalCase.case_code).where(
            SurgicalCase.case_code.in_(case_codes),
            SurgicalCase.current_phase == CasePhase.IDLE,
        )
    )
    return set(result.scalars().all())


async def list_feed_events(
    db: AsyncSession,
    audience: ScreenAudience,
    limit: int = FEED_LIMIT,
) -> list[ScreenFeedEventOut]:
    result = await db.execute(
        select(ScreenFeedEvent)
        .where(ScreenFeedEvent.audience == audience)
        .order_by(ScreenFeedEvent.created_at.desc())
        .limit(limit * 3)
    )
    events = list(result.scalars().all())

    if audience == "visitor":
        visible_case_codes = await _visitor_visible_case_codes(db, events)
        events = [
            event
            for event in events
            if event.kind == "reschedule" and event.case_code in visible_case_codes
        ]

    return [_to_out(event) for event in events[:limit]]


async def cleanup_old_feed_events(db: AsyncSession) -> None:
    cutoff = datetime.now(UTC) - timedelta(hours=FEED_RETENTION_HOURS)
    await db.execute(delete(ScreenFeedEvent).where(ScreenFeedEvent.created_at < cutoff))


async def create_feed_event(
    db: AsyncSession,
    *,
    audience: ScreenAudience = "visitor",
    kind: str,
    message: str,
    fingerprint: str,
    room_code: str | None = None,
    case_code: str | None = None,
    metadata: dict[str, Any] | None = None,
    broadcast_fn=None,
) -> ScreenFeedEventOut | None:
    full_fingerprint = f"{audience}:{fingerprint}"
    existing = await db.execute(select(ScreenFeedEvent.id).where(ScreenFeedEvent.fingerprint == full_fingerprint))
    if existing.scalar_one_or_none() is not None:
        return None

    event = ScreenFeedEvent(
        audience=audience,
        kind=kind,
        room_code=room_code,
        case_code=case_code,
        message=message,
        fingerprint=full_fingerprint,
        event_metadata=metadata,
        created_at=datetime.now(UTC),
    )
    db.add(event)
    await db.flush()

    out = _to_out(event)
    if broadcast_fn is not None:
        await broadcast_fn(screen_feed_event_msg(out))
    return out


async def create_phase_feed_event(
    db: AsyncSession,
    *,
    case: SurgicalCase,
    room_code: str,
    to_phase: CasePhase,
    broadcast_fn=None,
) -> ScreenFeedEventOut | None:
    kind = "complete" if to_phase == CasePhase.COMPLETE else "phase"
    label = visitor_case_label(_case_display_code(case))
    message = f"{label}: {PHASE_VISITOR_MESSAGE[to_phase]}"
    return await create_feed_event(
        db,
        kind=kind,
        message=message,
        fingerprint=f"phase:{case.case_code}:{to_phase.value}",
        room_code=room_code,
        case_code=case.case_code,
        metadata={"phase": to_phase.value},
        broadcast_fn=broadcast_fn,
    )


async def create_timing_feed_event(
    db: AsyncSession,
    *,
    case: SurgicalCase,
    room_code: str,
    alert_level: AlertLevel,
    elapsed_minutes: float,
    broadcast_fn=None,
) -> ScreenFeedEventOut | None:
    if alert_level == AlertLevel.NONE:
        return None
    label = visitor_case_label(_case_display_code(case))
    if alert_level == AlertLevel.CRITICAL:
        message = f"{label}: care team is continuing and the procedure is taking longer than planned."
    else:
        message = f"{label}: procedure is taking a little longer than planned."
    return await create_feed_event(
        db,
        kind="timing",
        message=message,
        fingerprint=f"timing:{case.case_code}:{alert_level.value}",
        room_code=room_code,
        case_code=case.case_code,
        metadata={"alert_level": alert_level.value, "elapsed_minutes": round(elapsed_minutes, 1)},
        broadcast_fn=broadcast_fn,
    )


async def create_schedule_shift_feed_events(
    db: AsyncSession,
    *,
    room_code: str,
    shifts: list[dict],
    broadcast_fn=None,
) -> None:
    case_codes = [shift.get("case_code") for shift in shifts if shift.get("case_code")]
    if not case_codes:
        return
    result = await db.execute(
        select(SurgicalCase).where(
            SurgicalCase.case_code.in_(case_codes),
            SurgicalCase.current_phase == CasePhase.IDLE,
        )
    )
    cases_by_code = {case.case_code: case for case in result.scalars().all()}

    for shift in shifts:
        case_code = shift.get("case_code")
        new_start = shift.get("new_start")
        if not case_code or not new_start:
            continue
        case = cases_by_code.get(case_code)
        if case is None:
            continue
        await create_feed_event(
            db,
            kind="reschedule",
            message=f"{visitor_case_label(_case_display_code(case))} is now expected around {_format_time(new_start)}.",
            fingerprint=f"shift:{case_code}:{new_start}",
            room_code=room_code,
            case_code=case_code,
            metadata={"old_start": shift.get("old_start"), "new_start": new_start},
            broadcast_fn=broadcast_fn,
        )


async def remove_reschedule_events_for_case(
    db: AsyncSession,
    *,
    case_code: str,
    room_code: str,
) -> None:
    """Delete plain reschedule feed events for a case in a specific room (used when case moves rooms)."""
    from sqlalchemy import and_

    await db.execute(
        delete(ScreenFeedEvent).where(
            and_(
                ScreenFeedEvent.case_code == case_code,
                ScreenFeedEvent.room_code == room_code,
                ScreenFeedEvent.kind == "reschedule",
            )
        )
    )


async def create_room_move_feed_event(
    db: AsyncSession,
    *,
    case: SurgicalCase,
    from_room: str,
    to_room: str,
    broadcast_fn=None,
) -> ScreenFeedEventOut | None:
    display_code = _case_display_code(case)
    label = visitor_case_label(display_code)
    message = f"{label} moved from {from_room} to {to_room}."
    return await create_feed_event(
        db,
        kind="reschedule",
        message=message,
        fingerprint=f"room_move:{case.case_code}:{from_room}:{to_room}",
        room_code=to_room,
        case_code=case.case_code,
        metadata={"from_room": from_room, "to_room": to_room, "display_case_code": display_code},
        broadcast_fn=broadcast_fn,
    )


async def create_schedule_loaded_feed_event(
    db: AsyncSession,
    *,
    cases_created: int,
    broadcast_fn=None,
) -> ScreenFeedEventOut | None:
    return await create_feed_event(
        db,
        kind="system",
        message="Today's schedule was updated.",
        fingerprint=f"schedule_loaded:{datetime.now(UTC).isoformat()}:{cases_created}",
        metadata={"cases_created": cases_created},
        broadcast_fn=broadcast_fn,
    )
