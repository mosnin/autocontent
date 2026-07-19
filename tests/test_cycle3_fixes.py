"""Cycle-3 adversarial-verification fixes.

Covers the two backend logic findings confirmed by the resilience and
pipeline reviewers:
  1. SpendContext.log flags a post-spend cap breach (after_spend=True) so
     the generated-music handler fails the job instead of masking a real,
     already-billed breach as a pre-flight fallback.
  2. reset_for_retry's atomic claim (real-PG coverage lives in
     tests/integration/test_pg_reset_retry.py).
"""
from __future__ import annotations

import inspect
from decimal import Decimal
from uuid import uuid4

from marketer.repos.spend import SpendCapExceeded
from marketer.services.spend_context import SpendContext


def test_spend_cap_exceeded_carries_after_spend_flag():
    pre = SpendCapExceeded("pre", scope="niche")
    assert pre.after_spend is False  # default: pre-flight, nothing spent
    post = SpendCapExceeded("post", scope="global", after_spend=True)
    assert post.after_spend is True
    assert post.scope == "global"


async def test_spend_log_marks_post_spend_breach():
    """SpendContext.log records the charge, then re-checks the cap; when the
    re-check trips, the raised SpendCapExceeded must carry after_spend=True
    (the charge already landed in the ledger)."""
    recorded = []

    async def record(entry):
        recorded.append(entry)

    async def over_cap(*, user_id, niche_id):
        return Decimal("10.00")  # already over the $1 cap

    ctx = SpendContext(
        user_id="u1",
        niche_id=uuid4(),
        job_id=uuid4(),
        record=record,
        cap_usd=Decimal("1.00"),
        today_spend=over_cap,
    )
    try:
        await ctx.log(provider="elevenlabs", sku="music", units=Decimal("1"),
                      cost_usd=Decimal("0.50"))
    except SpendCapExceeded as e:
        assert e.after_spend is True   # the $0.50 was already logged
        assert len(recorded) == 1      # charge landed before the breach raised
    else:
        raise AssertionError("expected a post-spend SpendCapExceeded")


async def test_ensure_can_spend_breach_is_not_after_spend():
    """The pre-flight gate raises before any charge — after_spend stays False
    so the music handler falls back to the free library instead of failing."""
    async def over_cap(*, user_id, niche_id):
        return Decimal("10.00")

    ctx = SpendContext(
        user_id="u1", niche_id=uuid4(), job_id=uuid4(),
        record=lambda e: None, cap_usd=Decimal("1.00"), today_spend=over_cap,
    )
    try:
        await ctx.ensure_can_spend(Decimal("0.50"))
    except SpendCapExceeded as e:
        assert e.after_spend is False
    else:
        raise AssertionError("expected a pre-flight SpendCapExceeded")


def test_music_handler_fails_on_post_spend_breach():
    """Tripwire: the generated-music handler must branch on after_spend and
    fail the job on a real (post-spend) breach rather than swallow it."""
    from marketer import pipeline

    src = inspect.getsource(pipeline._run_job_inner)
    assert 'getattr(e, "after_spend"' in src
    assert "return await _fail_with(job, str(e))" in src
