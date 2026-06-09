"""Tests for the per-user global daily spend cap.

Covers:
  - SpendContext with global cap only (no niche cap) → pre-flight blocks
    oversized calls, allows under-cap.
  - SpendContext with BOTH caps → tightest one wins.
  - today_spend_total_usd returns the cross-niche sum.
  - Pipeline pre-stage _ensure_cap rejects when global cap is exceeded.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from autocontent.models import SpendEntry
from autocontent.repos.spend import SpendCapExceeded
from autocontent.services.spend_context import SpendContext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _Recorder:
    def __init__(self) -> None:
        self.entries: list[SpendEntry] = []

    async def __call__(self, entry: SpendEntry) -> None:
        self.entries.append(entry)


def _make_global_ctx(
    *,
    global_cap_usd: Decimal,
    niche_cap_usd: Decimal | None = None,
    niche_today: Decimal = Decimal("0"),
    global_today_values: list[Decimal] | None = None,
) -> SpendContext:
    """Build a ctx with a global cap wired; niche cap is optional."""
    niche_total_iter = iter(global_today_values or [Decimal("0")] * 20)

    async def fake_today_niche(*, user_id: str, niche_id: UUID) -> Decimal:
        return niche_today

    async def fake_total(*, user_id: str) -> Decimal:
        return next(niche_total_iter)

    return SpendContext(
        user_id="user_global",
        niche_id=UUID("00000000-0000-0000-0000-000000000010"),
        job_id=uuid4(),
        record=_Recorder(),
        cap_usd=niche_cap_usd,
        today_spend=fake_today_niche,
        global_cap_usd=global_cap_usd,
        today_total_spend=fake_total,
    )


# ---------------------------------------------------------------------------
# Pre-flight tests — global cap only
# ---------------------------------------------------------------------------

async def test_global_cap_blocks_oversized_preflight():
    """$4.00 already spent globally + $2.00 estimated > $5.00 cap → raise."""
    ctx = _make_global_ctx(
        global_cap_usd=Decimal("5.00"),
        global_today_values=[Decimal("4.00")],
    )
    with pytest.raises(SpendCapExceeded) as exc_info:
        await ctx.ensure_can_spend(Decimal("2.00"))
    assert exc_info.value.scope == "global"
    assert ctx.abort_event.is_set()


async def test_global_cap_allows_under_cap():
    """$3.00 already spent + $1.50 estimated is within $5.00 cap → no raise."""
    ctx = _make_global_ctx(
        global_cap_usd=Decimal("5.00"),
        global_today_values=[Decimal("3.00")],
    )
    await ctx.ensure_can_spend(Decimal("1.50"))  # must not raise
    assert not ctx.abort_event.is_set()


async def test_global_cap_no_total_reader_skips_check():
    """If today_total_spend is None, the global cap check is skipped entirely."""
    ctx = SpendContext(
        user_id="user_global",
        niche_id=UUID("00000000-0000-0000-0000-000000000010"),
        job_id=uuid4(),
        record=_Recorder(),
        global_cap_usd=Decimal("0.01"),  # tiny cap that would trip
        today_total_spend=None,          # but reader is absent
    )
    await ctx.ensure_can_spend(Decimal("999.00"))  # must not raise


# ---------------------------------------------------------------------------
# Tightest cap wins
# ---------------------------------------------------------------------------

async def test_niche_cap_tighter_than_global():
    """Niche cap is $1.00, global is $10.00. Niche trips first."""
    ctx = _make_global_ctx(
        niche_cap_usd=Decimal("1.00"),
        global_cap_usd=Decimal("10.00"),
        niche_today=Decimal("0.80"),
        global_today_values=[Decimal("2.00")],
    )
    with pytest.raises(SpendCapExceeded) as exc_info:
        await ctx.ensure_can_spend(Decimal("0.30"))  # 0.80+0.30 > 1.00
    assert exc_info.value.scope == "niche"


async def test_global_cap_tighter_than_niche():
    """Global cap is $3.00, niche is $10.00. Global trips first."""
    ctx = _make_global_ctx(
        niche_cap_usd=Decimal("10.00"),
        global_cap_usd=Decimal("3.00"),
        niche_today=Decimal("0.50"),
        global_today_values=[Decimal("2.80")],
    )
    with pytest.raises(SpendCapExceeded) as exc_info:
        await ctx.ensure_can_spend(Decimal("0.30"))  # 2.80+0.30 > 3.00
    assert exc_info.value.scope == "global"


# ---------------------------------------------------------------------------
# post-log global cap check
# ---------------------------------------------------------------------------

async def test_log_raises_when_global_cap_crossed():
    """log() raises SpendCapExceeded(scope='global') after recording entry."""
    ctx = _make_global_ctx(
        global_cap_usd=Decimal("5.00"),
        global_today_values=[Decimal("5.10")],  # already over after recording
    )
    with pytest.raises(SpendCapExceeded) as exc_info:
        await ctx.log(
            provider="openai", sku="gpt-image-1",
            units=Decimal(1), cost_usd=Decimal("0.10"),
        )
    assert exc_info.value.scope == "global"
    assert ctx.abort_event.is_set()
    # Entry must still have been recorded.
    assert len(ctx.record.entries) == 1  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# today_spend_total_usd — unit-level
# ---------------------------------------------------------------------------

async def test_today_spend_total_usd_is_callable():
    """Smoke-test the module-level function signature (no DB, just import)."""
    import inspect
    from autocontent.repos.spend import today_spend_total_usd

    assert inspect.iscoroutinefunction(today_spend_total_usd)
    sig = inspect.signature(today_spend_total_usd)
    assert "user_id" in sig.parameters


# ---------------------------------------------------------------------------
# Pipeline _ensure_cap with global cap exceeded
# ---------------------------------------------------------------------------

async def test_pipeline_ensure_cap_rejects_global_exceeded(monkeypatch):
    """_ensure_cap marks job failed when user's global daily cap is exceeded."""
    from decimal import Decimal
    from datetime import datetime, timezone
    from uuid import uuid4

    from autocontent import pipeline
    from autocontent.models import Job, JobStatus, Niche, PostingWindow, User

    USER_ID = "user_global_pipeline"
    NICHE_ID = UUID("00000000-0000-0000-0000-000000000020")

    niche = Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="test",
        description="test",
        target_audience="test",
        hashtags=[],
        visual_style="flat",
        voice="onyx",
        target_duration_sec=30,
        scene_count=2,
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("100.00"),  # wide niche cap
    )
    job = Job(
        id=uuid4(),
        user_id=USER_ID,
        niche_id=NICHE_ID,
        platform="tiktok",
        status=JobStatus.queued,
    )

    saved: list[Job] = []

    async def fake_save(j: Job) -> None:
        saved.append(j.model_copy(deep=True))

    monkeypatch.setattr(pipeline.jobs_repo, "save_snapshot", fake_save)

    # Niche cap is fine.
    async def fake_assert_within_cap(*, user_id, niche_id, cap_usd):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap", fake_assert_within_cap)

    # Global spend is at the cap.
    async def fake_today_total(*, user_id):
        return Decimal("10.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_total_usd", fake_today_total)

    # User has a $10 global cap (already at it).
    import autocontent.repos.users as _users_repo

    async def fake_get(user_id: str):
        return User(
            id=user_id,
            email="x@x.com",
            global_daily_cap_usd=Decimal("10.00"),
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(_users_repo, "get", fake_get)

    result = await pipeline._ensure_cap(job, niche)

    assert result is False
    assert len(saved) == 1
    assert saved[0].status == JobStatus.failed
    assert "global" in (saved[0].error or "").lower()
