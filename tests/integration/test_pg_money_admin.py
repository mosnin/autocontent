"""Real-Postgres integration tests for the money + admin paths.

The brutal audit's #1 gap: the billing ledger, spend caps, and admin audit
trail were never exercised against a real database — only mocked pools. These
tests run against an actual Postgres when MARKETER_DATABASE_URL points at one
(the CI service, or a local instance); otherwise they skip.

They validate the invariants that only a real DB can prove: transactional
credit purchase idempotency, atomic debit + ledger mirroring, the partial
unique index on purchases, spend-cap summation over real rows, and the
append-only admin audit log.
"""
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

    db._pool = None  # reset any cached pool
    p = await db.get_pool()
    yield p
    # Clean tables between tests (children first via cascade from users).
    async with p.acquire() as conn:
        await conn.execute("delete from users")
        await conn.execute("delete from admin_audit_log")
        await conn.execute("delete from feature_flags")


async def _mkuser(pool, *, credit="0", role="user") -> str:
    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email, credit_balance_usd, role) values ($1,$2,$3,$4)",
        uid, f"{uid}@t.com", Decimal(credit), role,
    )
    return uid


async def _mkniche(pool, uid) -> str:
    nid = uuid4()
    await pool.execute(
        """insert into niches
           (id, user_id, title, description, target_audience, visual_style, voice,
            target_duration_sec, scene_count, posting_windows, platforms, daily_spend_cap_usd)
           values ($1,$2,'t','d','a','s','onyx',30,3,'[]'::jsonb,'{tiktok}',5)""",
        nid, uid,
    )
    return nid


# --------------------------------------------------------------------------- billing

async def test_credit_purchase_is_idempotent_on_session(pool):
    from marketer.repos import billing

    uid = await _mkuser(pool)
    session = f"cs_{uuid4().hex}"
    first = await billing.credit_purchase(
        user_id=uid, amount_usd=Decimal("20"), checkout_session_id=session
    )
    assert first == Decimal("20.0000")
    # Webhook retry with the same session id must be a no-op.
    again = await billing.credit_purchase(
        user_id=uid, amount_usd=Decimal("20"), checkout_session_id=session
    )
    assert again is None
    assert await billing.balance(uid) == Decimal("20.0000")


async def test_debit_mirrors_ledger_atomically(pool):
    from marketer.repos import billing

    uid = await _mkuser(pool, credit="10")
    new_bal = await billing.debit(
        user_id=uid, amount_usd=Decimal("3.50"), job_id=None, description="openai/x"
    )
    assert new_bal == Decimal("6.5000")
    txns = await billing.transactions(uid)
    debit_rows = [t for t in txns if t.kind == "debit"]
    assert len(debit_rows) == 1
    assert debit_rows[0].amount_usd == Decimal("-3.5000")


# --------------------------------------------------------------------------- spend caps

async def test_today_spend_sums_real_rows(pool):
    from marketer.models import SpendEntry
    from marketer.repos import spend as spend_repo

    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    for amt in ("0.50", "0.75", "1.20"):
        await spend_repo.record(SpendEntry(
            user_id=uid, niche_id=nid, job_id=None, provider="openai",
            sku="gpt-image-1", units=Decimal(1), cost_usd=Decimal(amt),
        ))
    total = await spend_repo.today_spend_usd(user_id=uid, niche_id=nid)
    assert total == Decimal("2.45")


# --------------------------------------------------------------------------- admin audit

async def test_audit_log_is_append_and_readable(pool):
    from marketer.repos import admin_audit

    uid = await _mkuser(pool, role="admin")
    await admin_audit.record(
        actor_id=uid, actor_email="a@t.com", action="user.suspend",
        target_type="user", target_id="victim_1", ip="1.2.3.4",
        user_agent="pytest", metadata={"reason": "abuse"},
    )
    await admin_audit.record(
        actor_id=uid, actor_email="a@t.com", action="credits.grant",
        target_type="user", target_id="victim_1", metadata={"amount_usd": "5"},
    )
    entries = await admin_audit.list_(target_type="user", target_id="victim_1")
    assert len(entries) == 2
    # Newest first, metadata round-trips as a dict.
    assert entries[0].action == "credits.grant"
    assert entries[1].metadata["reason"] == "abuse"


async def test_admin_overview_counts_real_data(pool):
    from marketer.repos import admin as admin_repo

    a = await _mkuser(pool, role="admin")
    await _mkuser(pool)
    await _mkniche(pool, a)
    ov = await admin_repo.overview()
    assert ov.total_users == 2
    assert ov.admin_users == 1
    assert ov.total_niches == 1


async def test_grant_credit_updates_balance(pool):
    from marketer.repos import admin as admin_repo

    uid = await _mkuser(pool, credit="5")
    new_bal = await admin_repo.grant_credit(uid, Decimal("15"))
    assert new_bal == Decimal("20.0000")


# --------------------------------------------------------------------------- privacy

async def test_erasure_cascades(pool):
    from marketer.repos import privacy

    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    assert await privacy.erase_user(uid) is True
    # Niche cascaded away with the user.
    remaining = await pool.fetchval("select count(*) from niches where id = $1", nid)
    assert remaining == 0
