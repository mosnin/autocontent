"""Ad workflow logic + Inngest mount gating. The optimization policy and the
budget recommendation are pure/injectable and tested here; the Inngest mount is
verified to be a clean no-op when disabled."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

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
