import asyncio
import json
import logging
from contextlib import suppress

from fastapi import WebSocket

from app.ws.messages import WSMessage

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Manages two groups of WebSocket connections:

    1. Audio connections — one per OR room (OR laptop → server)
       Keyed by room_id. New connection for same room replaces the old one.

    2. Dashboard connections — unbounded set (server → all dashboards)
       Any number of browser tabs can connect. Dead connections are pruned
       on next broadcast.
    """

    def __init__(self) -> None:
        # room_id → active WebSocket from the OR laptop
        self._audio_connections: dict[str, WebSocket] = {}
        # all active dashboard WebSocket connections
        self._dashboard_connections: set[WebSocket] = set()

    # ------------------------------------------------------------------
    # Audio connections (OR laptop → server)
    # ------------------------------------------------------------------

    async def connect_audio(self, room_id: str, ws: WebSocket, already_accepted: bool = False) -> None:
        if not already_accepted:
            await ws.accept()
        old = self._audio_connections.get(room_id)
        if old is not None:
            # OR laptop reconnected — close the stale connection cleanly
            with suppress(Exception):
                await old.close()
        self._audio_connections[room_id] = ws
        logger.info("Audio WebSocket connected: room=%s", room_id)

    def disconnect_audio(self, room_id: str) -> None:
        self._audio_connections.pop(room_id, None)
        logger.info("Audio WebSocket disconnected: room=%s", room_id)

    async def send_to_room(self, room_id: str, message: WSMessage) -> None:
        """Send a command response back to one OR laptop."""
        ws = self._audio_connections.get(room_id)
        if ws is None:
            return
        try:
            await ws.send_text(json.dumps(message.to_dict()))
        except Exception:
            logger.warning("Failed to send to room=%s — removing connection", room_id)
            self.disconnect_audio(room_id)

    # ------------------------------------------------------------------
    # Dashboard connections (server → all dashboards)
    # ------------------------------------------------------------------

    async def connect_dashboard(self, ws: WebSocket, already_accepted: bool = False) -> None:
        if not already_accepted:
            await ws.accept()
        self._dashboard_connections.add(ws)
        logger.info("Dashboard WebSocket connected — total=%d", len(self._dashboard_connections))

    def disconnect_dashboard(self, ws: WebSocket) -> None:
        self._dashboard_connections.discard(ws)
        logger.info("Dashboard WebSocket disconnected — total=%d", len(self._dashboard_connections))

    async def broadcast(self, message: WSMessage) -> None:
        """Broadcast an event to all connected dashboard clients."""
        if not self._dashboard_connections:
            return

        payload = json.dumps(message.to_dict())

        async def send(ws: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(ws.send_text(payload), timeout=2.0)
                return None
            except Exception:
                return ws

        results = await asyncio.gather(
            *(send(ws) for ws in list(self._dashboard_connections)),
            return_exceptions=False,
        )
        for ws in (result for result in results if result is not None):
            logger.warning("Pruning dead dashboard connection")
            self._dashboard_connections.discard(ws)

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    async def broadcast_to_all_rooms(self, message: WSMessage) -> None:
        """Send an event to every connected OR laptop (audio) socket."""
        payload = json.dumps(message.to_dict())
        dead: list[str] = []
        for room_id, ws in list(self._audio_connections.items()):
            try:
                await asyncio.wait_for(ws.send_text(payload), timeout=2.0)
            except Exception:
                dead.append(room_id)
        for room_id in dead:
            logger.warning("Pruning dead audio connection: room=%s", room_id)
            self.disconnect_audio(room_id)

    @property
    def connected_rooms(self) -> list[str]:
        return list(self._audio_connections.keys())

    @property
    def dashboard_count(self) -> int:
        return len(self._dashboard_connections)
