"""add_screen_feed_events

Revision ID: b4e9a2c6f8d1
Revises: ac7f2d8e9b10
Create Date: 2026-05-17 00:00:00.000001

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "b4e9a2c6f8d1"
down_revision: Union[str, Sequence[str], None] = "ac7f2d8e9b10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "screen_feed_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("audience", sa.String(length=24), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("room_code", sa.String(length=16), nullable=True),
        sa.Column("case_code", sa.String(length=16), nullable=True),
        sa.Column("message", sa.String(length=512), nullable=False),
        sa.Column("fingerprint", sa.String(length=256), nullable=False),
        sa.Column("event_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fingerprint"),
    )
    op.create_index("ix_screen_feed_events_audience_created", "screen_feed_events", ["audience", "created_at"])
    op.create_index("ix_screen_feed_events_case_code", "screen_feed_events", ["case_code"])


def downgrade() -> None:
    op.drop_index("ix_screen_feed_events_case_code", table_name="screen_feed_events")
    op.drop_index("ix_screen_feed_events_audience_created", table_name="screen_feed_events")
    op.drop_table("screen_feed_events")
