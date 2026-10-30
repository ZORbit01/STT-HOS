from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.screen import ScreenFeedEventOut, ScreenStateOut
from app.services.screen_feed_service import list_feed_events
from app.services.screen_state_service import get_screen_state

router = APIRouter(prefix="/api/v1/screen", tags=["screen"])


@router.get("/state", response_model=ScreenStateOut)
async def screen_state(
    audience: Literal["professional", "visitor"] = Query("visitor"),
    db: AsyncSession = Depends(get_db),
) -> ScreenStateOut:
    return await get_screen_state(db, audience)


@router.get("/feed", response_model=list[ScreenFeedEventOut])
async def screen_feed(
    audience: Literal["professional", "visitor"] = Query("visitor"),
    limit: int = Query(60, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[ScreenFeedEventOut]:
    return await list_feed_events(db, audience, limit)
