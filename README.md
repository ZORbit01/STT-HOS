# OR Tracking & Analytics System
## Project Package — Agent Ready

---

## What Is This

A real-time, voice-driven surgical workflow tracking system for a hospital
with 6 operating rooms. Nurses speak short voice commands ("A1 start") into
a mic on a laptop in each OR. The system transcribes, validates, logs, and
broadcasts every phase transition live to a wall-mounted dashboard.

The deeper goal is a clean structured event log for process mining, analytics,
and future AI/ML research on surgical workflow efficiency.

---

## Folder Structure

```
or-tracking-system/
  README.md                        <- You are here
  skill/
    SKILL.md                       <- Master skill file — load this into Claude
    references/
      architecture.md              <- System layers, data flow, tech stack
      database.md                  <- All models, enums, fields
      state_server.md              <- FastAPI routes, state machine, WS contracts
      stt_pipeline.md              <- Vosk pipeline, intent parser, confidence gate
      client_app.md                <- OR laptop client, auth, voice UI, sounds
      dashboard.md                 <- React routes, real-time update architecture
      designer.md                  <- Design system, Tailwind rules, color palette
      clean_code.md                <- Architecture pattern, naming, security, testing
  plan/
    01_system_overview_architecture.docx
    02_database_schema.docx
    03_state_server.docx
    04_stt_server.docx
    05_client_application.docx
    06_dashboard_design.docx
```

---

## How to Use With Claude (Agent Mode)

### Step 1 — Install the skill
Upload `skill/SKILL.md` and the entire `skill/references/` folder to your
Claude skills directory. Claude will auto-detect the project context at the
start of any conversation where the project is mentioned.

### Step 2 — Start building
Claude will read SKILL.md automatically. When you ask it to build a specific
module, it will load only the relevant reference file from skill/references/.

Example prompts to get started:
- "Build the FastAPI state machine module following the project skill"
- "Create the SurgicalCase SQLAlchemy model"
- "Build the React RoomRow component for the dashboard"
- "Write the STT intent parser"
- "Build the OR client login screen"

### Step 3 — Reference the plan docs
The 6 .docx files in plan/ are the full detailed specification.
Read them when you need deep detail on a specific area.

---

## Core Rules (never break these)

1. State machine: IDLE -> IN -> INCISION -> CLOSURE -> OUT -> CLEANING -> IDLE only
2. PhaseEvent table is append-only — never UPDATE or DELETE
3. Room identity comes from the mic, never from speech
4. No patient names anywhere — case codes only
5. Voice command format: [case_code] [phase_keyword] — always 2 words
6. Confidence threshold: >= 0.75 accept, 0.60-0.74 review, < 0.60 reject
7. Device auth (permanent) and nurse auth (per shift) are always both required
8. Dynamic rescheduling is automatic — mic room overrides scheduled room
9. STT is accessed only via the STTEngine Protocol interface — use the configured engine from startup wiring

---

## Tech Stack at a Glance

| Layer        | Technology                              |
|--------------|-----------------------------------------|
| Backend      | Python 3.11, FastAPI, SQLAlchemy 2.0    |
| Database     | PostgreSQL 15, Alembic                  |
| STT          | Vosk local speech recognition           |
| VAD          | Silero VAD (runs on OR client)          |
| Tasks        | Celery + Redis                          |
| Frontend     | React 18, TypeScript, Tailwind CSS      |
| State        | Zustand                                 |
| Auth         | bcrypt, JWT, keyring (client)           |
| Analytics    | pm4py (process mining)                  |
| OR Client    | React, Web Audio API, websockets |

---

## Module Breakdown and Dependencies

To enable parallel development, the project is divided into independent modules with clear interfaces. Each module has defined inputs/outputs and can be developed/tested in isolation.

### Core Modules

| Module | Responsibility | Tech | Dependencies | Outputs |
|--------|----------------|------|--------------|---------|
| **Database Schema** | Models, enums, migrations | PostgreSQL, SQLAlchemy, Alembic | None | DB tables, ORM classes |
| **Domain Logic** | State machine, validation, entities | Python dataclasses | Database Schema | Validation functions, enums |
| **Authentication** | Device/nurse auth, JWT | FastAPI, bcrypt | None | Auth endpoints, tokens |
| **STT Pipeline** | Audio processing, Vosk, intent parsing | Python, asyncio | Domain Logic (for validation) | Transcript results, confidence scores |
| **Backend API** | REST/WebSocket routes, DB ops | FastAPI, SQLAlchemy | All above | API endpoints, WebSocket handlers |
| **Alert Engine** | Background tasks, notifications | Celery, Redis | Backend API | Alerts, scheduled tasks |
| **OR Client** | Audio capture, UI, streaming | React, Web Audio API | Backend API (WebSockets) | Audio packets, user interactions |
| **Dashboard** | Real-time display, controls | React, Zustand | Backend API (WebSockets) | UI updates, manual transitions |
| **Analytics** | Historical data, process mining | pm4py, React | Backend API | Charts, reports |

### Dependency Graph
```
Database Schema
├── Domain Logic
│   ├── STT Pipeline
│   ├── Backend API
│   │   ├── Alert Engine
│   │   ├── OR Client
│   │   ├── Dashboard
│   │   └── Analytics
│   └── Authentication (integrated into Backend API)
```

### Parallel Work Streams
- **Stream 1 (Data Layer)**: Database Schema + Domain Logic (foundation, no external deps)
- **Stream 2 (Backend Core)**: Authentication + Backend API (depends on Data Layer)
- **Stream 3 (Processing)**: STT Pipeline + Alert Engine (depends on Backend Core)
- **Stream 4 (Frontends)**: OR Client + Dashboard + Analytics (depends on Backend Core, can mock APIs)

### Interfaces for Parallel Dev
- **Mic Client Interface**: Standardized WebSocket protocol (defined in state_server.md) — allows OR Client to be swapped/tested independently.
- **API Contracts**: REST/WebSocket schemas in state_server.md — frontends can use mock servers.
- **Database**: Use SQLite for local dev, switch to PostgreSQL for integration.

---

## Build Order (recommended)

1. Database models and enums (02_database_schema.docx)
2. Domain layer — state machine, enums, exceptions (clean_code.md)
3. FastAPI app skeleton — routes, auth, DB session
4. STT pipeline — Vosk engine, intent parser, confidence gate
5. WebSocket manager — audio receiver + dashboard broadcaster
6. Alert engine — Celery tasks
7. Excel importer
8. React dashboard — /display wall screen first, then /control
9. OR client app — auth, voice mode, control mode
10. Analytics dashboard
