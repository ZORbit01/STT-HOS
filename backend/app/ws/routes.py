import asyncio
import base64
import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import FastAPI, WebSocket

from app.runtime import AppRuntime, get_room_audio_state, get_room_from_token
from app.services.auth_service import decode_token
from app.stt.engine import AudioPacket

logger = logging.getLogger(__name__)


def register_websocket_routes(app: FastAPI) -> None:
    @app.websocket("/ws/audio/{room_id}")
    async def audio_endpoint(websocket: WebSocket, room_id: str) -> None:
        await handle_audio_socket(websocket, room_id, _runtime(app))

    @app.websocket("/ws/dashboard")
    async def dashboard_endpoint(websocket: WebSocket) -> None:
        await handle_dashboard_socket(websocket, _runtime(app))


async def handle_audio_socket(websocket: WebSocket, room_id: str, runtime: AppRuntime) -> None:
    await websocket.accept()
    payload = await _authenticate_websocket(websocket)
    if payload is None:
        return

    if payload.get("type") != "device":
        await websocket.close(code=1008, reason="Device token required")
        return

    if not await _token_matches_room(payload, room_id):
        await websocket.close(code=1008, reason="Token room mismatch")
        return

    active_case_code, current_phase = await get_room_audio_state(room_id)
    if runtime.pipeline:
        runtime.pipeline.update_room_state(room_id, active_case_code, current_phase)

    logger.info("Pipeline synced: room=%s active_case=%s phase=%s", room_id, active_case_code, current_phase)

    await runtime.ws_manager.connect_audio(room_id, websocket, already_accepted=True)
    await websocket.send_json(
        {
            "type": "auth_ok",
            "room_id": room_id,
            "active_case_code": active_case_code,
            "current_phase": current_phase.value if active_case_code else "IDLE",
        }
    )
    logger.info("WS audio authenticated: room=%s", room_id)

    try:
        await _receive_audio_messages(websocket, room_id, runtime)
    except Exception as exc:
        logger.info("[WS] Audio connection closed room=%s reason=%s", room_id, exc)
    finally:
        runtime.ws_manager.disconnect_audio(room_id)


async def handle_dashboard_socket(websocket: WebSocket, runtime: AppRuntime) -> None:
    await websocket.accept()
    payload = await _authenticate_websocket(websocket)
    if payload is None:
        return

    if payload.get("type") not in ("screen", "nurse", "admin"):
        await websocket.close(code=1008, reason="Valid token required")
        return

    await runtime.ws_manager.connect_dashboard(websocket, already_accepted=True)
    await websocket.send_json({"type": "auth_ok"})
    logger.info("WS dashboard connected: type=%s", payload.get("type"))

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        runtime.ws_manager.disconnect_dashboard(websocket)


async def _authenticate_websocket(websocket: WebSocket) -> dict | None:
    try:
        auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
    except TimeoutError:
        await websocket.close(code=1008, reason="Auth timeout")
        return None

    if auth_msg.get("type") != "auth":
        await websocket.close(code=1008, reason="First message must be auth")
        return None

    try:
        return decode_token(auth_msg.get("token", ""))
    except Exception:
        await websocket.close(code=1008, reason="Invalid token")
        return None


async def _token_matches_room(payload: dict, room_code: str) -> bool:
    room_id = payload.get("room_id")
    if not room_id:
        return True
    try:
        room = await get_room_from_token(UUID(str(room_id)))
    except ValueError:
        return False
    return bool(room and room.room_code == room_code)


async def _receive_audio_messages(websocket: WebSocket, room_id: str, runtime: AppRuntime) -> None:
    while True:
        data = await websocket.receive_json()

        if data.get("type") == "heartbeat":
            await websocket.send_json({"type": "heartbeat_ack"})
            continue

        if data.get("type") == "set_wake_mode":
            enabled = bool(data.get("enabled", False))
            if runtime.pipeline:
                runtime.pipeline.set_wake_mode(room_id, enabled)
            await websocket.send_json({"type": "wake_mode_ack", "enabled": enabled})
            continue

        if data.get("type") == "command_start":
            if runtime.pipeline:
                runtime.pipeline.begin_command(room_id)
            continue

        if data.get("type") == "audio_packet":
            await _enqueue_audio_packet(data, room_id, runtime)


async def _enqueue_audio_packet(data: dict, room_id: str, runtime: AppRuntime) -> None:
    if runtime.pipeline is None:
        logger.warning("[WS] audio_packet dropped because pipeline is not ready")
        return

    try:
        raw_bytes = base64.b64decode(data["audio_b64"])
        logger.info(
            "[WS] audio_packet room=%s raw_bytes=%d sample_rate=%s",
            room_id,
            len(raw_bytes),
            data.get("sample_rate"),
        )
        await runtime.pipeline.enqueue(
            AudioPacket(
                room_id=room_id,
                timestamp=data.get("timestamp", datetime.now(UTC).isoformat()),
                sample_rate=data.get("sample_rate", 16000),
                channels=data.get("channels", 1),
                audio_bytes=raw_bytes,
            )
        )
    except Exception as exc:
        logger.exception("[WS] Failed to process audio_packet room=%s: %s", room_id, exc)


def _runtime(app: FastAPI) -> AppRuntime:
    return app.state.runtime
