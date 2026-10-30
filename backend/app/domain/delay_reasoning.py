from datetime import datetime, timedelta


def is_unexplained_delay(
    *,
    actual_start_at: datetime,
    scheduled_start: datetime,
    previous_case_actual_end_at: datetime | None,
    gap_threshold: timedelta,
) -> bool:
    """
    Decide whether a case's late start needs a nurse-supplied reason.

    A late start is auto-explained when the room was still occupied by the
    previous case close to this case's actual start (push from overrun).
    Otherwise, any start beyond `gap_threshold` past the reference time
    requires an explanation.
    """
    reference = previous_case_actual_end_at or scheduled_start
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=actual_start_at.tzinfo)

    gap = actual_start_at - reference
    return gap > gap_threshold
