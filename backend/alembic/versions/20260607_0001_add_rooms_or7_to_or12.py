"""add operating rooms OR7-OR12

Revision ID: 20260607_0001
Revises: 20260603_0002
Create Date: 2026-06-07 00:00:00.000000
"""

from collections.abc import Sequence

import bcrypt
from alembic import op
from sqlalchemy import text


revision: str = "20260607_0001"
down_revision: str | None = "20260603_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_ROOM_CODES = ["OR7", "OR8", "OR9", "OR10", "OR11", "OR12"]
DEVICE_PASSWORD = "device-secret-123"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    conn = op.get_bind()
    for code in NEW_ROOM_CODES:
        username = f"{code.lower()}_device"
        room_id = conn.execute(
            text(
                """
                INSERT INTO operating_rooms (id, room_code, mic_stream_id, status, device_username)
                VALUES (gen_random_uuid(), :room_code, :mic_stream_id, 'AVAILABLE', :device_username)
                RETURNING id
                """
            ),
            {
                "room_code": code,
                "mic_stream_id": f"mic-{code.lower()}",
                "device_username": username,
            },
        ).scalar_one()
        hashed_password = bcrypt.hashpw(DEVICE_PASSWORD.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            text(
                """
                INSERT INTO device_accounts (id, username, hashed_password, room_id, is_active)
                VALUES (gen_random_uuid(), :username, :hashed_password, :room_id, true)
                """
            ),
            {"username": username, "hashed_password": hashed_password, "room_id": room_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            """
            DELETE FROM device_accounts
            WHERE room_id IN (SELECT id FROM operating_rooms WHERE room_code = ANY(:codes))
            """
        ),
        {"codes": NEW_ROOM_CODES},
    )
    conn.execute(
        text("DELETE FROM operating_rooms WHERE room_code = ANY(:codes)"),
        {"codes": NEW_ROOM_CODES},
    )
