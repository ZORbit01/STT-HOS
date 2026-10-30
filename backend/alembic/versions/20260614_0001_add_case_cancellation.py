"""add case cancellation workflow

Revision ID: 20260614_0001
Revises: 20260607_0002
Create Date: 2026-06-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260614_0001"
down_revision: str | None = "20260607_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE casephase ADD VALUE IF NOT EXISTS 'CANCELLED'")

    op.add_column(
        "surgical_cases",
        sa.Column("cancellation_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("surgical_cases", "cancellation_requested", server_default=None)
    op.add_column("surgical_cases", sa.Column("cancellation_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "surgical_cases",
        sa.Column("cancellation_requested_by_nurse_id", sa.UUID(as_uuid=True), sa.ForeignKey("nurse_accounts.id"), nullable=True),
    )
    op.add_column("surgical_cases", sa.Column("cancellation_reason", sa.String(length=512), nullable=True))
    op.add_column("surgical_cases", sa.Column("cancellation_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "surgical_cases",
        sa.Column("cancellation_confirmed_by_admin_id", sa.UUID(as_uuid=True), sa.ForeignKey("admin_accounts.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("surgical_cases", "cancellation_confirmed_by_admin_id")
    op.drop_column("surgical_cases", "cancellation_confirmed_at")
    op.drop_column("surgical_cases", "cancellation_reason")
    op.drop_column("surgical_cases", "cancellation_requested_by_nurse_id")
    op.drop_column("surgical_cases", "cancellation_requested_at")
    op.drop_column("surgical_cases", "cancellation_requested")
    # PostgreSQL enum values cannot be removed safely without rebuilding the type.
