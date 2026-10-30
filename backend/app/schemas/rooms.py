from uuid import UUID

from pydantic import BaseModel

from app.domain.enums import RoomStatus


class RoomOut(BaseModel):
    id: UUID
    room_code: str
    status: RoomStatus
    active_case_code: str | None = None

    model_config = {"from_attributes": True}
