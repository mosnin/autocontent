"""Recurring-slot expansion: weekday+local-time templates -> UTC instants.

Why this file exists at all
---------------------------
A recurring slot is authored the way a human thinks about it — "every
Monday at 09:00, my time". It is *not* a fixed UTC offset from some epoch.
Those two descriptions agree until a DST transition, at which point naive
UTC arithmetic (take the first occurrence, add 7 days, repeat) silently
drifts an hour: a 09:00 America/New_York slot is 14:00Z in winter and
13:00Z in summer. An hour of drift is a post landing outside the window
the user chose, every week, for half the year.

So expansion works the only way that stays correct: iterate *local
calendar dates* in the slot's own zone, attach the wall-clock time, and
convert each occurrence to UTC individually. Storage is UTC (one totally
ordered instant per post, comparable in a WHERE clause); authoring is
local. That split is the whole design.

DST edge cases, and what we do about them
-----------------------------------------
Spring forward (e.g. 2026-03-08 in America/New_York, 02:00 -> 03:00): a
slot at 02:30 names a wall-clock time that does not exist that day. PEP
495 still gives it an instant — with `fold=0` it resolves using the
pre-transition offset, landing at 07:30Z, i.e. 03:30 local. The post goes
out once, half an hour late in local terms, and never twice or never at
all. That is the right failure mode for a scheduler, and it means a 02:30
and an 03:30 slot collapse onto the same instant that one day — hence the
de-duplication below.

Fall back (e.g. 2026-11-01 in America/New_York, 02:00 -> 01:00): a slot at
01:30 names a wall-clock time that happens *twice*. With `fold=0` we take
the first (still-DST) occurrence and emit exactly one instant. Emitting
both would double-post, which is the single worst failure this feature
has.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .schemas import RecurringSlot, RecurringSlotCreate

# A slot expansion is only ever used to pre-fill a calendar; a year is far
# more than any UI shows and bounds the loop for a pathological caller.
MAX_WINDOW_DAYS = 366
MAX_OCCURRENCES = 2_000


class SlotExpansionError(ValueError):
    pass


def occurrence(slot: RecurringSlotCreate, local_day: date) -> datetime:
    """The UTC instant this slot fires on `local_day` (a date in the slot's
    own zone). `fold=0` is explicit, not incidental — see the module
    docstring for what it decides on both DST transitions."""
    zone = ZoneInfo(slot.timezone)
    local = datetime.combine(local_day, time(slot.hour, slot.minute), zone).replace(fold=0)
    return local.astimezone(timezone.utc)


def expand_slot(
    slot: RecurringSlotCreate,
    *,
    start: datetime,
    end: datetime,
) -> list[datetime]:
    """Every firing of `slot` in the UTC half-open window [start, end)."""
    return expand([slot], start=start, end=end)


def expand(
    slots: list[RecurringSlotCreate] | list[RecurringSlot],
    *,
    start: datetime,
    end: datetime,
) -> list[datetime]:
    """Merge every slot's firings in [start, end) into one sorted, unique
    list of UTC instants.

    Uniqueness is not cosmetic: two slots can legitimately collapse onto
    the same instant (the spring-forward case above, or a user who defined
    the same time in two equivalent zones), and each duplicate would become
    a second scheduled post.
    """
    start = _utc(start)
    end = _utc(end)
    if end <= start:
        return []
    if (end - start) > timedelta(days=MAX_WINDOW_DAYS):
        raise SlotExpansionError(f"window longer than {MAX_WINDOW_DAYS} days")

    out: set[datetime] = set()
    for slot in slots:
        if not getattr(slot, "active", True):
            continue
        zone = ZoneInfo(slot.timezone)
        # Walk local dates, not UTC dates. Pad a day on each side because a
        # zone far from UTC can put a local day's occurrence on the other
        # side of the UTC date boundary.
        first_local = (start.astimezone(zone) - timedelta(days=1)).date()
        last_local = (end.astimezone(zone) + timedelta(days=1)).date()

        # Jump straight to the first matching weekday, then stride by 7 local
        # days. Striding in *local days* (not in fixed 24h deltas) is what
        # keeps the wall-clock time pinned across a transition.
        day = first_local + timedelta(days=(slot.weekday - first_local.weekday()) % 7)
        while day <= last_local:
            when = occurrence(slot, day)
            if start <= when < end:
                out.add(when)
                if len(out) > MAX_OCCURRENCES:
                    raise SlotExpansionError("too many occurrences in window")
            day += timedelta(days=7)
    return sorted(out)


def next_occurrence(
    slots: list[RecurringSlotCreate] | list[RecurringSlot],
    *,
    after: datetime,
    horizon_days: int = 14,
) -> datetime | None:
    """The soonest firing strictly after `after`, or None within horizon."""
    after = _utc(after)
    fired = expand(slots, start=after + timedelta(microseconds=1),
                   end=after + timedelta(days=horizon_days))
    return fired[0] if fired else None


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
