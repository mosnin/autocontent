"""Unit tests for services/ad_experiments.py — config validation, creative A/B
winner selection, and budget-ramp math (step caps, target clamp, approval-
pause idempotency, hard-deny handling), and the disabled/no-op contract.

Everything is monkeypatched (repos/ad_experiments, repos/ads, repos/
ad_actions, repos/ad_approvals) with small in-memory fakes — no real
Postgres, no real Composio, no real spend. This mirrors the style of
tests/test_ad_actions_exec.py, the safe-execute layer these experiments
route every mutation through."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from marketer.repos import ad_experiments as experiments_repo
from marketer.repos.ad_approvals import AdApproval
from marketer.repos.ad_experiments import AdExperiment, AdExperimentArm
from marketer.repos.ads import AdAccount, AdCampaign, AdCreative, AdMetricsDaily
from marketer.services import ad_experiments as svc


# --------------------------------------------------------------------------- fixtures / fakes

def _account(**kw) -> AdAccount:
    base = dict(
        id=uuid4(), user_id="u1", platform="google_ads", external_account_id="",
        name="", composio_connection_id="conn_abc", status="active", currency="USD",
        daily_cap_usd=None, monthly_cap_usd=None, killswitch=False, last_error="",
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdAccount(**base)


def _campaign(**kw) -> AdCampaign:
    base = dict(
        id=uuid4(), user_id="u1", ad_account_id=uuid4(), external_campaign_id="",
        name="Launch", objective="conversions", status="active",
        daily_budget_usd=Decimal("10"), lifetime_budget_usd=None, niche_id=None,
        last_error="", created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdCampaign(**base)


def _creative(campaign_id: UUID, **kw) -> AdCreative:
    base = dict(
        id=uuid4(), user_id="u1", campaign_id=campaign_id, external_id="",
        kind="text", source_job_id=None, source_article_id=None,
        headline="Headline", body="Body", media_path="", cta="Shop now",
        status="draft", created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return AdCreative(**base)


class _ExperimentStore:
    """In-memory fake for repos/ad_experiments.py so service logic can be
    exercised without a real database."""

    def __init__(self) -> None:
        self.experiments: dict[UUID, AdExperiment] = {}
        self.arms: dict[UUID, AdExperimentArm] = {}


def _install_fake_experiments_repo(monkeypatch) -> _ExperimentStore:
    store = _ExperimentStore()

    async def create_experiment(*, user_id, campaign_id, kind, config):
        exp = AdExperiment(
            id=uuid4(), user_id=user_id, campaign_id=campaign_id, kind=kind,
            status="draft", config=config, result={},
            created_at=datetime.now(timezone.utc),
        )
        store.experiments[exp.id] = exp
        return exp

    async def get_experiment(experiment_id, *, user_id):
        exp = store.experiments.get(experiment_id)
        return exp if exp is not None and exp.user_id == user_id else None

    async def update_experiment(experiment_id, *, user_id, **kwargs):
        exp = store.experiments.get(experiment_id)
        if exp is None or exp.user_id != user_id:
            return None
        data = exp.model_dump()
        data.update(kwargs)
        updated = AdExperiment(**data)
        store.experiments[experiment_id] = updated
        return updated

    async def create_arm(*, experiment_id, creative_id, label=""):
        arm = AdExperimentArm(
            id=uuid4(), experiment_id=experiment_id, creative_id=creative_id,
            label=label, metrics={}, is_winner=False,
            created_at=datetime.now(timezone.utc),
        )
        store.arms[arm.id] = arm
        return arm

    async def list_arms(experiment_id):
        return [a for a in store.arms.values() if a.experiment_id == experiment_id]

    async def update_arm(arm_id, **kwargs):
        arm = store.arms.get(arm_id)
        if arm is None:
            return None
        data = arm.model_dump()
        data.update(kwargs)
        updated = AdExperimentArm(**data)
        store.arms[arm_id] = updated
        return updated

    monkeypatch.setattr(experiments_repo, "create_experiment", create_experiment)
    monkeypatch.setattr(experiments_repo, "get_experiment", get_experiment)
    monkeypatch.setattr(experiments_repo, "update_experiment", update_experiment)
    monkeypatch.setattr(experiments_repo, "create_arm", create_arm)
    monkeypatch.setattr(experiments_repo, "list_arms", list_arms)
    monkeypatch.setattr(experiments_repo, "update_arm", update_arm)
    return store


def _wire_ads_repo(
    monkeypatch, *, account: AdAccount, campaign: AdCampaign, creatives=None, metrics=None,
):
    """Monkeypatch repos/ads.py the way test_ad_actions_exec.py does, plus a
    mutable campaign store so update_campaign (called by the safe-execute
    layer during an executed step) is visible to the next get_campaign."""
    import marketer.repos.ads as ads_repo

    campaigns = {campaign.id: campaign}
    creatives = creatives or []
    metrics = metrics or []

    async def _get_account(account_id, *, user_id):
        return account

    async def _get_campaign(cid, *, user_id):
        return campaigns.get(cid)

    async def _committed(**kw):
        return Decimal("0")

    async def _spend(*a, **kw):
        return Decimal("0")

    async def _update_campaign(cid, *, user_id, **kw):
        current = campaigns[cid]
        data = current.model_dump()
        data.update(kw)
        updated = AdCampaign(**data)
        campaigns[cid] = updated
        return updated

    async def _list_creatives(user_id, *, campaign_id=None):
        return [c for c in creatives if campaign_id is None or c.campaign_id == campaign_id]

    async def _campaign_metrics(campaign_id, *, user_id, limit=90):
        return list(metrics)

    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)
    monkeypatch.setattr(ads_repo, "active_daily_budget_total", _committed)
    monkeypatch.setattr(ads_repo, "account_spend_on", _spend)
    monkeypatch.setattr(ads_repo, "account_spend_between", _spend)
    monkeypatch.setattr(ads_repo, "update_campaign", _update_campaign)
    monkeypatch.setattr(ads_repo, "list_creatives", _list_creatives)
    monkeypatch.setattr(ads_repo, "campaign_metrics", _campaign_metrics)
    return campaigns


def _noop_ad_actions(monkeypatch):
    import marketer.repos.ad_actions as ad_actions

    async def _record(**kw):
        from marketer.repos.ad_actions import AdActionEntry
        return AdActionEntry(
            id=1, user_id=kw.get("user_id", "u1"), actor=kw.get("actor", "agent"),
            actor_email=kw.get("actor_email", ""), action=kw.get("action", ""),
            platform=kw.get("platform", ""), target_type=kw.get("target_type", ""),
            target_id=kw.get("target_id", ""),
            dollar_delta_usd=kw.get("dollar_delta_usd", Decimal("0")),
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(ad_actions, "record", _record)


def _wire_approvals(monkeypatch):
    """In-memory fake for repos/ad_approvals.py's create()/get() — enough
    for propose_budget_change's approval path and advance()'s re-check."""
    import marketer.repos.ad_approvals as ad_approvals

    store: dict[UUID, AdApproval] = {}

    async def _create(**kwargs):
        approval = AdApproval(
            id=uuid4(), user_id=kwargs.get("user_id", "u1"),
            ad_account_id=kwargs.get("ad_account_id"), campaign_id=kwargs.get("campaign_id"),
            action=kwargs.get("action", ""), summary=kwargs.get("summary", ""),
            dollar_delta_usd=kwargs.get("dollar_delta_usd", Decimal("0")),
            payload=kwargs.get("payload", {}), status="pending",
            requested_by=kwargs.get("requested_by", "agent"),
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )
        store[approval.id] = approval
        return approval

    async def _get(approval_id, *, user_id):
        return store.get(approval_id)

    monkeypatch.setattr(ad_approvals, "create", _create)
    monkeypatch.setattr(ad_approvals, "get", _get)
    return store


@pytest.fixture(autouse=True)
def _enable_ads(monkeypatch):
    """Most tests want the feature ON; the no-op tests explicitly flip these
    back off."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_experiments_enabled", True)
    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "ads_approval_threshold_usd", 50.0)


# --------------------------------------------------------------------------- validate_config

def test_validate_config_creative_ab_valid():
    ids = [str(uuid4()), str(uuid4())]
    out = svc.validate_config("creative_ab", {"creative_ids": ids})
    assert out["creative_ids"] == ids
    assert out["window_days"] == svc.DEFAULT_WINDOW_DAYS


@pytest.mark.parametrize("n", [0, 1, 5])
def test_validate_config_creative_ab_bad_arm_count(n):
    ids = [str(uuid4()) for _ in range(n)]
    with pytest.raises(svc.ExperimentConfigError):
        svc.validate_config("creative_ab", {"creative_ids": ids})


def test_validate_config_creative_ab_bad_uuid():
    with pytest.raises(svc.ExperimentConfigError):
        svc.validate_config("creative_ab", {"creative_ids": ["not-a-uuid", str(uuid4())]})


def test_validate_config_creative_ab_duplicate_ids():
    cid = str(uuid4())
    with pytest.raises(svc.ExperimentConfigError):
        svc.validate_config("creative_ab", {"creative_ids": [cid, cid]})


def test_validate_config_budget_ramp_valid():
    out = svc.validate_config(
        "budget_ramp",
        {"target_daily_usd": 100, "step_pct": 15, "interval_days": 3},
    )
    assert out == {"target_daily_usd": "100", "step_pct": "15", "interval_days": 3}


def test_validate_config_budget_ramp_step_pct_over_cap_rejected():
    with pytest.raises(svc.ExperimentConfigError):
        svc.validate_config(
            "budget_ramp",
            {"target_daily_usd": 100, "step_pct": 25, "interval_days": 3},
        )


def test_validate_config_budget_ramp_step_pct_at_cap_allowed():
    out = svc.validate_config(
        "budget_ramp",
        {"target_daily_usd": 100, "step_pct": 20, "interval_days": 3},
    )
    assert out["step_pct"] == "20"


def test_validate_config_budget_ramp_missing_fields():
    with pytest.raises(svc.ExperimentConfigError):
        svc.validate_config("budget_ramp", {"target_daily_usd": 100})


def test_validate_config_budget_ramp_non_positive_target():
    with pytest.raises(svc.ExperimentConfigError):
        svc.validate_config(
            "budget_ramp", {"target_daily_usd": 0, "step_pct": 10, "interval_days": 1}
        )


def test_validate_config_unknown_kind():
    with pytest.raises(svc.ExperimentConfigError):
        svc.validate_config("not_a_kind", {})


# --------------------------------------------------------------------------- create_experiment

async def test_create_experiment_creative_ab_creates_arms(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign()
    acc = _account()
    creatives = [_creative(camp.id), _creative(camp.id)]
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp, creatives=creatives)

    exp = await svc.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(c.id) for c in creatives]},
    )
    assert exp.status == "draft"
    arms = await experiments_repo.list_arms(exp.id)
    assert {a.creative_id for a in arms} == {c.id for c in creatives}


async def test_create_experiment_creative_ab_unknown_creative_raises(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign()
    acc = _account()
    known = [_creative(camp.id)]
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp, creatives=known)

    with pytest.raises(svc.ExperimentConfigError):
        await svc.create_experiment(
            user_id="u1", campaign_id=camp.id, kind="creative_ab",
            config={"creative_ids": [str(known[0].id), str(uuid4())]},
        )


async def test_create_experiment_campaign_not_found_raises(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    import marketer.repos.ads as ads_repo

    async def _get_campaign(cid, *, user_id):
        return None

    monkeypatch.setattr(ads_repo, "get_campaign", _get_campaign)

    with pytest.raises(svc.ExperimentNotFound):
        await svc.create_experiment(
            user_id="u1", campaign_id=uuid4(), kind="budget_ramp",
            config={"target_daily_usd": 100, "step_pct": 10, "interval_days": 1},
        )


# --------------------------------------------------------------------------- start

async def test_start_requires_active_campaign(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(status="draft")
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "100", "step_pct": "10", "interval_days": 1},
    )
    with pytest.raises(svc.ExperimentStateError):
        await svc.start(exp.id, user_id="u1")


async def test_start_sets_running_and_seeds_bookkeeping(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(status="active")
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "100", "step_pct": "10", "interval_days": 1},
    )
    started = await svc.start(exp.id, user_id="u1")
    assert started.status == "running"
    assert started.started_at is not None
    assert started.result["pending_approval_id"] is None
    assert started.result["steps"] == []


async def test_start_idempotent_when_already_running(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(status="active")
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "100", "step_pct": "10", "interval_days": 1},
    )
    first = await svc.start(exp.id, user_id="u1")
    second = await svc.start(exp.id, user_id="u1")
    assert second.status == "running"
    assert second.started_at == first.started_at


async def test_start_noop_when_ads_disabled(monkeypatch):
    from marketer.config import settings

    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(status="active")
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    monkeypatch.setattr(settings, "ads_enabled", False)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "100", "step_pct": "10", "interval_days": 1},
    )
    unchanged = await svc.start(exp.id, user_id="u1")
    assert unchanged.status == "draft"


async def test_start_noop_when_experiments_disabled(monkeypatch):
    from marketer.config import settings

    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(status="active")
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    monkeypatch.setattr(settings, "ads_experiments_enabled", False)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "100", "step_pct": "10", "interval_days": 1},
    )
    unchanged = await svc.start(exp.id, user_id="u1")
    assert unchanged.status == "draft"


# --------------------------------------------------------------------------- evaluate (creative A/B)

def _daily(d: date, *, impressions=0, clicks=0, spend=Decimal("0"), revenue=Decimal("0")):
    return AdMetricsDaily(
        date=d, impressions=impressions, clicks=clicks, spend_usd=spend,
        conversions=Decimal("0"), revenue_usd=revenue,
    )


async def test_evaluate_wrong_kind_raises(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign()
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "100", "step_pct": "10", "interval_days": 1},
    )
    with pytest.raises(svc.ExperimentStateError):
        await svc.evaluate(exp.id, user_id="u1")


async def test_evaluate_noop_when_disabled(monkeypatch):
    from marketer.config import settings

    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign()
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(uuid4()), str(uuid4())], "window_days": 2},
    )
    monkeypatch.setattr(settings, "ads_experiments_enabled", False)
    unchanged = await svc.evaluate(exp.id, user_id="u1")
    assert unchanged.status == "draft"


async def test_evaluate_picks_winner_on_higher_roas(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    camp = _campaign(external_campaign_id="")  # local — apply_status_change stays local
    acc = _account()
    creatives = [_creative(camp.id, headline="A"), _creative(camp.id, headline="B")]

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(c.id) for c in creatives], "window_days": 2},
    )
    arm_a = await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[0].id, label="A")
    arm_b = await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[1].id, label="B")
    started_at = datetime.now(timezone.utc) - timedelta(days=5)
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running", started_at=started_at,
        result={"rotation_index": 0, "last_attributed_date": None},
    )

    start_date = started_at.date()
    # Round-robin: day0/day2 -> arm_a (high ROAS), day1/day3 -> arm_b (low ROAS).
    metrics = [
        _daily(start_date, impressions=1000, clicks=50, spend=Decimal("10"), revenue=Decimal("30")),
        _daily(start_date + timedelta(days=1), impressions=1000, clicks=50, spend=Decimal("10"), revenue=Decimal("5")),
        _daily(start_date + timedelta(days=2), impressions=1000, clicks=50, spend=Decimal("10"), revenue=Decimal("30")),
        _daily(start_date + timedelta(days=3), impressions=1000, clicks=50, spend=Decimal("10"), revenue=Decimal("5")),
    ]
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp, metrics=metrics)

    result = await svc.evaluate(exp.id, user_id="u1")
    assert result.status == "completed"
    assert result.result["winner_arm_id"] == str(arm_a.id)

    arms = await experiments_repo.list_arms(exp.id)
    winner = next(a for a in arms if a.id == arm_a.id)
    loser = next(a for a in arms if a.id == arm_b.id)
    assert winner.is_winner is True
    assert loser.is_winner is False
    assert winner.metrics["days_attributed"] == 2
    assert Decimal(winner.metrics["spend_usd"]) == Decimal("20")


async def test_evaluate_not_ready_before_window_elapses(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    camp = _campaign(external_campaign_id="")
    acc = _account()
    creatives = [_creative(camp.id), _creative(camp.id)]

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(c.id) for c in creatives], "window_days": 7},
    )
    await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[0].id)
    await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[1].id)
    started_at = datetime.now(timezone.utc) - timedelta(days=2)
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running", started_at=started_at,
        result={"rotation_index": 0, "last_attributed_date": None},
    )

    start_date = started_at.date()
    metrics = [
        _daily(start_date, impressions=100, clicks=5, spend=Decimal("5"), revenue=Decimal("10")),
        _daily(start_date + timedelta(days=1), impressions=100, clicks=5, spend=Decimal("5"), revenue=Decimal("10")),
    ]
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp, metrics=metrics)

    result = await svc.evaluate(exp.id, user_id="u1")
    assert result.status == "running"
    assert "winner_arm_id" not in result.result


async def test_evaluate_is_idempotent_on_repeat_call_with_no_new_metrics(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    camp = _campaign(external_campaign_id="")
    acc = _account()
    creatives = [_creative(camp.id), _creative(camp.id)]

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(c.id) for c in creatives], "window_days": 7},
    )
    await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[0].id)
    await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[1].id)
    started_at = datetime.now(timezone.utc) - timedelta(days=2)
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running", started_at=started_at,
        result={"rotation_index": 0, "last_attributed_date": None},
    )
    start_date = started_at.date()
    metrics = [
        _daily(start_date, impressions=100, clicks=5, spend=Decimal("5"), revenue=Decimal("10")),
    ]
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp, metrics=metrics)

    first = await svc.evaluate(exp.id, user_id="u1")
    second = await svc.evaluate(exp.id, user_id="u1")
    assert first.result == second.result  # no double-attribution of the same day


async def test_evaluate_catastrophic_roas_safety_pauses_campaign(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    camp = _campaign(external_campaign_id="", status="active")
    acc = _account()
    creatives = [_creative(camp.id), _creative(camp.id)]

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(c.id) for c in creatives], "window_days": 7},
    )
    await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[0].id)
    await experiments_repo.create_arm(experiment_id=exp.id, creative_id=creatives[1].id)
    started_at = datetime.now(timezone.utc) - timedelta(days=1)
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running", started_at=started_at,
        result={"rotation_index": 0, "last_attributed_date": None},
    )
    start_date = started_at.date()
    # $30 spend, $1 revenue -> ROAS ~0.033, well under CATASTROPHIC_ROAS (0.2)
    # and over CATASTROPHIC_MIN_SPEND_USD (20).
    metrics = [
        _daily(start_date, impressions=1000, clicks=10, spend=Decimal("30"), revenue=Decimal("1")),
    ]
    campaigns = _wire_ads_repo(monkeypatch, account=acc, campaign=camp, metrics=metrics)

    result = await svc.evaluate(exp.id, user_id="u1")
    assert result.status == "cancelled"
    assert result.result["safety_paused"] is True
    assert campaigns[camp.id].status == "paused"


# --------------------------------------------------------------------------- advance (budget ramp)

async def test_advance_wrong_kind_raises(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign()
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(uuid4()), str(uuid4())]},
    )
    with pytest.raises(svc.ExperimentStateError):
        await svc.advance(exp.id, user_id="u1")


async def test_advance_noop_when_disabled(monkeypatch):
    from marketer.config import settings

    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("100"))
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "200", "step_pct": "10", "interval_days": 1},
    )
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": None, "steps": [], "pending_approval_id": None},
    )
    monkeypatch.setattr(settings, "ads_enabled", False)
    unchanged = await svc.advance(exp.id, user_id="u1")
    assert unchanged.result["steps"] == []


async def test_advance_step_capped_by_step_pct_and_executes_immediately(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    _wire_approvals(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("100"))
    acc = _account()
    campaigns = _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "200", "step_pct": "10", "interval_days": 1},
    )
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": None, "steps": [], "pending_approval_id": None},
    )

    calls = []

    async def fake_apply(campaign_obj, new_budget):
        calls.append(new_budget)
        return {"applied": "stub"}

    updated = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert calls == [Decimal("110.00")]  # 100 * 10% step, under the $50 approval threshold
    assert updated.status == "running"  # 110 < target 200
    assert campaigns[camp.id].daily_budget_usd == Decimal("110.00")
    assert len(updated.result["steps"]) == 1
    assert updated.result["last_step_at"] is not None


async def test_advance_clamps_step_to_target_and_completes(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    _wire_approvals(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("190"))
    acc = _account()
    campaigns = _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "200", "step_pct": "20", "interval_days": 1},
    )
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": None, "steps": [], "pending_approval_id": None},
    )

    calls = []

    async def fake_apply(campaign_obj, new_budget):
        calls.append(new_budget)
        return {"applied": "stub"}

    updated = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    # 190 * 20% = 38 -> 228, clamped to the 200 target, never exceeding it.
    assert calls == [Decimal("200.00")]
    assert updated.status == "completed"
    assert updated.completed_at is not None
    assert campaigns[camp.id].daily_budget_usd == Decimal("200.00")


async def test_advance_already_at_target_completes_without_calling_apply_fn(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("200"))
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "200", "step_pct": "10", "interval_days": 1},
    )
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": None, "steps": [], "pending_approval_id": None},
    )

    calls = []

    async def fake_apply(campaign_obj, new_budget):
        calls.append(new_budget)
        return {"applied": "stub"}

    updated = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert calls == []
    assert updated.status == "completed"


async def test_advance_interval_not_elapsed_is_noop(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("100"))
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "200", "step_pct": "10", "interval_days": 7},
    )
    recent = datetime.now(timezone.utc).isoformat()
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": recent, "steps": ["placeholder"], "pending_approval_id": None},
    )

    calls = []

    async def fake_apply(campaign_obj, new_budget):
        calls.append(new_budget)
        return {"applied": "stub"}

    updated = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert calls == []
    assert updated.result["steps"] == ["placeholder"]  # untouched


async def test_advance_pending_approval_pauses_ramp_and_is_idempotent(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    approvals = _wire_approvals(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("1000"))
    acc = _account()
    campaigns = _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        # 1000 * 20% = 200 -> next 1100, clamped to target -> delta 100 >= $50 threshold
        config={"target_daily_usd": "1100", "step_pct": "20", "interval_days": 1},
    )
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": None, "steps": [], "pending_approval_id": None},
    )

    calls = []

    async def fake_apply(campaign_obj, new_budget):
        calls.append(new_budget)
        return {"applied": "stub"}

    first = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert calls == []  # parked for approval, never applied
    assert first.status == "running"
    approval_id = UUID(first.result["pending_approval_id"])
    assert len(first.result["steps"]) == 1
    assert first.result["steps"][0]["status"] == "pending_approval"

    # Re-checking while still pending is a pure no-op — no duplicate approval,
    # no duplicate step, no apply_fn call.
    second = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert calls == []
    assert second.result["pending_approval_id"] == str(approval_id)
    assert len(second.result["steps"]) == 1

    # A human approves elsewhere (routes/ads.py POST /approvals/{id}/decide,
    # which executes the change for real) — simulate that outcome here: the
    # approval flips to executed and the campaign's budget reflects the step.
    approvals[approval_id] = approvals[approval_id].model_copy(update={"status": "executed"})
    campaigns[camp.id] = campaigns[camp.id].model_copy(update={"daily_budget_usd": Decimal("1100")})

    third = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert third.result["pending_approval_id"] is None
    assert third.status == "completed"  # 1100 already meets the 1100 target
    assert calls == []  # completion short-circuits before calling apply_fn again


async def test_advance_rejected_approval_cancels_ramp(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    approvals = _wire_approvals(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("1000"))
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "1100", "step_pct": "20", "interval_days": 1},
    )
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": None, "steps": [], "pending_approval_id": None},
    )

    async def fake_apply(campaign_obj, new_budget):
        return {"applied": "stub"}

    first = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    approval_id = UUID(first.result["pending_approval_id"])
    approvals[approval_id] = approvals[approval_id].model_copy(update={"status": "rejected"})

    second = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert second.status == "cancelled"
    assert "rejected" in second.result["cancelled_reason"]


async def test_advance_hard_deny_cancels_ramp(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    _noop_ad_actions(monkeypatch)
    camp = _campaign(daily_budget_usd=Decimal("100"))
    acc = _account(killswitch=True)  # denies any spend growth
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)

    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "200", "step_pct": "10", "interval_days": 1},
    )
    exp = await experiments_repo.update_experiment(
        exp.id, user_id="u1", status="running",
        result={"last_step_at": None, "steps": [], "pending_approval_id": None},
    )

    async def fake_apply(campaign_obj, new_budget):
        return {"applied": "stub"}

    updated = await svc.advance(exp.id, user_id="u1", apply_fn=fake_apply)
    assert updated.status == "cancelled"
    assert "denied" in updated.result["cancelled_reason"]


# --------------------------------------------------------------------------- cancel

async def test_cancel_is_idempotent(monkeypatch):
    _install_fake_experiments_repo(monkeypatch)
    camp = _campaign()
    acc = _account()
    _wire_ads_repo(monkeypatch, account=acc, campaign=camp)
    exp = await experiments_repo.create_experiment(
        user_id="u1", campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": "100", "step_pct": "10", "interval_days": 1},
    )
    first = await svc.cancel(exp.id, user_id="u1")
    assert first.status == "cancelled"
    second = await svc.cancel(exp.id, user_id="u1")
    assert second.status == "cancelled"
    assert second.completed_at == first.completed_at
