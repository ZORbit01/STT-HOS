import asyncio
import logging
from uuid import UUID

from sqlalchemy import select

from app.db import AsyncSessionLocal
from app.domain.enums import CasePhase, TransitionOutcome
from app.models.orm import OperatingRoom, SurgicalCase
from app.services.alert_service import run_alert_loop
from app.services.dispatch_service import handle_dispatch, set_broadcast
from app.services.voice_case_code_service import fetch_stt_voice_case_codes
from app.stt.pipeline import STTPipeline
from app.stt.pipeline_types import DispatchPayload
from app.stt.vosk_engine import VoskSTTEngine
from app.ws.manager import WebSocketManager
from app.ws.messages import (
    WSMessage,
    cancellation_requested_msg,
    phase_transition_msg,
    review_needed_msg,
    room_reassigned_msg,
)

logger = logging.getLogger(__name__)

ROOM_IDS = ["OR1", "OR2", "OR3", "OR4", "OR5", "OR6", "OR7", "OR8", "OR9", "OR10", "OR11", "OR12"]


class AppRuntime:
    """Owns long-lived process services created during FastAPI lifespan."""

    def __init__(self) -> None:
        self.stt_engine: VoskSTTEngine | None = None
        self.pipeline: STTPipeline | None = None
        self.ws_manager = WebSocketManager()
        self.alert_task: asyncio.Task | None = None
        self._room_code_cache: dict[UUID, str] = {}

    async def start(self) -> None:
        logger.info("Starting OR Tracking server...")
        case_codes = await self._fetch_stt_voice_codes()
        logger.info("Loaded %d voice case codes for STT grammar", len(case_codes))
        await self._warm_room_code_cache()

        self.stt_engine = VoskSTTEngine(case_codes=case_codes)
        set_broadcast(self.ws_manager.broadcast)

        self.pipeline = STTPipeline(
            stt_engine=self.stt_engine,
            dispatch=self.dispatch_voice_command,
            room_ids=ROOM_IDS,
            notify=self.notify_audio_client,
        )
        await self.pipeline.start()

        self.alert_task = asyncio.create_task(
            run_alert_loop(AsyncSessionLocal, self.ws_manager.broadcast),
            name="alert-loop",
        )
        logger.info("Alert loop started")

    async def stop(self) -> None:
        logger.info("Shutting down...")
        if self.alert_task:
            self.alert_task.cancel()
        if self.pipeline:
            await self.pipeline.stop()
        if self.stt_engine:
            self.stt_engine.shutdown()
        logger.info("Shutdown complete")

    async def dispatch_voice_command(self, payload: DispatchPayload) -> None:
        async with AsyncSessionLocal() as db:
            event = await handle_dispatch(payload, db)

        if event is None:
            await self.ws_manager.send_to_room(
                payload.room_id,
                WSMessage(
                    event="command_response",
                    payload={
                        "outcome": "rejected",
                        "confidence": 0.0,
                        "raw_transcript": payload.raw_transcript,
                        "case_code": payload.case_code,
                    },
                ),
            )
            return

        if payload.to_phase == CasePhase.CANCELLED and payload.outcome == TransitionOutcome.ACCEPTED:
            await self.ws_manager.broadcast(
                cancellation_requested_msg(
                    case_code=payload.case_code,
                    room_code=payload.room_id,
                    requested_by_nurse_name=None,
                    requested_at=event.actual_time.isoformat(),
                )
            )
            await self._send_command_response(payload)
            return

        if payload.outcome == TransitionOutcome.ACCEPTED:
            self._sync_pipeline_room_state(payload)
            await self.ws_manager.broadcast(
                phase_transition_msg(
                    case_code=payload.case_code,
                    room_code=payload.room_id,
                    from_phase=payload.from_phase.value,
                    to_phase=payload.to_phase.value,
                    source=payload.source.value,
                    confidence=payload.confidence,
                    raw_transcript=payload.raw_transcript,
                    delay_minutes=event.delay_minutes,
                )
            )
            if event.room_reassigned:
                await self._broadcast_room_reassignment(payload.case_code, event.scheduled_room_id, payload.room_id)
            if payload.to_phase == CasePhase.IN:
                # The case just started — it must drop out of the "start" voice grammar.
                await self.refresh_stt_grammar()
        elif payload.outcome == TransitionOutcome.REVIEW:
            await self.ws_manager.broadcast(
                review_needed_msg(
                    room_code=payload.room_id,
                    raw_transcript=payload.raw_transcript or "",
                    parsed_case_code=payload.case_code,
                    parsed_phase=payload.to_phase.value,
                    confidence=payload.confidence,
                    review_id=str(event.id),
                )
            )

        await self._send_command_response(payload)

    async def notify_audio_client(self, room_id: str, outcome: str, transcript: str) -> None:
        if outcome == "wake_activated":
            await self.ws_manager.send_to_room(room_id, WSMessage(event="wake_activated", payload={}))
            return

        await self.ws_manager.send_to_room(
            room_id,
            WSMessage(
                event="command_response",
                payload={
                    "outcome": outcome,
                    "confidence": 0.0,
                    "raw_transcript": transcript,
                    "case_code": None,
                    "to_phase": None,
                },
            ),
        )

    async def refresh_stt_grammar(self) -> None:
        if self.stt_engine:
            self.stt_engine.refresh_prompt(await self._fetch_stt_voice_codes())

    async def _fetch_stt_voice_codes(self) -> list[str]:
        async with AsyncSessionLocal() as db:
            return await fetch_stt_voice_case_codes(db)

    def _sync_pipeline_room_state(self, payload: DispatchPayload) -> None:
        if self.pipeline is None:
            return
        next_active = payload.case_code if payload.to_phase not in (CasePhase.IDLE, CasePhase.COMPLETE) else None
        self.pipeline.update_room_state(
            room_id=payload.room_id,
            active_case_code=next_active,
            current_phase=payload.to_phase,
        )

    async def _broadcast_room_reassignment(
        self,
        case_code: str,
        scheduled_room_id: UUID,
        current_room_code: str,
    ) -> None:
        from_room_code = self._room_code_cache.get(scheduled_room_id) or await get_room_code_by_id(scheduled_room_id)
        await self.ws_manager.broadcast(
            room_reassigned_msg(
                case_code=case_code,
                from_room=from_room_code or str(scheduled_room_id),
                to_room=current_room_code,
            )
        )

    async def _warm_room_code_cache(self) -> None:
        async with AsyncSessionLocal() as db:
            rows = await db.execute(select(OperatingRoom.id, OperatingRoom.room_code))
            self._room_code_cache = {row.id: row.room_code for row in rows}
        logger.info("Room code cache warmed: %d rooms", len(self._room_code_cache))

    async def _send_command_response(self, payload: DispatchPayload) -> None:
        status_map = {
            TransitionOutcome.ACCEPTED: "accepted",
            TransitionOutcome.REVIEW: "review_needed",
            TransitionOutcome.REJECTED: "rejected",
            TransitionOutcome.DUPLICATE: "rejected",
        }
        await self.ws_manager.send_to_room(
            payload.room_id,
            WSMessage(
                event="command_response",
                payload={
                    "outcome": status_map.get(payload.outcome, "rejected"),
                    "confidence": round(payload.confidence, 3),
                    "raw_transcript": payload.raw_transcript,
                    "case_code": payload.case_code,
                    "to_phase": payload.to_phase.value,
                },
            ),
        )


async def get_room_code_by_id(room_id) -> str | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(OperatingRoom.room_code).where(OperatingRoom.id == room_id))
        return result.scalar_one_or_none()


async def get_room_from_token(room_uuid: str) -> OperatingRoom | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(OperatingRoom).where(OperatingRoom.id == room_uuid))
        return result.scalar_one_or_none()


async def get_room_audio_state(room_code: str) -> tuple[str | None, CasePhase]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SurgicalCase.case_code, SurgicalCase.current_phase)
            .join(OperatingRoom, OperatingRoom.active_case_id == SurgicalCase.id)
            .where(OperatingRoom.room_code == room_code)
        )
        row = result.one_or_none()
        if row is None:
            return None, CasePhase.IDLE
        return row.case_code, row.current_phase
