import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import (
    auth,
    cases,
    client_sessions,
    companies,
    doctors,
    events,
    exports,
    hospital_rooms,
    imports,
    induction_physicians,
    nurses,
    patients,
    rooms,
    screen,
    surgeries,
)
from app.runtime import AppRuntime
from app.ws.routes import register_websocket_routes


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    runtime = AppRuntime()
    app.state.runtime = runtime
    await runtime.start()
    try:
        yield
    finally:
        await runtime.stop()


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(title="OR Tracking System", lifespan=lifespan)
    include_api_routes(app)
    register_websocket_routes(app)
    register_health_route(app)
    return app


def include_api_routes(app: FastAPI) -> None:
    app.include_router(auth.router)
    app.include_router(cases.router)
    app.include_router(rooms.router)
    app.include_router(events.router)
    app.include_router(exports.router)
    app.include_router(hospital_rooms.router)
    app.include_router(imports.router)
    app.include_router(induction_physicians.router)
    app.include_router(doctors.router)
    app.include_router(companies.router)
    app.include_router(nurses.router)
    app.include_router(client_sessions.router)
    app.include_router(patients.router)
    app.include_router(screen.router)
    app.include_router(surgeries.router)


def register_health_route(app: FastAPI) -> None:
    @app.get("/health")
    async def health():
        runtime: AppRuntime | None = getattr(app.state, "runtime", None)
        ws_manager = runtime.ws_manager if runtime else None
        return {
            "status": "ok",
            "connected_rooms": ws_manager.connected_rooms if ws_manager else [],
            "dashboard_clients": ws_manager.dashboard_count if ws_manager else 0,
        }


app = create_app()
