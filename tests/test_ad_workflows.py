"""Ad workflow logic + Inngest mount gating. The optimization policy and the
budget recommendation are pure/injectable and tested here; the Inngest mount is
verified to be a clean no-op when disabled."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from marketer.repos.ads import AdCampaign, AdMetricsDaily
from marketer.services import ad_workflows


def _campaign(daily=Decimal("10")) -> AdCampaign:
    return AdCampaign(
        id=uuid4(), user_id="u1", ad_account_id=uuid4(), name="C",
        status="active", daily_budget_usd=daily,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )


def _metrics(spend, revenue) -> list[AdMetricsDaily]:
    return [
        AdMetricsDaily(
            date=date.today(), impressions=100, clicks=10,
            spend_usd=Decimal(str(spend)), conversions=Decimal("2"),
            revenue_usd=Decimal(str(revenue)),
        )
    ]


def test_recommend_scales_up_strong_performer():
    # ROAS = 40/10 = 4 >= target 2 → scale up 20% → 12.00
    rec = ad_workflows.recommend_daily_budget(_campaign(), _metrics(10, 40))
    assert rec == Decimal("12.00")


def test_recommend_scales_down_weak_performer():
    # ROAS = 5/10 = 0.5 < target/2 (1.0) → scale down 20% → 8.00
    rec = ad_workflows.recommend_daily_budget(_campaign(), _metrics(10, 5))
    assert rec == Decimal("8.00")


def test_recommend_holds_in_the_middle():
    # ROAS = 15/10 = 1.5 (between target/2 and target) → no change
    rec = ad_workflows.recommend_daily_budget(_campaign(), _metrics(10, 15))
    assert rec is None


def test_recommend_none_without_signal():
    assert ad_workflows.recommend_daily_budget(_campaign(), []) is None
    assert (
        ad_workflows.recommend_daily_budget(_campaign(daily=Decimal("0")), _metrics(10, 40))
        is None
    )


async def test_sync_account_skips_inactive(monkeypatch):
    import marketer.repos.ads as ads_repo

    async def _get(account_id, *, user_id):
        return None

    monkeypatch.setattr(ads_repo, "get_account", _get)
    n = await ad_workflows.sync_account_metrics(
        user_id="u1", account_id=uuid4(), fetch_fn=None
    )
    assert n == 0


def test_inngest_mount_noop_when_disabled(monkeypatch):
    from marketer.config import settings
    from marketer.services import inngest_app

    monkeypatch.setattr(settings, "ads_enabled", False)
    assert inngest_app.is_enabled() is False
    # mount must be a clean no-op (False), never raise, on a dummy app.
    assert inngest_app.mount(object()) is False


def test_inngest_enabled_requires_ads_and_key(monkeypatch):
    from marketer.config import settings
    from marketer.services import inngest_app

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "inngest_dev", False)
    monkeypatch.setattr(settings, "inngest_signing_key", "")
    assert inngest_app.is_enabled() is False
    monkeypatch.setattr(settings, "inngest_signing_key", "signkey")
    assert inngest_app.is_enabled() is True


async def test_optimize_gathers_campaign_metrics_and_kit(monkeypatch):
    """Campaign, metrics, and ad-kit knobs are independent. A missing
    campaign still fail-closes before any proposal."""
    started = 0
    max_inflight = 0
    inflight = 0
    release = asyncio.Event()
    proposed = []

    async def _gate():
        nonlocal started, max_inflight, inflight
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        if started < 3:
            await release.wait()
        else:
            release.set()
        inflight -= 1

    async def fake_get(campaign_id, *, user_id):
        await _gate()
        return None

    async def fake_metrics(campaign_id, *, user_id):
        await _gate()
        return []

    async def fake_knobs(user_id, target_roas):
        await _gate()
        return {"target_roas": target_roas}

    async def must_not_propose(**kwargs):
        proposed.append(kwargs)
        raise AssertionError("missing campaign must not propose")

    monkeypatch.setattr(ad_workflows.ads_repo, "get_campaign", fake_get)
    monkeypatch.setattr(ad_workflows.ads_repo, "campaign_metrics", fake_metrics)
    monkeypatch.setattr(ad_workflows, "_ad_kit_knobs", fake_knobs)
    monkeypatch.setattr(ad_workflows, "propose_budget_change", must_not_propose)

    out = await ad_workflows.optimize_campaign(
        user_id="u1", campaign_id=uuid4()
    )
    assert out == {"status": "skipped", "reason": "not found"}
    assert started == 3
    assert max_inflight == 3
    assert proposed == []


async def test_optimize_kit_failure_still_evaluates(monkeypatch):
    camp = _campaign()

    async def fake_get(campaign_id, *, user_id):
        return camp

    async def fake_metrics(campaign_id, *, user_id):
        return _metrics(10, 40)

    async def boom(*, user_id, kind, kit_id=None):
        raise RuntimeError("kit db down")

    seen = []

    async def fake_propose(**kwargs):
        seen.append(kwargs["new_daily_budget_usd"])
        return {"status": "pending_approval"}

    import marketer.repos.kits as kits_repo

    monkeypatch.setattr(ad_workflows.ads_repo, "get_campaign", fake_get)
    monkeypatch.setattr(ad_workflows.ads_repo, "campaign_metrics", fake_metrics)
    monkeypatch.setattr(kits_repo, "resolve", boom)
    monkeypatch.setattr(ad_workflows, "propose_budget_change", fake_propose)

    out = await ad_workflows.optimize_campaign(
        user_id="u1", campaign_id=camp.id
    )
    assert out["status"] == "pending_approval"
    # Default +20% on $10 with kit lookup failed-open.
    assert seen == [Decimal("12.00")]


def _account(user_id: str = "u1", status: str = "active"):
    from marketer.repos.ads import AdAccount

    now = datetime.now(timezone.utc)
    return AdAccount(
        id=uuid4(),
        user_id=user_id,
        platform="meta",
        status=status,
        created_at=now,
        updated_at=now,
    )


async def test_sync_all_gathers_lists_and_skips_get(monkeypatch):
    """Per-user list then leftover get_account used to be sequential."""
    started = 0
    max_inflight = 0
    inflight = 0
    release = asyncio.Event()
    a1 = _account("u1")
    a2 = _account("u2")
    inactive = _account("u1", status="paused")
    gets = []

    async def _mark():
        nonlocal started, max_inflight, inflight
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        n = started
        if n < 2:
            await release.wait()
        else:
            release.set()
        inflight -= 1

    async def fake_list(user_id):
        await _mark()
        if user_id == "u1":
            return [a1, inactive]
        return [a2]

    async def boom_get(account_id, *, user_id):
        gets.append(account_id)
        raise AssertionError("listed account must not reload")

    async def fake_fetch(account):
        return []

    monkeypatch.setattr(ad_workflows.ads_repo, "list_accounts", fake_list)
    monkeypatch.setattr(ad_workflows.ads_repo, "get_account", boom_get)

    n = await ad_workflows.sync_all_accounts_metrics(
        user_ids=["u1", "u2"], fetch_fn=fake_fetch
    )
    assert n == 0
    assert started == 2
    assert max_inflight == 2
    assert gets == []


async def test_sync_account_mismatch_fail_closes():
    acc = _account("u1")
    with pytest.raises(ValueError, match="account mismatch"):
        await ad_workflows.sync_account_metrics(
            user_id="u1", account_id=uuid4(), account=acc, fetch_fn=lambda a: []
        )


async def test_sync_account_upserts_in_one_gather(monkeypatch):
    acc = _account("u1")
    started = 0
    max_inflight = 0
    inflight = 0
    release = asyncio.Event()
    c1, c2 = uuid4(), uuid4()

    async def fake_fetch(account):
        return [
            {"campaign_id": str(c1), "date": date.today(), "impressions": 1},
            {"campaign_id": str(c2), "date": date.today(), "impressions": 2},
        ]

    async def slow_upsert(**kwargs):
        nonlocal started, max_inflight, inflight
        started += 1
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        n = started
        if n < 2:
            await release.wait()
        else:
            release.set()
        inflight -= 1

    monkeypatch.setattr(ad_workflows.ads_repo, "upsert_metrics", slow_upsert)
    n = await ad_workflows.sync_account_metrics(
        user_id="u1", account_id=acc.id, account=acc, fetch_fn=fake_fetch
    )
    assert n == 2
    assert started == 2
    assert max_inflight == 2
