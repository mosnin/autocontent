"""Atomic prepaid-credit reserve: fan-out cannot spend past the balance."""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from marketer.repos import billing as billing_repo
from marketer.repos.spend import SpendCapExceeded
from marketer.services.spend_context import SpendContext


def test_positive_finite_rejects_junk():
    assert billing_repo._positive_finite(Decimal("1.5")) == Decimal("1.5")
    assert billing_repo._positive_finite(Decimal("0")) is None
    assert billing_repo._positive_finite(Decimal("-2")) is None


async def test_reserve_sql_requires_balance_cover(monkeypatch):
    captured: dict = {}

    class _CM:
        def __init__(self, inner):
            self.inner = inner

        async def __aenter__(self):
            return self.inner

        async def __aexit__(self, *exc):
            return False

    class _Conn:
        async def fetchval(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return Decimal("3.50")

        async def execute(self, sql, *args):
            captured["insert"] = sql
            return "INSERT 1"

        def transaction(self):
            return _CM(self)

    class _Pool:
        def acquire(self):
            return _CM(_Conn())

    async def _pool():
        return _Pool()

    monkeypatch.setattr(billing_repo, "get_pool", _pool)
    job_id = uuid4()
    out = await billing_repo.reserve(
        user_id="user_a",
        amount_usd=Decimal("1.50"),
        job_id=job_id,
        description="preflight reserve",
    )
    assert out == Decimal("3.50")
    sql = " ".join(captured["sql"].split())
    assert "credit_balance_usd >= $1" in sql
    assert captured["args"][0] == Decimal("1.50")
    assert captured["args"][1] == "user_a"


async def test_ensure_can_spend_reserves_then_log_does_not_double_charge(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 2.0)

    reserves: list[Decimal] = []
    debits: list[Decimal] = []

    async def fake_reserve(*, user_id, amount_usd, job_id, description):
        reserves.append(amount_usd)
        return Decimal("8.00")

    async def fake_debit(*, user_id, amount_usd, job_id, description):
        debits.append(amount_usd)
        return Decimal("7.90")

    async def fake_balance(user_id):
        return Decimal("8.00")

    monkeypatch.setattr(billing_repo, "reserve", fake_reserve)
    monkeypatch.setattr(billing_repo, "debit", fake_debit)
    monkeypatch.setattr(billing_repo, "balance", fake_balance)

    async def record(entry):
        return None

    ctx = SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=record
    )
    await ctx.ensure_can_spend(Decimal("1.00"))  # reserves 2.00
    assert reserves == [Decimal("2.00")]
    await ctx.log(
        provider="openai", sku="tts", units=Decimal("1"), cost_usd=Decimal("1.00")
    )
    # actual 1.00 * 2.0 = 2.00, already reserved — no extra debit
    assert debits == []


async def test_log_true_up_when_actual_exceeds_reserve(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.0)

    async def fake_reserve(*, user_id, amount_usd, job_id, description):
        return Decimal("4.00")

    extras: list[Decimal] = []

    async def fake_debit(*, user_id, amount_usd, job_id, description):
        extras.append(amount_usd)
        return Decimal("3.50")

    monkeypatch.setattr(billing_repo, "reserve", fake_reserve)
    monkeypatch.setattr(billing_repo, "debit", fake_debit)

    async def record(entry):
        return None

    ctx = SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=record
    )
    await ctx.ensure_can_spend(Decimal("0.40"))
    await ctx.log(
        provider="grok", sku="imagine", units=Decimal("1"), cost_usd=Decimal("1.00")
    )
    assert extras == [Decimal("0.60")]


async def test_reserve_none_trips_credits(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.0)

    async def fake_reserve(*, user_id, amount_usd, job_id, description):
        return None

    monkeypatch.setattr(billing_repo, "reserve", fake_reserve)

    async def record(entry):
        return None

    ctx = SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=record
    )
    with pytest.raises(SpendCapExceeded) as e:
        await ctx.ensure_can_spend(Decimal("1.00"))
    assert e.value.scope == "credits"
