from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.orm import OperatingRoom


async def list_rooms(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(OperatingRoom).options(selectinload(OperatingRoom.active_case)).order_by(OperatingRoom.room_code)
    )
    rooms = result.scalars().all()
    return [
        {
            "id": r.id,
            "room_code": r.room_code,
            "status": r.status,
            "active_case_code": r.active_case.case_code if r.active_case else None,
        }
        for r in rooms
    ]
