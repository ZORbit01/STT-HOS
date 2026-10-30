from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orm import InductionPhysicianAssignment, NurseShift, OperatingRoom
from app.services.client_session_service import ClientRoomSession, get_room_session, prune_expired_sessions


def _uuid(value: str | UUID | None) -> UUID | None:
    if value is None:
        return None
    return value if isinstance(value, UUID) else UUID(str(value))


def close_expired_room_sessions() -> None:
    prune_expired_sessions()


async def get_open_nurse_shift(
    db: AsyncSession,
    *,
    nurse_id: str | UUID,
    room: OperatingRoom,
) -> NurseShift | None:
    result = await db.execute(
        select(NurseShift)
        .where(
            and_(
                NurseShift.nurse_id == _uuid(nurse_id),
                NurseShift.room_id == room.id,
                NurseShift.ended_at.is_(None),
            )
        )
        .order_by(desc(NurseShift.started_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_open_room_shift(
    db: AsyncSession,
    *,
    room: OperatingRoom,
    nurse_id: str | UUID | None = None,
) -> NurseShift | None:
    filters = [
        NurseShift.room_id == room.id,
        NurseShift.ended_at.is_(None),
    ]
    if nurse_id is not None:
        filters.append(NurseShift.nurse_id == _uuid(nurse_id))
    result = await db.execute(
        select(NurseShift)
        .where(and_(*filters))
        .order_by(desc(NurseShift.last_seen_at), desc(NurseShift.started_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def room_actor_metadata(
    db: AsyncSession,
    room: OperatingRoom,
    *,
    nurse_id: str | UUID | None = None,
) -> dict[str, UUID | None]:
    session = get_room_session(room.room_code)
    metadata = session_metadata(session)
    if metadata["nurse_shift_id"] is not None:
        return metadata

    shift = await get_open_room_shift(db, room=room, nurse_id=nurse_id)
    if shift is None:
        return metadata | {"triggered_by_nurse_id": _uuid(nurse_id)}

    return {
        "triggered_by_nurse_id": _uuid(nurse_id) or shift.nurse_id,
        "nurse_shift_id": shift.id,
        "induction_physician_id": shift.induction_physician_id,
    }


async def upsert_nurse_shift(
    db: AsyncSession,
    *,
    session: ClientRoomSession,
    room: OperatingRoom,
) -> NurseShift:
    now = datetime.now(UTC)
    physician_id = UUID(session.induction_physician_id)
    result = await db.execute(select(NurseShift).where(NurseShift.session_id == session.session_id))
    shift = result.scalar_one_or_none()
    if shift is None:
        # No row for this session_id — check for an open shift for this nurse+room
        # so that a tab close/reopen (new session_id) reuses the existing shift.
        result2 = await db.execute(
            select(NurseShift)
            .where(
                and_(
                    NurseShift.nurse_id == UUID(session.nurse_id),
                    NurseShift.room_id == room.id,
                    NurseShift.ended_at.is_(None),
                )
            )
            .order_by(desc(NurseShift.started_at))
            .limit(1)
        )
        shift = result2.scalar_one_or_none()
    if shift is None:
        shift = NurseShift(
            session_id=session.session_id,
            room_id=room.id,
            nurse_id=UUID(session.nurse_id),
            induction_physician_id=physician_id,
            started_at=now,
            last_seen_at=now,
        )
        db.add(shift)
    else:
        shift.session_id = session.session_id
        shift.room_id = room.id
        shift.nurse_id = UUID(session.nurse_id)
        shift.induction_physician_id = physician_id
        shift.last_seen_at = now
        shift.ended_at = None
        shift.end_reason = None
    await db.flush()
    await record_induction_physician_assignment(db, shift=shift, physician_id=physician_id, assigned_at=now)
    return shift


async def record_induction_physician_assignment(
    db: AsyncSession,
    *,
    shift: NurseShift,
    physician_id: UUID,
    assigned_at: datetime | None = None,
) -> InductionPhysicianAssignment:
    assigned_at = assigned_at or datetime.now(UTC)
    result = await db.execute(
        select(InductionPhysicianAssignment)
        .where(
            and_(
                InductionPhysicianAssignment.nurse_shift_id == shift.id,
                InductionPhysicianAssignment.ended_at.is_(None),
            )
        )
        .order_by(desc(InductionPhysicianAssignment.assigned_at))
        .limit(1)
    )
    current = result.scalar_one_or_none()
    if current and current.induction_physician_id == physician_id:
        return current
    if current:
        current.ended_at = assigned_at

    assignment = InductionPhysicianAssignment(
        nurse_shift_id=shift.id,
        room_id=shift.room_id,
        nurse_id=shift.nurse_id,
        induction_physician_id=physician_id,
        assigned_at=assigned_at,
        source="SESSION",
    )
    db.add(assignment)
    await db.flush()
    return assignment


async def end_nurse_shift(
    db: AsyncSession,
    *,
    session_id: str,
    ended_at: datetime | None = None,
    end_reason: str = "RELEASED",
) -> NurseShift | None:
    result = await db.execute(select(NurseShift).where(NurseShift.session_id == session_id))
    shift = result.scalar_one_or_none()
    if shift is None:
        return None
    if shift.ended_at is None:
        shift.ended_at = ended_at or datetime.now(UTC)
        shift.end_reason = end_reason
    shift.last_seen_at = ended_at or datetime.now(UTC)
    return shift


def session_metadata(session: ClientRoomSession | None) -> dict[str, UUID | None]:
    if session is None:
        return {
            "triggered_by_nurse_id": None,
            "nurse_shift_id": None,
            "induction_physician_id": None,
        }
    return {
        "triggered_by_nurse_id": _uuid(session.nurse_id),
        "nurse_shift_id": _uuid(session.nurse_shift_id),
        "induction_physician_id": _uuid(session.induction_physician_id),
    }
