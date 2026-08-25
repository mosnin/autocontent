"""Recurring-slot expansion, with the DST transitions spelled out.

The whole point of `scheduling/slots.py` is that a slot is authored as a
local wall-clock time and stored as UTC instants. Those two descriptions
only diverge at a DST transition, so that is what these tests pin: a
spring-forward week and a fall-back week, both asserted on the exact UTC
instants, plus the two pathological wall-clock times (one that does not
exist, one that happens twice).

No DB, no network — `slots` is pure functions over pydantic models.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from marketer.scheduling import slots
from marketer.scheduling.schemas import RecurringSlotCreate

NY = "America/New_York"


def _utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def _slot(**over) -> RecurringSlotCreate:
    base = {"weekday": 0, "hour": 9, "minute": 0, "timezone": NY, "platforms": ["tiktok"]}
    base.update(over)
    return RecurringSlotCreate(**base)


# --------------------------------------------------------------- basics


def test_weekly_slot_fires_once_per_week_at_the_local_time():
    fired = slots.expand(
        [_slot()], start=_utc("2026-01-05T00:00:00"), end=_utc("2026-02-02T00:00:00")
    )
    # Mondays 2026-01-05, 12, 19, 26 at 09:00 EST (UTC-5) = 14:00Z.
    assert fired == [
        _utc("2026-01-05T14:00:00"),
        _utc("2026-01-12T14:00:00"),
        _utc("2026-01-19T14:00:00"),
        _utc("2026-01-26T14:00:00"),
    ]


def test_window_is_half_open():
    """[start, end): the instant exactly on `end` belongs to the next page,
    or paging a calendar month by month emits it twice."""
    exact = _utc("2026-01-05T14:00:00")
    assert slots.expand([_slot()], start=exact, end=exact + timedelta(days=1)) == [exact]
    assert slots.expand([_slot()], start=exact - timedelta(days=1), end=exact) == []


def test_inverted_and_empty_windows_are_empty():
    assert slots.expand([_slot()], start=_utc("2026-02-01T00:00:00"),
                        end=_utc("2026-01-01T00:00:00")) == []


def test_inactive_slots_are_skipped():
    assert slots.expand(
        [_slot(active=False)],
        start=_utc("2026-01-05T00:00:00"), end=_utc("2026-01-12T00:00:00"),
    ) == []


def test_window_longer_than_a_year_is_refused():
    with pytest.raises(slots.SlotExpansionError):
        slots.expand([_slot()], start=_utc("2026-01-01T00:00:00"),
                     end=_utc("2027-06-01T00:00:00"))


# ----------------------------------------------------------------- DST


def test_spring_forward_keeps_the_local_wall_clock_and_moves_the_utc_instant():
    """US DST starts 2026-03-08. A 09:00 New York slot is 14:00Z the Monday
    before and 13:00Z the Monday after.

    Naive UTC arithmetic ("first occurrence + 7 days") would emit 14:00Z on
    both Mondays — i.e. 10:00 local for the rest of the year. An hour of
    silent drift every week for half the year is the bug this asserts is
    absent.
    """
    fired = slots.expand(
        [_slot()], start=_utc("2026-03-01T00:00:00"), end=_utc("2026-03-16T00:00:00")
    )
    assert fired == [
        _utc("2026-03-02T14:00:00"),  # EST, UTC-5
        _utc("2026-03-09T13:00:00"),  # EDT, UTC-4 — same 09:00 local
    ]


def test_fall_back_keeps_the_local_wall_clock_and_moves_the_utc_instant():
    """US DST ends 2026-11-01: 13:00Z before, 14:00Z after, still 09:00
    local on both sides."""
    fired = slots.expand(
        [_slot()], start=_utc("2026-10-20T00:00:00"), end=_utc("2026-11-09T00:00:00")
    )
    assert fired == [
        _utc("2026-10-26T13:00:00"),  # EDT, UTC-4
        _utc("2026-11-02T14:00:00"),  # EST, UTC-5 — same 09:00 local
    ]


def test_nonexistent_local_time_fires_exactly_once():
    """02:30 does not exist on 2026-03-08 in New York (02:00 -> 03:00).

    fold=0 resolves it with the pre-transition offset: one instant,
    07:30Z. Late in local terms, but it fires — and it fires ONCE. Never
    firing (dropping the occurrence) would silently swallow a user's post.
    """
    fired = slots.expand(
        [_slot(weekday=6, hour=2, minute=30)],
        start=_utc("2026-03-08T00:00:00"), end=_utc("2026-03-09T00:00:00"),
    )
    assert fired == [_utc("2026-03-08T07:30:00")]


def test_spring_forward_collision_is_deduplicated():
    """On 2026-03-08, 02:30 and 03:30 local are the SAME instant. Two slots
    must still produce one post, not two."""
    fired = slots.expand(
        [_slot(weekday=6, hour=2, minute=30), _slot(weekday=6, hour=3, minute=30)],
        start=_utc("2026-03-08T00:00:00"), end=_utc("2026-03-09T00:00:00"),
    )
    assert fired == [_utc("2026-03-08T07:30:00")]


def test_ambiguous_local_time_fires_exactly_once():
    """01:30 happens TWICE on 2026-11-01 in New York (02:00 -> 01:00).

    Emitting both would double-post — the worst failure this feature has.
    fold=0 takes the first (still-EDT) occurrence: 05:30Z, once.
    """
    fired = slots.expand(
        [_slot(weekday=6, hour=1, minute=30)],
        start=_utc("2026-11-01T00:00:00"), end=_utc("2026-11-02T00:00:00"),
    )
    assert fired == [_utc("2026-11-01T05:30:00")]


def test_southern_hemisphere_transition_moves_the_other_way():
    """Sanity check that nothing is hard-coded to the US: Sydney ends DST
    on 2026-04-05, so 09:00 local goes from 23:00Z (prev day) to 00:00Z."""
    fired = slots.expand(
        [_slot(weekday=0, timezone="Australia/Sydney")],
        start=_utc("2026-03-29T00:00:00"), end=_utc("2026-04-14T00:00:00"),
    )
    assert fired == [
        _utc("2026-03-29T22:00:00"),  # Mon 2026-03-30 09:00 AEDT (UTC+11)
        _utc("2026-04-05T23:00:00"),  # Mon 2026-04-06 09:00 AEST (UTC+10)
        _utc("2026-04-12T23:00:00"),
    ]


def test_zone_far_from_utc_is_not_clipped_at_the_window_edge():
    """A local day's occurrence can land on the other side of the UTC date
    boundary; expansion pads a day on each side so it is not lost."""
    fired = slots.expand(
        [_slot(weekday=0, hour=9, timezone="Pacific/Auckland")],
        start=_utc("2026-01-04T00:00:00"), end=_utc("2026-01-06T00:00:00"),
    )
    # Mon 2026-01-05 09:00 NZDT (UTC+13) == Sun 2026-01-04 20:00Z.
    assert fired == [_utc("2026-01-04T20:00:00")]


# ------------------------------------------------------- helper wrappers


def test_expand_slot_matches_expand():
    slot = _slot()
    start, end = _utc("2026-01-01T00:00:00"), _utc("2026-02-01T00:00:00")
    assert slots.expand_slot(slot, start=start, end=end) == slots.expand(
        [slot], start=start, end=end
    )


def test_occurrence_is_the_utc_instant_for_one_local_day():
    from datetime import date

    assert slots.occurrence(_slot(), date(2026, 3, 9)) == _utc("2026-03-09T13:00:00")


def test_next_occurrence_is_strictly_after():
    monday = _utc("2026-01-05T14:00:00")
    # Standing exactly on a firing returns the NEXT one, not this one —
    # otherwise a scheduler that asks "what's next?" right after dispatching
    # gets the post it just sent.
    assert slots.next_occurrence([_slot()], after=monday) == _utc("2026-01-12T14:00:00")
    assert slots.next_occurrence(
        [_slot()], after=monday - timedelta(seconds=1)
    ) == monday


def test_next_occurrence_returns_none_past_the_horizon():
    assert slots.next_occurrence(
        [_slot()], after=_utc("2026-01-06T00:00:00"), horizon_days=3
    ) is None


def test_naive_datetimes_are_read_as_utc():
    """A naive bound must never be read as server-local time: the server's
    clock zone is an accident of deployment."""
    naive = slots.expand([_slot()], start=datetime(2026, 1, 5), end=datetime(2026, 1, 6))
    aware = slots.expand([_slot()], start=_utc("2026-01-05T00:00:00"),
                         end=_utc("2026-01-06T00:00:00"))
    assert naive == aware == [_utc("2026-01-05T14:00:00")]
