from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from autocontent.models import SpendEntry
from autocontent.repos.spend import SpendCapExceeded
from autocontent.services.spend_context import SpendContext


class _Recorder:
    def __init__(self) -> None:
        self.entries: list[SpendEntry] = []

    async def __call__(self, entry: SpendEntry) -> None:
        self.entries.append(entry)


def _make_ctx(*, cap_usd, today_values: list[Decimal]) -> SpendContext:
    """Build a ctx whose today_spend() returns successive values from a list."""
    iterator = iter(today_values)

    async def today(*, user_id: str, niche_id: UUID) -> Decimal:
        return next(iterator)

    return SpendContext(
        user_id="user_test",
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        job_id=uuid4(),
        record=_Recorder(),
        cap_usd=cap_usd,
        today_spend=today,
    )


async def test_log_raises_when_crossing_cap():
    ctx = _make_ctx(
        cap_usd=Decimal("1.00"),
        today_values=[Decimal("0.40"), Decimal("0.80"), Decimal("1.20")],
    )

    # First two spends stay under the cap.
    await ctx.log(provider="openai", sku="gpt-image-1",
                  units=Decimal(1), cost_usd=Decimal("0.04"))
    await ctx.log(provider="openai", sku="gpt-image-1",
                  units=Decimal(1), cost_usd=Decimal("0.04"))

    # Third call's DB snapshot crosses; log() should raise after recording.
    with pytest.raises(SpendCapExceeded):
        await ctx.log(provider="xai", sku="grok-imagine-video",
                      units=Decimal(5), cost_usd=Decimal("0.25"))
    assert ctx.abort_event.is_set()


async def test_log_raises_at_exact_threshold():
    ctx = _make_ctx(cap_usd=Decimal("0.50"), today_values=[Decimal("0.50")])
    with pytest.raises(SpendCapExceeded):
        await ctx.log(provider="openai", sku="x",
                      units=Decimal(1), cost_usd=Decimal("0.10"))


async def test_no_cap_skips_db_check(fake_spend):
    """With cap_usd=None, log() never queries today_spend (no extra DB load)."""
    ctx, rec = fake_spend
    assert ctx.cap_usd is None

    called = {"n": 0}

    async def boom(*, user_id, niche_id):
        called["n"] += 1
        raise AssertionError("today_spend should not be called when cap_usd is None")

    ctx.today_spend = boom

    await ctx.log(provider="openai", sku="x", units=Decimal(1), cost_usd=Decimal("0.04"))
    await ctx.log(provider="openai", sku="x", units=Decimal(1), cost_usd=Decimal("0.04"))

    assert len(rec.entries) == 2
    assert called["n"] == 0
    assert not ctx.abort_event.is_set()


async def test_records_entry_before_raising():
    """Even when log() raises, the spend MUST already be persisted —
    we don't want to double-count or lose ledger rows on the call that
    trips the cap."""
    rec = _Recorder()
    ctx = SpendContext(
        user_id="user_test",
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        job_id=uuid4(),
        record=rec,
        cap_usd=Decimal("0.01"),
    )

    async def today(*, user_id, niche_id):
        return Decimal("0.05")
    ctx.today_spend = today

    with pytest.raises(SpendCapExceeded):
        await ctx.log(provider="xai", sku="grok-imagine-video",
                      units=Decimal(5), cost_usd=Decimal("0.25"))
    assert len(rec.entries) == 1
    assert rec.entries[0].cost_usd == Decimal("0.25")


# ---------------------------------------------------------------------------
# ensure_can_spend pre-flight tests
# ---------------------------------------------------------------------------

def _make_preflight_ctx(*, cap_usd, today_value: Decimal | None = None) -> tuple[SpendContext, dict]:
    """Build a ctx for preflight tests; tracks DB call count."""
    call_count = {"n": 0}

    async def today(*, user_id: str, niche_id: UUID) -> Decimal:
        call_count["n"] += 1
        if today_value is None:
            raise AssertionError("today_spend should not be called")
        return today_value

    ctx = SpendContext(
        user_id="user_test",
        niche_id=UUID("00000000-0000-0000-0000-000000000002"),
        job_id=uuid4(),
        record=_Recorder(),
        cap_usd=cap_usd,
        today_spend=today,
    )
    return ctx, call_count


async def test_pre_flight_blocks_oversized_call():
    """$0.50 already spent + $0.60 estimated exceeds $1.00 cap."""
    ctx, _ = _make_preflight_ctx(cap_usd=Decimal("1.00"), today_value=Decimal("0.50"))
    with pytest.raises(SpendCapExceeded):
        await ctx.ensure_can_spend(Decimal("0.60"))
    assert ctx.abort_event.is_set()


async def test_pre_flight_allows_under_cap():
    """$0.50 already spent + $0.40 estimated is within $1.00 cap."""
    ctx, _ = _make_preflight_ctx(cap_usd=Decimal("1.00"), today_value=Decimal("0.50"))
    await ctx.ensure_can_spend(Decimal("0.40"))  # must not raise
    assert not ctx.abort_event.is_set()


async def test_pre_flight_no_cap_is_noop():
    """cap_usd=None means ensure_can_spend is a no-op — no DB call, no raise."""
    ctx, call_count = _make_preflight_ctx(cap_usd=None, today_value=None)
    await ctx.ensure_can_spend(Decimal("1000"))  # must not raise
    assert call_count["n"] == 0
    assert not ctx.abort_event.is_set()


async def test_abort_event_short_circuits():
    """Once abort_event is set, ensure_can_spend raises without hitting the DB."""
    ctx, call_count = _make_preflight_ctx(cap_usd=Decimal("1.00"), today_value=None)
    ctx.abort_event.set()
    with pytest.raises(SpendCapExceeded):
        await ctx.ensure_can_spend(Decimal("0.01"))
    assert call_count["n"] == 0
