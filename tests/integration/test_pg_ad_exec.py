"""Real-Postgres tests for the ads safe-execute layer — the money contract.
Exercises deny (kill-switch / cap), approval-gate for large deltas, immediate
execution for small deltas, and single-use approved execution. The platform
call is a stub apply_fn, so no real spend occurs."""
from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

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


async def _setup(pool, *, daily_cap=None, killswitch=False, prev_budget=None):
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
        user_id=uid, ad_account_id=acc.id, name="C", status="active",
        daily_budget_usd=Decimal(str(prev_budget)) if prev_budget is not None else None,
    )
    return uid, acc, camp


async def _applied():
    calls = []

    async def apply_fn(campaign, budget):
        calls.append((campaign.id, budget))
        return {"applied": "stub"}

    return apply_fn, calls


async def test_small_change_executes_immediately(pool):
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, prev_budget=10)
    apply_fn, calls = await _applied()
    out = await ex.propose_budget_change(
        user_id=uid, campaign_id=camp.id,
        new_daily_budget_usd=Decimal("20"), apply_fn=apply_fn,
    )
    assert out["status"] == "executed"
    assert len(calls) == 1  # platform call happened
    assert out["campaign"]["daily_budget_usd"] == "20.00"


async def test_large_change_parks_for_approval_and_does_not_apply(pool):
    from marketer.repos import ad_actions
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, prev_budget=10)
    apply_fn, calls = await _applied()
    out = await ex.propose_budget_change(
        user_id=uid, campaign_id=camp.id,
        new_daily_budget_usd=Decimal("100"),  # +$90 delta >= $50 threshold
        apply_fn=apply_fn,
    )
    assert out["status"] == "pending_approval"
    assert calls == []  # NOT applied — no spend without approval
    log = await ad_actions.list_(user_id=uid)
    assert any(e.action == "budget.approval_requested" for e in log)


async def test_approval_needed_emails_the_user(pool, monkeypatch):
    from marketer.services import email as email_svc
    from marketer.services import ad_actions_exec as ex

    sent: list[str] = []

    async def fake_send(*, to, subject, html):
        sent.append(subject)
        return True

    monkeypatch.setattr(email_svc, "send_email", fake_send)

    uid, acc, camp = await _setup(pool, prev_budget=10)
    apply_fn, _ = await _applied()
    out = await ex.propose_budget_change(
        user_id=uid, campaign_id=camp.id,
        new_daily_budget_usd=Decimal("100"), apply_fn=apply_fn,
    )
    assert out["status"] == "pending_approval"
    assert len(sent) == 1
    assert "approval" in sent[0].lower()


async def test_killswitch_denies_and_audits(pool):
    from marketer.repos import ad_actions
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, prev_budget=10, killswitch=True)
    apply_fn, calls = await _applied()
    with pytest.raises(ex.AdSpendDenied):
        await ex.propose_budget_change(
            user_id=uid, campaign_id=camp.id,
            new_daily_budget_usd=Decimal("20"), apply_fn=apply_fn,
        )
    assert calls == []
    log = await ad_actions.list_(user_id=uid)
    assert any(e.action == "budget.denied" for e in log)


async def test_cap_denies(pool):
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, prev_budget=10, daily_cap=15)
    apply_fn, _ = await _applied()
    # New budget 20 > cap 15 → deny.
    with pytest.raises(ex.AdSpendDenied):
        await ex.propose_budget_change(
            user_id=uid, campaign_id=camp.id,
            new_daily_budget_usd=Decimal("20"), apply_fn=apply_fn,
        )


async def test_approved_change_executes_once(pool):
    from marketer.repos import ad_approvals
    from marketer.services import ad_actions_exec as ex

    uid, acc, camp = await _setup(pool, prev_budget=10)
    apply_fn, calls = await _applied()
    # Park a large change.
    out = await ex.propose_budget_change(
        user_id=uid, campaign_id=camp.id,
        new_daily_budget_usd=Decimal("100"), apply_fn=apply_fn,
    )
    approval_id = out["approval_id"]
    # Human approves.
    from uuid import UUID
    await ad_approvals.decide(
        UUID(approval_id), user_id=uid, status="approved", decided_by="admin@t.com"
    )
    # Execute the approved change.
    done = await ex.execute_approved_budget_change(
        user_id=uid, approval_id=UUID(approval_id), apply_fn=apply_fn,
    )
    assert done["status"] == "executed"
    assert len(calls) == 1
    # Replay is refused — the approval is now 'executed', not 'approved'.
    with pytest.raises(ex.AdSpendDenied):
        await ex.execute_approved_budget_change(
            user_id=uid, approval_id=UUID(approval_id), apply_fn=apply_fn,
        )
    assert len(calls) == 1  # no second apply
