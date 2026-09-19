"""Safe-execute gather: account + ledger reads are independent."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from marketer.repos.ads import AdAccount, AdCampaign
from marketer.services import ad_actions_exec as ex


def _account() -> AdAccount:
    now = datetime.now(timezone.utc)
    return AdAccount(
        id=uuid4(), user_id="u1", platform="meta", status="active",
        created_at=now, updated_at=now,
    )


def _campaign(account_id) -> AdCampaign:
    now = datetime.now(timezone.utc)
    return AdCampaign(
        id=uuid4(), user_id="u1", ad_account_id=account_id, name="C",
        status="active", daily_budget_usd=Decimal("10"),
        created_at=now, updated_at=now,
    )


async def test_guard_loads_account_and_spend_together(monkeypatch):
    """Four independent ledger reads used to wait on each other in front
    of every fail-closed budget check. Overlay still cannot relax."""
    acc = _account()
    camp = _campaign(acc.id)
    started = 0
    max_inflight = 0
    inflight = 0
    release = asyncio.Event()

    async def _gate():
        nonlocal started, max_inflight, inflight
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        if started < 4:
            await release.wait()
        else:
            release.set()
        inflight -= 1

    async def fake_get_account(account_id, *, user_id):
        await _gate()
        return acc

    async def fake_committed(*, user_id, ad_account_id, exclude_campaign_id=None):
        await _gate()
        return Decimal("0")

    async def fake_today(account_id, *, user_id, day):
        await _gate()
        return Decimal("0")

    async def fake_month(account_id, *, user_id, start, end):
        await _gate()
        return Decimal("0")

    monkeypatch.setattr(ex.ads_repo, "get_account", fake_get_account)
    monkeypatch.setattr(
        ex.ads_repo, "active_daily_budget_total", fake_committed
    )
    monkeypatch.setattr(ex.ads_repo, "account_spend_on", fake_today)
    monkeypatch.setattr(ex.ads_repo, "account_spend_between", fake_month)
    monkeypatch.setattr(ex.settings, "jev_enabled", False)

    delta, requires = await ex.guard_activation(camp)
    assert started == 4
    assert max_inflight == 4
    assert delta == Decimal("10")
    assert requires is False


async def test_guard_still_fail_closes_on_killswitch(monkeypatch):
    acc = _account()
    acc = acc.model_copy(update={"killswitch": True})
    camp = _campaign(acc.id)

    async def fake_get_account(account_id, *, user_id):
        return acc

    async def fake_zero(*a, **k):
        return Decimal("0")

    monkeypatch.setattr(ex.ads_repo, "get_account", fake_get_account)
    monkeypatch.setattr(ex.ads_repo, "active_daily_budget_total", fake_zero)
    monkeypatch.setattr(ex.ads_repo, "account_spend_on", fake_zero)
    monkeypatch.setattr(ex.ads_repo, "account_spend_between", fake_zero)
    monkeypatch.setattr(ex.settings, "jev_enabled", False)

    try:
        await ex.guard_activation(camp)
        raise AssertionError("killswitch must deny")
    except ex.AdSpendDenied:
        pass
