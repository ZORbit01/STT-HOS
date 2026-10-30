from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orm import SurgicalCase


def _identifier_prefix(scheduled_start: datetime) -> str:
    if scheduled_start.tzinfo is None:
        scheduled_start = scheduled_start.replace(tzinfo=UTC)
    return f"S{scheduled_start:%Y%m%d}"


async def generate_case_identifier(db: AsyncSession, scheduled_start: datetime) -> str:
    return (await generate_case_identifiers(db, [scheduled_start]))[0]


async def generate_case_identifiers(db: AsyncSession, scheduled_starts: list[datetime]) -> list[str]:
    if not scheduled_starts:
        return []

    prefixes = {_identifier_prefix(scheduled_start) for scheduled_start in scheduled_starts}
    result = await db.execute(
        select(SurgicalCase.case_code).where(
            or_(*(SurgicalCase.case_code.like(f"{prefix}%") for prefix in prefixes))
        )
    )
    next_suffix_by_prefix = dict.fromkeys(prefixes, 1)
    for code in result.scalars().all():
        for prefix in prefixes:
            suffix = code[len(prefix) :]
            if code.startswith(prefix) and suffix.isdigit():
                next_suffix_by_prefix[prefix] = max(next_suffix_by_prefix[prefix], int(suffix) + 1)

    identifiers: list[str] = []
    for scheduled_start in scheduled_starts:
        prefix = _identifier_prefix(scheduled_start)
        suffix = next_suffix_by_prefix[prefix]
        identifiers.append(f"{prefix}{suffix:03d}")
        next_suffix_by_prefix[prefix] = suffix + 1
    return identifiers
