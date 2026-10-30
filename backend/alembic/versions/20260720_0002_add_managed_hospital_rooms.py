"""add managed hospital rooms

Revision ID: 20260720_0002
Revises: 20260720_0001
Create Date: 2026-07-20 00:00:01.000000
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260720_0002"
down_revision: str | Sequence[str] | None = "20260720_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hospital_rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    bind = op.get_bind()
    names = bind.execute(
        sa.text(
            "SELECT DISTINCT btrim(patient_room) FROM surgical_cases "
            "WHERE patient_room IS NOT NULL AND btrim(patient_room) <> '' ORDER BY 1"
        )
    ).scalars()
    hospital_rooms = sa.table(
        "hospital_rooms",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String(length=64)),
        sa.column("is_active", sa.Boolean()),
    )
    rows = [{"id": uuid.uuid4(), "name": name, "is_active": True} for name in names]
    if rows:
        op.bulk_insert(hospital_rooms, rows)


def downgrade() -> None:
    op.drop_table("hospital_rooms")
