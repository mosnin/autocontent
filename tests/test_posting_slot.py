from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest

from autocontent import pipeline
from autocontent.models import Niche, PostingWindow


def _make_niche(windows: list[PostingWindow]) -> Niche:
    return Niche(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        user_id="user_test",
        title="t", description="d", target_audience="a",
        visual_style="claymation", voice="onyx",
        target_duration_sec=60, scene_count=6,
        posting_windows=windows,
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("3.00"),
    )


@pytest.fixture
def freeze_now(monkeypatch):
    """Freeze `datetime.now(tz)` inside pipeline to a known UTC instant."""
    holder: dict = {}

    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return holder["now"].astimezone(tz) if tz else holder["now"]

    monkeypatch.setattr(pipeline, "datetime", _DT)

    def setter(when: datetime) -> None:
        holder["now"] = when

    return setter


def test_future_slot_today_returns_today(freeze_now):
    # Now = 2026-05-17 09:00 UTC; window at 16:00 UTC → today 16:00.
    freeze_now(datetime(2026, 5, 17, 9, 0, tzinfo=timezone.utc))
    niche = _make_niche([PostingWindow(hour=16, minute=0, tz="UTC")])

    slot = pipeline._next_posting_slot(niche)
    assert slot == datetime(2026, 5, 17, 16, 0, tzinfo=timezone.utc)


def test_passed_slot_returns_tomorrow(freeze_now):
    # Now = 18:00 UTC, window at 09:00 UTC → today's is past, tomorrow wins.
    freeze_now(datetime(2026, 5, 17, 18, 0, tzinfo=timezone.utc))
    niche = _make_niche([PostingWindow(hour=9, minute=0, tz="UTC")])

    slot = pipeline._next_posting_slot(niche)
    assert slot == datetime(2026, 5, 18, 9, 0, tzinfo=timezone.utc)


def test_empty_windows_raises(freeze_now):
    freeze_now(datetime(2026, 5, 17, 9, 0, tzinfo=timezone.utc))
    niche = _make_niche([])
    with pytest.raises(ValueError, match="posting windows"):
        pipeline._next_posting_slot(niche)


def test_multi_tz_earliest_utc_wins(freeze_now):
    """Windows in different timezones — earliest UTC-equivalent slot wins."""
    # Now = 2026-05-17 12:00 UTC.
    freeze_now(datetime(2026, 5, 17, 12, 0, tzinfo=timezone.utc))
    niche = _make_niche([
        # 06:00 LA == 13:00 UTC (today, future)
        PostingWindow(hour=6, minute=0, tz="America/Los_Angeles"),
        # 23:00 Tokyo == 14:00 UTC (today, future)
        PostingWindow(hour=23, minute=0, tz="Asia/Tokyo"),
    ])

    slot = pipeline._next_posting_slot(niche)
    # The earliest UTC is 13:00 (LA window).
    assert slot == datetime(2026, 5, 17, 13, 0, tzinfo=timezone.utc)


def test_tokyo_window_already_passed_today_returns_tomorrow(freeze_now):
    """Tokyo window evaluated at UTC evening — verify offset handling.

    At 22:00 UTC on May 17, Tokyo's 09:00 slot today (== 00:00 UTC May 17)
    is already past. Tomorrow's Tokyo 09:00 == 00:00 UTC May 18 should win.
    """
    freeze_now(datetime(2026, 5, 17, 22, 0, tzinfo=timezone.utc))
    niche = _make_niche([PostingWindow(hour=9, minute=0, tz="Asia/Tokyo")])

    slot = pipeline._next_posting_slot(niche)
    tokyo = ZoneInfo("Asia/Tokyo")
    expected = datetime(2026, 5, 18, 9, 0, tzinfo=tokyo).astimezone(timezone.utc)
    assert slot == expected


def test_scans_a_week_when_today_and_tomorrow_both_past(freeze_now):
    """Belt-and-suspenders: if .at() somehow returned today's slot only
    and today's was past, the multi-day scan still finds tomorrow."""
    freeze_now(datetime(2026, 5, 17, 23, 30, tzinfo=timezone.utc))
    niche = _make_niche([
        PostingWindow(hour=9, minute=0, tz="UTC"),
        PostingWindow(hour=14, minute=0, tz="UTC"),
    ])
    slot = pipeline._next_posting_slot(niche)
    assert slot == datetime(2026, 5, 18, 9, 0, tzinfo=timezone.utc)


def test_grace_period_skips_slots_within_a_minute(freeze_now):
    """Within the 1-minute grace window, the slot is treated as past."""
    freeze_now(datetime(2026, 5, 17, 8, 59, 30, tzinfo=timezone.utc))
    niche = _make_niche([PostingWindow(hour=9, minute=0, tz="UTC")])
    # 9:00 is only 30s away → within grace → skip to tomorrow's 9:00.
    slot = pipeline._next_posting_slot(niche)
    assert slot == datetime(2026, 5, 18, 9, 0, tzinfo=timezone.utc)


def test_returns_aware_datetime(freeze_now):
    freeze_now(datetime(2026, 5, 17, 9, 0, tzinfo=timezone.utc))
    niche = _make_niche([PostingWindow(hour=16, minute=0, tz="UTC")])
    slot = pipeline._next_posting_slot(niche)
    assert slot.tzinfo is not None
    # Comparing aware-to-aware should not raise.
    _ = slot > datetime.now(timezone.utc) - timedelta(days=1)
