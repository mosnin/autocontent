"""Real-Postgres tests for two ad-spend-guard fixes:

1. Approving an approval must actually EXECUTE the underlying spend change
   (budget change or campaign activation) instead of dead-ending — and
   rejecting must never execute anything.
2. Activating a campaign must run its stored ``daily_budget_usd`` through
   the SAME budget guard a budget change uses (caps + approval threshold),
   never activating a large/cap-busting budget for free.

Mirrors tests/integration/test_pg_ad_exec.py's setup/fixture patterns. The
platform call is a stub apply_fn, so no real spend occurs.
"""
from __future__ import annotations

import os
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


async def _setup(
    pool, *, daily_cap=None, killswitch=False, campaign_budget=None,
    campaign_status="draft",
):
    from marketer.repos import ads

    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )
    acc = await ads.create_account(
        user_id=uid, platform="google_ads", external_account_id="x",
        status="active",
    )
    if daily_cap is not None or killswitch:
        await ads.set_account_governance(
            acc.id, user_id=uid,
            daily_cap_usd=Decimal(str(daily_cap)) if daily_cap is not None else ...,
            killswitch=killswitch,
        )
    camp = await ads.create_campaign(
        user_id=uid, ad_account_id=acc.id, name="C", status=campaign_status,
        daily_budget_usd=(
            Decimal(str(campaign_budget)) if campaign_budget is not None else None
        ),
    )
    return uid, acc, camp


async def _applied():
    calls = []

    async def apply_fn(campaign, budget):
        calls.append((campaign.id, budget))
        return {"applied": "stub"}

    return apply_fn, calls


# --------------------------------------------------------------------------- Finding 2: activation guard

async def test_activation_within_cap_and_below_threshold_guard_allows(pool):
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, daily_cap=1000, campaign_budget=20)
    delta, requires_approval = await ex.guard_activation(camp)
    assert delta == Decimal("20")
    assert requires_approval is False


async def test_activation_over_daily_cap_denied(pool):
    from marketer.services import ad_actions_exec as ex

    # Draft campaign wants a $50000 daily budget; account cap is only $500.
    uid, acc, camp = await _setup(pool, daily_cap=500, campaign_budget=50000)
    with pytest.raises(ex.AdSpendDenied) as excinfo:
        await ex.guard_activation(camp)
    assert "cap" in excinfo.value.reason


async def test_activation_over_threshold_requires_approval(pool):
    from marketer.services import ad_actions_exec as ex

    # $90 budget coming online >= the $50 default approval threshold.
    uid, acc, camp = await _setup(pool, campaign_budget=90)
    delta, requires_approval = await ex.guard_activation(camp)
    assert delta == Decimal("90")
    assert requires_approval is True


async def test_activation_denied_when_killswitch_engaged(pool):
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, killswitch=True, campaign_budget=10)
    with pytest.raises(ex.AdSpendDenied) as excinfo:
        await ex.guard_activation(camp)
    assert "kill-switch" in excinfo.value.reason


async def test_execute_approved_activation_flips_status_and_applies(pool):
    from marketer.repos import ad_approvals, ads
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, campaign_budget=90)
    apply_fn, calls = await _applied()

    approval = await ad_approvals.create(
        user_id=uid, action="campaign.activate",
        summary="Activate campaign with daily budget $90",
        dollar_delta_usd=Decimal("90"), ad_account_id=acc.id,
        campaign_id=camp.id, payload={}, requested_by="user",
    )
    await ad_approvals.decide(
        approval.id, user_id=uid, status="approved", decided_by="admin@t.com"
    )

    out = await ex.execute_approved_activation(
        user_id=uid, approval_id=approval.id, apply_fn=apply_fn,
    )
    assert out["status"] == "executed"
    assert out["campaign"]["status"] == "active"
    assert len(calls) == 1  # platform call happened

    updated = await ads.get_campaign(camp.id, user_id=uid)
    assert updated.status == "active"

    # Single-use: the approval is now 'executed', replay is refused.
    with pytest.raises(ex.AdSpendDenied):
        await ex.execute_approved_activation(
            user_id=uid, approval_id=approval.id, apply_fn=apply_fn,
        )
    assert len(calls) == 1  # no second apply


async def test_execute_approved_activation_reguard_denies_on_retry(pool):
    """State can move between approval and execution (e.g. the kill-switch
    gets engaged). Execution must re-guard and refuse to apply, leaving the
    approval 'approved' so it can be retried later."""
    from marketer.repos import ad_approvals, ads
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, campaign_budget=90)
    apply_fn, calls = await _applied()

    approval = await ad_approvals.create(
        user_id=uid, action="campaign.activate",
        summary="Activate campaign with daily budget $90",
        dollar_delta_usd=Decimal("90"), ad_account_id=acc.id,
        campaign_id=camp.id, payload={}, requested_by="user",
    )
    await ad_approvals.decide(
        approval.id, user_id=uid, status="approved", decided_by="admin@t.com"
    )
    await ads.set_account_governance(acc.id, user_id=uid, killswitch=True)

    with pytest.raises(ex.AdSpendDenied):
        await ex.execute_approved_activation(
            user_id=uid, approval_id=approval.id, apply_fn=apply_fn,
        )
    assert calls == []  # never applied

    still_pending = await ad_approvals.get(approval.id, user_id=uid)
    assert still_pending.status == "approved"  # kept for a later retry

    updated = await ads.get_campaign(camp.id, user_id=uid)
    assert updated.status == "draft"  # never activated


# --------------------------------------------------------------------------- Finding 1: approve → execute wiring, via the route handler
#
# Calling the FastAPI route coroutine directly (rather than through
# TestClient) keeps everything on the same asyncio loop as the "pool"
# fixture's asyncpg pool — TestClient runs requests on a separate anyio
# worker-thread loop, and asyncpg pools are not safe to share across loops.

def _ctx(uid: str):
    from backend.auth import AuthCtx
    return AuthCtx(user_id=uid, email="a@t.com")


async def test_decide_approved_budget_change_executes_through_route(pool, monkeypatch):
    import backend.routes.ads as ads_route
    from marketer.repos import ad_approvals
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, campaign_status="active", campaign_budget=10)
    apply_fn, calls = await _applied()
    monkeypatch.setattr(ex, "_noop_apply", apply_fn)

    approval = await ad_approvals.create(
        user_id=uid, action="budget.change", summary="Set daily budget to $100",
        dollar_delta_usd=Decimal("90"), ad_account_id=acc.id, campaign_id=camp.id,
        payload={"new_daily_budget_usd": "100"}, requested_by="user",
    )

    result = await ads_route.decide_approval(
        approval.id, ads_route.DecideBody(decision="approved"), ctx=_ctx(uid),
    )
    assert result.status == "executed"
    assert len(calls) == 1  # the budget change actually ran

    from marketer.repos import ads
    updated = await ads.get_campaign(camp.id, user_id=uid)
    assert updated.daily_budget_usd == Decimal("100.00")


async def test_decide_rejected_does_not_execute(pool, monkeypatch):
    import backend.routes.ads as ads_route
    from marketer.repos import ad_approvals, ads
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, campaign_status="active", campaign_budget=10)
    apply_fn, calls = await _applied()
    monkeypatch.setattr(ex, "_noop_apply", apply_fn)

    approval = await ad_approvals.create(
        user_id=uid, action="budget.change", summary="Set daily budget to $100",
        dollar_delta_usd=Decimal("90"), ad_account_id=acc.id, campaign_id=camp.id,
        payload={"new_daily_budget_usd": "100"}, requested_by="user",
    )

    result = await ads_route.decide_approval(
        approval.id, ads_route.DecideBody(decision="rejected"), ctx=_ctx(uid),
    )
    assert result.status == "rejected"
    assert calls == []  # nothing executed

    updated = await ads.get_campaign(camp.id, user_id=uid)
    assert updated.daily_budget_usd == Decimal("10.00")  # unchanged


async def test_decide_approved_activation_executes_through_route(pool, monkeypatch):
    import backend.routes.ads as ads_route
    from marketer.repos import ad_approvals, ads
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, campaign_status="draft", campaign_budget=90)
    apply_fn, calls = await _applied()
    monkeypatch.setattr(ex, "_noop_apply", apply_fn)

    approval = await ad_approvals.create(
        user_id=uid, action="campaign.activate",
        summary="Activate campaign with daily budget $90",
        dollar_delta_usd=Decimal("90"), ad_account_id=acc.id, campaign_id=camp.id,
        payload={}, requested_by="user",
    )

    result = await ads_route.decide_approval(
        approval.id, ads_route.DecideBody(decision="approved"), ctx=_ctx(uid),
    )
    assert result.status == "executed"
    assert len(calls) == 1

    updated = await ads.get_campaign(camp.id, user_id=uid)
    assert updated.status == "active"


async def test_decide_approved_activation_402_when_reguard_denies(pool):
    """If the re-guard at execution time denies (e.g. killswitch engaged
    after approval was granted), the route surfaces a 402 and the approval
    stays 'approved' rather than crashing or silently no-op'ing."""
    from fastapi import HTTPException

    import backend.routes.ads as ads_route
    from marketer.repos import ad_approvals, ads

    uid, acc, camp = await _setup(pool, campaign_status="draft", campaign_budget=90)
    approval = await ad_approvals.create(
        user_id=uid, action="campaign.activate",
        summary="Activate campaign with daily budget $90",
        dollar_delta_usd=Decimal("90"), ad_account_id=acc.id, campaign_id=camp.id,
        payload={}, requested_by="user",
    )
    await ads.set_account_governance(acc.id, user_id=uid, killswitch=True)

    with pytest.raises(HTTPException) as excinfo:
        await ads_route.decide_approval(
            approval.id, ads_route.DecideBody(decision="approved"), ctx=_ctx(uid),
        )
    assert excinfo.value.status_code == 402

    still_pending = await ad_approvals.get(approval.id, user_id=uid)
    assert still_pending.status == "approved"
    updated = await ads.get_campaign(camp.id, user_id=uid)
    assert updated.status == "draft"  # never activated


# --------------------------------------------------------------------------- Finding 2, via the route handler: cap denies, threshold parks

async def test_route_activation_over_cap_denied_402(pool):
    from fastapi import HTTPException

    import backend.routes.ads as ads_route
    from marketer.repos import ads

    uid, acc, camp = await _setup(pool, daily_cap=500, campaign_budget=50000)

    with pytest.raises(HTTPException) as excinfo:
        await ads_route.change_status(
            camp.id, ads_route.StatusBody(status="active"), ctx=_ctx(uid),
        )
    assert excinfo.value.status_code == 402
    assert "cap" in str(excinfo.value.detail)

    unchanged = await ads.get_campaign(camp.id, user_id=uid)
    assert unchanged.status == "draft"  # never activated


async def test_route_activation_over_threshold_parks_approval(pool):
    import backend.routes.ads as ads_route
    from marketer.repos import ad_approvals, ads

    uid, acc, camp = await _setup(pool, campaign_budget=90)  # >= $50 threshold

    result = await ads_route.change_status(
        camp.id, ads_route.StatusBody(status="active"), ctx=_ctx(uid),
    )
    assert result["status"] == "pending_approval"
    assert "approval_id" in result

    unchanged = await ads.get_campaign(camp.id, user_id=uid)
    assert unchanged.status == "draft"  # NOT activated yet

    approval = await ad_approvals.get(UUID(result["approval_id"]), user_id=uid)
    assert approval is not None
    assert approval.status == "pending"
    assert approval.action == "campaign.activate"


async def test_route_activation_within_limits_activates_immediately(pool):
    import backend.routes.ads as ads_route
    from marketer.repos import ads

    uid, acc, camp = await _setup(pool, daily_cap=1000, campaign_budget=20)

    result = await ads_route.change_status(
        camp.id, ads_route.StatusBody(status="active"), ctx=_ctx(uid),
    )
    assert result["status"] == "active"

    updated = await ads.get_campaign(camp.id, user_id=uid)
    assert updated.status == "active"


# --------------------------------------------------------------------------- pause/end always allowed, even when budget would fail the guard

async def test_pause_and_end_never_blocked_by_budget_guard(pool):
    """Pausing/ending must remain unconditionally allowed — even for a
    campaign whose budget would fail the activation guard (way over cap)."""
    import backend.routes.ads as ads_route
    from marketer.repos import ads

    uid, acc, camp = await _setup(
        pool, daily_cap=10, campaign_budget=50000, campaign_status="active",
    )

    for target_status in ("paused", "ended"):
        result = await ads_route.change_status(
            camp.id, ads_route.StatusBody(status=target_status), ctx=_ctx(uid),
        )
        assert result["status"] == target_status
        camp = await ads.get_campaign(camp.id, user_id=uid)
        assert camp.status == target_status
