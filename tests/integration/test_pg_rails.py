"""Real-Postgres tests for the execution rails (0027_rails.sql + PostgresRailsStore):
outcomes, the stale-dispatch rule, idempotency claims on 0024's table, the
feature-flag kill switches, approval expiry, and the args-bound ad approval
end to end through ad_actions_exec."""
from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)


@pytest.fixture
async def pool(rails_store):
    from marketer import db
    from marketer.rails.store import PostgresRailsStore, set_store

    db._pool = None
    p = await db.get_pool()
    previous = set_store(PostgresRailsStore())
    yield p
    set_store(previous)
    async with p.acquire() as conn:
        await conn.execute("delete from feature_flags where key like 'rails.%'")
        await conn.execute("delete from idempotency_keys where key like 'rails:%'")
        await conn.execute("delete from users where id like 'user_rails_%'")


async def _user(pool) -> str:
    uid = f"user_rails_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return uid


async def test_outcomes_unknowns_and_resolution(pool):
    from marketer import rails
    from marketer.rails.store import get_store

    uid = await _user(pool)
    d = await rails.enforce_dispatch(
        "content.post.send", user_id=uid, principal="system", args={"job_id": "j1"},
        target_type="video_post", target_id="j1", idempotency_key="",
    )

    async def timeout():
        raise httpx.ReadTimeout("no answer")

    with pytest.raises(rails.OutcomeUnknown):
        await d.run(timeout)
    row = await pool.fetchrow("select outcome, tier, principal, ended_at from rails_executions where id = $1", d.execution_id)
    assert (row["outcome"], row["tier"], row["principal"]) == ("indeterminate", "HIGH", "system")
    assert row["ended_at"] is not None

    # First commit wins: a late "succeeded" never overwrites the outcome.
    assert await get_store().finish(d.execution_id, "succeeded") is False

    with pytest.raises(rails.RailsDenied) as e:
        await rails.enforce_dispatch(
            "content.post.send", user_id=uid, principal="system", args={"job_id": "j1"},
            target_type="video_post", target_id="j1", idempotency_key="",
        )
    assert e.value.code == "outcome_unknown"
    open_rows = await get_store().open_required_actions(uid)
    assert [r.id for r in open_rows] == [d.execution_id]

    resolved = await get_store().resolve(uid, d.execution_id, resolution="confirmed_failed", resolved_by="p@t.com")
    assert resolved is not None and resolved.resolution == "confirmed_failed"
    assert await get_store().resolve(uid, d.execution_id, resolution="confirmed_failed", resolved_by="p@t.com") is None
    assert await get_store().open_required_actions(uid) == []
    denied = await pool.fetchval("select count(*) from rails_executions where user_id = $1 and outcome = 'denied'", uid)
    assert denied == 1


async def test_stale_dispatching_rows_are_unknown(pool):
    from marketer import rails
    from marketer.rails.store import get_store

    uid = await _user(pool)
    d = await rails.enforce_dispatch(
        "campaigns.start", user_id=uid, principal="agent", args={"campaign_id": "c1"},
        target_type="campaign", target_id="c1", idempotency_key="",
    )
    assert not await get_store().has_unresolved(uid, "campaign", "c1")  # in flight, not stale
    await pool.execute("update rails_executions set created_at = now() - interval '20 minutes' where id = $1", d.execution_id)
    assert await get_store().has_unresolved(uid, "campaign", "c1")


async def test_idempotency_claims_and_kill_switch_flags(pool):
    from marketer import rails

    uid = await _user(pool)
    d = await rails.enforce_dispatch(
        "content.video.approve", user_id=uid, principal="agent", args={"job_id": "j2"},
        target_type="job", target_id="j2", idempotency_key="k-1",
    )
    assert await pool.fetchval("select status from idempotency_keys where key = $1", f"rails:{uid}:content.video.approve:k-1") == "claimed"
    await d.succeeded()
    with pytest.raises(rails.RailsDenied) as e:
        await rails.enforce_dispatch(
            "content.video.approve", user_id=uid, principal="agent", args={"job_id": "j2"},
            target_type="job", target_id="j2", idempotency_key="k-1",
        )
    assert e.value.code == "duplicate_dispatch"

    await pool.execute(
        "insert into feature_flags (key, enabled, description) values ('rails.kill_switch.publish', true, 'test')"
    )
    with pytest.raises(rails.RailsDenied) as e:
        await rails.enforce_dispatch(
            "content.video.approve", user_id=uid, principal="user", args={"job_id": "j3"},
            target_type="job", target_id="j3",
        )
    assert e.value.code == "kill_switch"
    reject = await rails.enforce_dispatch(
        "content.video.reject", user_id=uid, principal="user", args={"job_id": "j3"},
        target_type="job", target_id="j3",
    )
    await reject.succeeded()


async def test_budget_approval_bound_to_exact_change(pool):
    from marketer.repos import ad_approvals, ads
    from marketer.services import ad_actions_exec as ex

    uid = await _user(pool)
    acc = await ads.create_account(user_id=uid, platform="google_ads", external_account_id="x", status="active")
    camp = await ads.create_campaign(
        user_id=uid, ad_account_id=acc.id, name="C", status="active", daily_budget_usd=Decimal("10"),
    )
    applied = []

    async def apply_fn(campaign, budget):
        applied.append(budget)
        return {"applied": "stub"}

    out = await ex.propose_budget_change(user_id=uid, campaign_id=camp.id, new_daily_budget_usd=Decimal("100"), apply_fn=apply_fn)
    assert out["status"] == "pending_approval"
    approval_id = out["approval_id"]
    stored = await ad_approvals.get(approval_id, user_id=uid)
    assert len(stored.payload["rails"]["args_hash"]) == 64

    # The campaign's budget moves before anyone decides: the approval no longer describes this change.
    await ads.update_campaign(camp.id, user_id=uid, daily_budget_usd=Decimal("40"))
    await ad_approvals.decide(approval_id, user_id=uid, status="approved", decided_by="p@t.com")
    with pytest.raises(ex.AdSpendDenied) as e:
        await ex.execute_approved_budget_change(user_id=uid, approval_id=approval_id, apply_fn=apply_fn)
    assert e.value.status_code == 409
    assert applied == []
    assert (await ad_approvals.get(approval_id, user_id=uid)).status == "expired"
