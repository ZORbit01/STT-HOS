"""add induction_physician_id to surgical_cases

Revision ID: 20260530_0002
Revises: 20260530_0001
Create Date: 2026-05-30 00:01:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '20260530_0002'
down_revision: Union[str, None] = '20260530_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'surgical_cases',
        sa.Column(
            'induction_physician_id',
            sa.UUID(as_uuid=True),
            sa.ForeignKey('induction_physicians.id'),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('surgical_cases', 'induction_physician_id')
