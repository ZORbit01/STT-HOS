"""add_patients

Revision ID: f2b9c0d4a1e7
Revises: eb9eb0cabee2
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f2b9c0d4a1e7"
down_revision: Union[str, Sequence[str], None] = "eb9eb0cabee2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "patients",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("first_name", sa.String(length=64), nullable=False),
        sa.Column("last_name", sa.String(length=64), nullable=False),
        sa.Column("mrn", sa.String(length=64), nullable=True),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("sex", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mrn"),
    )
    op.add_column(
        "surgical_cases",
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_surgical_cases_patient_id_patients",
        "surgical_cases",
        "patients",
        ["patient_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_surgical_cases_patient_id_patients", "surgical_cases", type_="foreignkey")
    op.drop_column("surgical_cases", "patient_id")
    op.drop_table("patients")
