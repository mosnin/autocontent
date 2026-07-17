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


# --------------------------------------------------------------------------- _composio_metrics


def _account(**kw):
    from marketer.repos.ads import AdAccount
    base = dict(
        id=uuid4(), user_id="u1", platform="google_ads", external_account_id="",
        name="", composio_connection_id="conn-1", status="active", currency="USD",
        daily_cap_usd=None, monthly_cap_usd=None, killswitch=False, last_error="",
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdAccount(**base)


async def test_composio_metrics_empty_when_disabled(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", False)
    rows = await ad_workflows._composio_metrics(_account())
    assert rows == []


async def test_composio_metrics_empty_without_external_campaigns(monkeypatch):
    from marketer.config import settings
    import marketer.repos.ads as ads_repo

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "sk_test")

    async def _list_campaigns(user_id, *, ad_account_id=None, limit=100):
        return [_campaign()]  # external_campaign_id == "" by default

    monkeypatch.setattr(ads_repo, "list_campaigns", _list_campaigns)
    rows = await ad_workflows._composio_metrics(_account())
    assert rows == []


async def test_composio_metrics_maps_external_id_to_internal(monkeypatch):
    from marketer.config import settings
    import marketer.repos.ads as ads_repo
    from marketer.services import composio_client

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "sk_test")
    camp = _campaign(daily=Decimal("10"))
    camp = camp.model_copy(update={"external_campaign_id": "ext-1"})

    async def _list_campaigns(user_id, *, ad_account_id=None, limit=100):
        return [camp]

    def _fetch_metrics(**kwargs):
        return [{
            "campaign_id": "ext-1", "date": "2026-07-16", "impressions": 100,
            "clicks": 10, "spend_usd": "5.00", "conversions": 1, "revenue_usd": "20.00",
        }]

    monkeypatch.setattr(ads_repo, "list_campaigns", _list_campaigns)
    monkeypatch.setattr(composio_client, "fetch_metrics", _fetch_metrics)
    rows = await ad_workflows._composio_metrics(_account())
    assert len(rows) == 1
    assert rows[0]["campaign_id"] == str(camp.id)
    assert rows[0]["spend_usd"] == "5.00"


async def test_composio_metrics_degrades_on_platform_error(monkeypatch):
    from marketer.config import settings
    import marketer.repos.ads as ads_repo
    from marketer.services import composio_client

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "sk_test")
    camp = _campaign().model_copy(update={"external_campaign_id": "ext-1"})

    async def _list_campaigns(user_id, *, ad_account_id=None, limit=100):
        return [camp]

    def _fetch_metrics(**kwargs):
        raise composio_client.ComposioCallError("boom")

    monkeypatch.setattr(ads_repo, "list_campaigns", _list_campaigns)
    monkeypatch.setattr(composio_client, "fetch_metrics", _fetch_metrics)
    rows = await ad_workflows._composio_metrics(_account())
    assert rows == []


# --------------------------------------------------------------------------- optimize_campaign


def _fake_strategist_result(rec):
    class _Result:
        def final_output_as(self, cls):
            return rec

    return _Result()


def _patch_strategist(monkeypatch, rec):
    from marketer.agents import metered

    async def _run(agent, input):  # noqa: A002
        return _fake_strategist_result(rec)

    monkeypatch.setattr(metered.Runner, "run", staticmethod(_run))


async def test_optimize_campaign_clamps_large_increase(monkeypatch):
    """Strategist asks for +$50 on a $10 budget; hard-clamped to +20% ($2)."""
    from marketer.agents.ads_strategist import StrategistRecommendation
    import marketer.repos.ads as ads_repo

    camp = _campaign(daily=Decimal("10"))

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _campaign_metrics(cid, *, user_id, limit=90):
        return _metrics(10, 40)

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "campaign_metrics", _campaign_metrics)
    _patch_strategist(
        monkeypatch,
        StrategistRecommendation(
            action="budget_change", budget_delta_usd=50.0, rationale="strong ROAS"
        ),
    )

    captured = {}

    async def _propose(**kwargs):
        captured.update(kwargs)
        return {"status": "executed", "campaign": {}}

    monkeypatch.setattr(ad_workflows, "propose_budget_change", _propose)

    out = await ad_workflows.optimize_campaign(user_id="u1", campaign_id=camp.id)
    assert out["status"] == "executed"
    assert out["rationale"] == "strong ROAS"
    assert captured["new_daily_budget_usd"] == Decimal("12")  # 10 + min(50, 0.2*10)


async def test_optimize_campaign_clamps_large_decrease_and_floors_at_one_dollar(monkeypatch):
    """Strategist asks for -$9 on a $2 budget; clamped to -20% ($0.40) would
    give $1.60, but the floor of $1 only bites when the clamped result itself
    would go below $1 — verify the floor never lets the budget hit $0."""
    from marketer.agents.ads_strategist import StrategistRecommendation
    import marketer.repos.ads as ads_repo

    camp = _campaign(daily=Decimal("2"))

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _campaign_metrics(cid, *, user_id, limit=90):
        return _metrics(10, 1)

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "campaign_metrics", _campaign_metrics)
    _patch_strategist(
        monkeypatch,
        StrategistRecommendation(
            action="budget_change", budget_delta_usd=-9.0, rationale="bleeding spend"
        ),
    )

    captured = {}

    async def _propose(**kwargs):
        captured.update(kwargs)
        return {"status": "executed", "campaign": {}}

    monkeypatch.setattr(ad_workflows, "propose_budget_change", _propose)

    await ad_workflows.optimize_campaign(user_id="u1", campaign_id=camp.id)
    # clamp: -20% of $2 = -$0.40 -> 2 - 0.40 = 1.60, still >= floor of $1.
    assert captured["new_daily_budget_usd"] == Decimal("1.60")


async def test_optimize_campaign_pause_routes_through_apply_status_change(monkeypatch):
    from marketer.agents.ads_strategist import StrategistRecommendation
    import marketer.repos.ads as ads_repo

    camp = _campaign(daily=Decimal("10"))

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _campaign_metrics(cid, *, user_id, limit=90):
        return _metrics(10, 0)

    async def _get_account(aid, *, user_id):
        return _account()

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "campaign_metrics", _campaign_metrics)
    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    _patch_strategist(
        monkeypatch,
        StrategistRecommendation(action="pause", rationale="no conversions in 14d"),
    )

    calls = []

    async def _apply_status(**kwargs):
        calls.append(kwargs)
        return camp.model_copy(update={"status": "paused"})

    monkeypatch.setattr(ad_workflows, "apply_status_change", _apply_status)

    out = await ad_workflows.optimize_campaign(user_id="u1", campaign_id=camp.id)
    assert out["status"] == "executed"
    assert out["action"] == "pause"
    assert len(calls) == 1
    assert calls[0]["new_status"] == "paused"


async def test_optimize_campaign_no_change_from_strategist(monkeypatch):
    from marketer.agents.ads_strategist import StrategistRecommendation
    import marketer.repos.ads as ads_repo

    camp = _campaign(daily=Decimal("10"))

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _campaign_metrics(cid, *, user_id, limit=90):
        return _metrics(10, 15)

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "campaign_metrics", _campaign_metrics)
    _patch_strategist(
        monkeypatch,
        StrategistRecommendation(action="no_change", rationale="mixed signal"),
    )

    out = await ad_workflows.optimize_campaign(user_id="u1", campaign_id=camp.id)
    assert out == {"status": "no_change", "rationale": "mixed signal"}


async def test_optimize_campaign_falls_back_to_rules_when_strategist_errors(monkeypatch):
    """The strategist call raising for any reason must not surface as an
    error — optimization degrades to the original ROAS rule."""
    from marketer.agents import metered
    import marketer.repos.ads as ads_repo

    camp = _campaign(daily=Decimal("10"))

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _campaign_metrics(cid, *, user_id, limit=90):
        return _metrics(10, 40)  # ROAS 4 >= target 2 -> rule scales up to $12.00

    async def _run(agent, input):  # noqa: A002
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "campaign_metrics", _campaign_metrics)
    monkeypatch.setattr(metered.Runner, "run", staticmethod(_run))

    captured = {}

    async def _propose(**kwargs):
        captured.update(kwargs)
        return {"status": "executed", "campaign": {}}

    monkeypatch.setattr(ad_workflows, "propose_budget_change", _propose)

    out = await ad_workflows.optimize_campaign(user_id="u1", campaign_id=camp.id)
    assert out["status"] == "executed"
    assert captured["new_daily_budget_usd"] == Decimal("12.00")


async def test_optimize_campaign_skips_strategist_without_metrics(monkeypatch):
    import marketer.repos.ads as ads_repo
    from marketer.agents import metered

    camp = _campaign(daily=Decimal("10"))
    calls = []

    async def _get_campaign(cid, *, user_id):
        return camp

    async def _campaign_metrics(cid, *, user_id, limit=90):
        return []

    async def _run(agent, input):  # noqa: A002
        calls.append(input)
        raise AssertionError("strategist must not be called without metrics")

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "campaign_metrics", _campaign_metrics)
    monkeypatch.setattr(metered.Runner, "run", staticmethod(_run))

    out = await ad_workflows.optimize_campaign(user_id="u1", campaign_id=camp.id)
    assert out == {"status": "no_change"}
    assert calls == []
