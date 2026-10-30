"""add case companies, isolation, notes, and patient room

Revision ID: 20260720_0001
Revises: 20260718_0001
Create Date: 2026-07-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260720_0001"
down_revision: str | Sequence[str] | None = "20260718_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "case_companies",
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["surgical_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("case_id", "company_id"),
    )
    op.add_column(
        "surgical_cases",
        sa.Column("isolation_required", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("surgical_cases", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("surgical_cases", sa.Column("patient_room", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("surgical_cases", "patient_room")
    op.drop_column("surgical_cases", "notes")
    op.drop_column("surgical_cases", "isolation_required")
    op.drop_table("case_companies")
    op.drop_table("companies")
