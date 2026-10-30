"""add induction physicians

Revision ID: c9a7d3f12b44
Revises: b4e9a2c6f8d1
Create Date: 2026-05-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "c9a7d3f12b44"
down_revision: str | None = "b4e9a2c6f8d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "induction_physicians",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("first_name", sa.String(length=64), nullable=False),
        sa.Column("last_name", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_induction_physicians_active_name",
        "induction_physicians",
        ["is_active", "last_name", "first_name"],
    )


def downgrade() -> None:
    op.drop_index("ix_induction_physicians_active_name", table_name="induction_physicians")
    op.drop_table("induction_physicians")
