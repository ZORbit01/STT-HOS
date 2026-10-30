"""add managed surgeries

Revision ID: 20260720_0003
Revises: 20260720_0002
Create Date: 2026-07-20 00:00:02.000000
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260720_0003"
down_revision: str | Sequence[str] | None = "20260720_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_SURGERIES = [
    "Appendectomy",
    "Arthroscopy – Knee",
    "Arthroscopy – Shoulder",
    "Bowel Resection",
    "Caesarean Section",
    "Cardiac Catheterization",
    "Carotid Endarterectomy",
    "Cholecystectomy – Laparoscopic",
    "Cholecystectomy – Open",
    "Colectomy",
    "Colostomy",
    "Coronary Artery Bypass Graft (CABG)",
    "Craniotomy",
    "Cystectomy",
    "Discectomy",
    "Endoscopic Retrograde Cholangiopancreatography (ERCP)",
    "Exploratory Laparotomy",
    "Femoral-Popliteal Bypass",
    "Gastrectomy",
    "Haemorrhoidectomy",
    "Hernia Repair – Inguinal",
    "Hernia Repair – Ventral",
    "Hip Arthroplasty – Partial",
    "Hip Arthroplasty – Total",
    "Hip Replacement – Revision",
    "Hysterectomy – Abdominal",
    "Hysterectomy – Laparoscopic",
    "Hysterectomy – Vaginal",
    "Ileostomy",
    "Knee Arthroplasty – Total",
    "Knee Arthroplasty – Unicompartmental",
    "Knee Replacement – Revision",
    "Laminectomy",
    "Laparoscopic Fundoplication",
    "Laparoscopic Myomectomy",
    "Liver Resection",
    "Mastectomy – Modified Radical",
    "Mastectomy – Simple",
    "Meniscectomy",
    "Mitral Valve Repair",
    "Mitral Valve Replacement",
    "Nephrectomy – Laparoscopic",
    "Nephrectomy – Open",
    "Orchidectomy",
    "Orchiectomy",
    "Osteotomy",
    "Pancreatectomy",
    "Parathyroidectomy",
    "Percutaneous Coronary Intervention (PCI)",
    "Pericardiocentesis",
    "Prostatectomy – Laparoscopic",
    "Prostatectomy – Radical Open",
    "Prostatectomy – Robotic",
    "Rotator Cuff Repair",
    "Salpingo-oophorectomy",
    "Sentinel Lymph Node Biopsy",
    "Sigmoid Colectomy",
    "Sleeve Gastrectomy",
    "Spinal Fusion",
    "Splenectomy",
    "Tendon Repair",
    "Thyroidectomy – Partial",
    "Thyroidectomy – Total",
    "TRAM Flap Reconstruction",
    "Transurethral Resection of Bladder Tumour (TURBT)",
    "Transurethral Resection of the Prostate (TURP)",
    "Tympanoplasty",
    "Ureterolithotomy",
    "Varicocelectomy",
    "Vasectomy",
    "Whipple Procedure",
    "Wound Debridement",
    "Wrist Arthroplasty",
    "Wrist Arthroscopy",
]


def upgrade() -> None:
    op.create_table(
        "surgeries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
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
    existing_names = bind.execute(
        sa.text(
            "SELECT DISTINCT btrim(procedure_name) FROM surgical_cases "
            "WHERE procedure_name IS NOT NULL AND btrim(procedure_name) <> ''"
        )
    ).scalars()
    names_by_key = {name.casefold(): name for name in DEFAULT_SURGERIES}
    for name in existing_names:
        names_by_key.setdefault(name.casefold(), name)

    surgeries = sa.table(
        "surgeries",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String(length=256)),
        sa.column("is_active", sa.Boolean()),
    )
    op.bulk_insert(
        surgeries,
        [
            {"id": uuid.uuid4(), "name": name, "is_active": True}
            for name in sorted(names_by_key.values())
        ],
    )


def downgrade() -> None:
    op.drop_table("surgeries")
