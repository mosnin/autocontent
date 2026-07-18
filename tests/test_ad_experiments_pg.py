"""Real-Postgres integration tests for the ads-experiments data layer
(migration 0025) and the service functions that drive it end to end against
an actual database — including a budget-ramp step running through the REAL
AdSpendGuard (only the platform apply_fn is stubbed, so no real spend
occurs) and a creative A/B evaluation over real ad_metrics_daily rows.

Skip without MARKETER_DATABASE_URL. Against the local dev Postgres:
  MARKETER_DATABASE_URL=postgresql://postgres@127.0.0.1:5599/marketer_test
(apply db/migrations/0025_ad_experiments.sql first)."""
from __future__ import annotations

import os
from datetime import timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    p = await db.get_pool()
    yield p
    async with p.acquire() as conn:
        await conn.execute("delete from users")
        await conn.execute("delete from ad_actions_log")
    # Explicitly close (rather than leaving it for GC, which — per
    # conftest.py's _reset_db_pool — can otherwise finalize on a LATER
    # test's event loop and race that test's own connections against this
    # module's real Postgres). Closing here is a purely local, additive
    # safeguard; db._pool is unconditionally reset by the next test's
    # autouse fixture regardless.
    await p.close()
    db._pool = None


async def _mkuser(pool) -> str:
    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )
    return uid


async def _mksetup(pool, *, daily_budget=None, campaign_status="active", killswitch=False):
    from marketer.repos import ads

    uid = await _mkuser(pool)
    acc = await ads.create_account(
        user_id=uid, platform="google_ads", external_account_id="x", status="active",
    )
    if killswitch:
        await ads.set_account_governance(acc.id, user_id=uid, killswitch=True)
    camp = await ads.create_campaign(
        user_id=uid, ad_account_id=acc.id, name="C", status=campaign_status,
        daily_budget_usd=Decimal(str(daily_budget)) if daily_budget is not None else None,
    )
    return uid, acc, camp


# --------------------------------------------------------------------------- repo CRUD

async def test_experiment_and_arm_crud(pool):
    from marketer.repos import ad_experiments as experiments_repo
    from marketer.repos import ads

    uid, acc, camp = await _mksetup(pool)
    creative = await ads.create_creative(user_id=uid, campaign_id=camp.id, headline="H")

    exp = await experiments_repo.create_experiment(
        user_id=uid, campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(creative.id)], "window_days": 7},
    )
    assert exp.status == "draft"
    assert exp.result == {}

    fetched = await experiments_repo.get_experiment(exp.id, user_id=uid)
    assert fetched is not None and fetched.id == exp.id

    arm = await experiments_repo.create_arm(
        experiment_id=exp.id, creative_id=creative.id, label="H"
    )
    arms = await experiments_repo.list_arms(exp.id)
    assert [a.id for a in arms] == [arm.id]

    updated_arm = await experiments_repo.update_arm(
        arm.id, metrics={"clicks": 10}, is_winner=True
    )
    assert updated_arm.metrics == {"clicks": 10}
    assert updated_arm.is_winner is True

    updated_exp = await experiments_repo.update_experiment(
        exp.id, user_id=uid, status="completed", result={"winner_arm_id": str(arm.id)},
    )
    assert updated_exp.status == "completed"
    assert updated_exp.result == {"winner_arm_id": str(arm.id)}

    listed = await experiments_repo.list_experiments(uid, campaign_id=camp.id)
    assert [e.id for e in listed] == [exp.id]

    # Deleting the user cascades away the experiment and its arm.
    await pool.execute("delete from users where id = $1", uid)
    assert await experiments_repo.get_experiment(exp.id, user_id=uid) is None


async def test_arm_creative_set_null_on_creative_delete(pool):
    """ad_experiment_arms.creative_id is ON DELETE SET NULL — deleting the
    underlying creative must not delete the arm's accumulated metrics."""
    from marketer.repos import ad_experiments as experiments_repo
    from marketer.repos import ads

    uid, acc, camp = await _mksetup(pool)
    creative = await ads.create_creative(user_id=uid, campaign_id=camp.id, headline="H")
    exp = await experiments_repo.create_experiment(
        user_id=uid, campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(creative.id)]},
    )
    arm = await experiments_repo.create_arm(
        experiment_id=exp.id, creative_id=creative.id, label="H"
    )
    await pool.execute("delete from ad_creatives where id = $1", creative.id)
    arms = await experiments_repo.list_arms(exp.id)
    assert arms[0].id == arm.id
    assert arms[0].creative_id is None


# --------------------------------------------------------------------------- service: creative_ab end-to-end

async def test_create_experiment_service_creates_arms_from_real_creatives(pool):
    from marketer.repos import ads
    from marketer.services import ad_experiments as svc

    uid, acc, camp = await _mksetup(pool)
    c1 = await ads.create_creative(user_id=uid, campaign_id=camp.id, headline="A")
    c2 = await ads.create_creative(user_id=uid, campaign_id=camp.id, headline="B")

    exp = await svc.create_experiment(
        user_id=uid, campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(c1.id), str(c2.id)], "window_days": 2},
    )
    from marketer.repos import ad_experiments as experiments_repo

    arms = await experiments_repo.list_arms(exp.id)
    assert {a.creative_id for a in arms} == {c1.id, c2.id}


async def test_evaluate_end_to_end_picks_winner_from_real_metrics(pool, monkeypatch):
    from marketer.config import settings
    from marketer.repos import ad_experiments as experiments_repo
    from marketer.repos import ads
    from marketer.services import ad_experiments as svc

    monkeypatch.setattr(settings, "ads_experiments_enabled", True)
    monkeypatch.setattr(settings, "ads_enabled", True)

    uid, acc, camp = await _mksetup(pool)
    c1 = await ads.create_creative(user_id=uid, campaign_id=camp.id, headline="Winner")
    c2 = await ads.create_creative(user_id=uid, campaign_id=camp.id, headline="Loser")

    exp = await svc.create_experiment(
        user_id=uid, campaign_id=camp.id, kind="creative_ab",
        config={"creative_ids": [str(c1.id), str(c2.id)], "window_days": 1},
    )
    exp = await svc.start(exp.id, user_id=uid)
    assert exp.status == "running"

    start_date = exp.started_at.date()
    await ads.upsert_metrics(
        user_id=uid, ad_account_id=acc.id, campaign_id=camp.id, day=start_date,
        impressions=1000, clicks=100, spend_usd=Decimal("10"), revenue_usd=Decimal("50"),
    )
    await ads.upsert_metrics(
        user_id=uid, ad_account_id=acc.id, campaign_id=camp.id,
        day=start_date + timedelta(days=1),
        impressions=1000, clicks=10, spend_usd=Decimal("10"), revenue_usd=Decimal("2"),
    )

    result = await svc.evaluate(exp.id, user_id=uid)
    assert result.status == "completed"
    arms = await experiments_repo.list_arms(exp.id)
    winner = next(a for a in arms if a.is_winner)
    assert winner.creative_id == c1.id


# --------------------------------------------------------------------------- service: budget_ramp end-to-end

async def test_advance_end_to_end_through_real_guard_small_step_executes(pool, monkeypatch):
    from marketer.config import settings
    from marketer.services import ad_experiments as svc

    monkeypatch.setattr(settings, "ads_experiments_enabled", True)
    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "ads_approval_threshold_usd", 50.0)

    uid, acc, camp = await _mksetup(pool, daily_budget=100)
    exp = await svc.create_experiment(
        user_id=uid, campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": 200, "step_pct": 10, "interval_days": 1},
    )
    exp = await svc.start(exp.id, user_id=uid)

    calls = []

    async def fake_apply(campaign_obj, new_budget):
        calls.append(new_budget)
        return {"applied": "stub"}

    updated = await svc.advance(exp.id, user_id=uid, apply_fn=fake_apply)
    assert calls == [Decimal("110.00")]
    assert updated.status == "running"

    from marketer.repos import ads

    persisted = await ads.get_campaign(camp.id, user_id=uid)
    assert persisted.daily_budget_usd == Decimal("110.00")


async def test_advance_end_to_end_large_step_parks_for_approval(pool, monkeypatch):
    from marketer.config import settings
    from marketer.repos import ad_approvals
    from marketer.services import ad_experiments as svc

    monkeypatch.setattr(settings, "ads_experiments_enabled", True)
    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "ads_approval_threshold_usd", 50.0)

    # current=1000, step_pct=20% -> step 200, clamped to the 1100 target ->
    # delta 100, over the $50 threshold: parks on the very first call.
    uid, acc, camp = await _mksetup(pool, daily_budget=1000)
    exp = await svc.create_experiment(
        user_id=uid, campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": 1100, "step_pct": 20, "interval_days": 1},
    )
    exp = await svc.start(exp.id, user_id=uid)

    calls = []

    async def fake_apply(campaign_obj, new_budget):
        calls.append(new_budget)
        return {"applied": "stub"}

    exp = await svc.advance(exp.id, user_id=uid, apply_fn=fake_apply)
    assert calls == []  # parked, never applied
    assert exp.result.get("pending_approval_id") is not None
    approval_id = UUID(exp.result["pending_approval_id"])
    pending = await ad_approvals.list_(user_id=uid, status="pending")
    assert any(a.id == approval_id for a in pending)

    # Idempotent re-check while still pending: no new approval, no new step.
    steps_before = len(exp.result["steps"])
    again = await svc.advance(exp.id, user_id=uid, apply_fn=fake_apply)
    assert again.result["pending_approval_id"] == str(approval_id)
    assert len(again.result["steps"]) == steps_before


async def test_advance_killswitch_denies_and_cancels_ramp(pool, monkeypatch):
    from marketer.config import settings
    from marketer.services import ad_experiments as svc

    monkeypatch.setattr(settings, "ads_experiments_enabled", True)
    monkeypatch.setattr(settings, "ads_enabled", True)

    uid, acc, camp = await _mksetup(pool, daily_budget=100, killswitch=True)
    exp = await svc.create_experiment(
        user_id=uid, campaign_id=camp.id, kind="budget_ramp",
        config={"target_daily_usd": 200, "step_pct": 10, "interval_days": 1},
    )
    exp = await svc.start(exp.id, user_id=uid)

    async def fake_apply(campaign_obj, new_budget):
        return {"applied": "stub"}

    updated = await svc.advance(exp.id, user_id=uid, apply_fn=fake_apply)
    assert updated.status == "cancelled"
    assert "denied" in updated.result["cancelled_reason"]
