"""seed operating rooms OR1-OR6 on fresh databases

OR1-OR6 were never inserted by any migration (they only existed in the
original hand-seeded database), so a fresh `alembic upgrade head` ended up
with OR7-OR12 only. This migration seeds OR1-OR6 idempotently: rooms and
device accounts that already exist are left untouched.

Revision ID: 20260718_0001
Revises: 20260629_0001
Create Date: 2026-07-18 00:00:00.000000
"""

from collections.abc import Sequence

import bcrypt
from alembic import op
from sqlalchemy import text


revision: str = "20260718_0001"
down_revision: str | None = "20260629_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROOM_CODES = ["OR1", "OR2", "OR3", "OR4", "OR5", "OR6"]
DEVICE_PASSWORD = "device-secret-123"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    conn = op.get_bind()
    for code in ROOM_CODES:
        username = f"{code.lower()}_device"
        room_id = conn.execute(
            text("SELECT id FROM operating_rooms WHERE room_code = :room_code"),
            {"room_code": code},
        ).scalar_one_or_none()
        if room_id is None:
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
        account_exists = conn.execute(
            text("SELECT 1 FROM device_accounts WHERE username = :username"),
            {"username": username},
        ).scalar_one_or_none()
        if account_exists is None:
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
    # Intentionally a no-op: on databases that predate this migration OR1-OR6
    # already existed with live case history, so deleting them on downgrade
    # would destroy production data.
    pass
