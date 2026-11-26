"""Real-Postgres checks for access codes: hashing, idempotent grants, limits."""
from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta
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
        await conn.execute("delete from access_code_redemptions where tenant_id like 'codes_%'")
        await conn.execute("delete from users where id like 'codes_%'")
        await conn.execute("delete from access_codes where created_by = 'staff_codes_test'")


async def _tenant(pool) -> str:
    uid = f"codes_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return uid


async def _code(**kw):
    from marketer.repos import access_codes as codes

    args = dict(kind="pilot", credit_usd=Decimal("25"), trial_days=30, max_redemptions=2, expires_at=None, note="", created_by="staff_codes_test")
    args.update(kw)
    return await codes.create(**args)


async def test_only_a_hash_is_stored(pool):
    plain, row = await _code()
    stored = await pool.fetchrow("select * from access_codes where id = $1", row.id)
    assert plain not in str(dict(stored))
    assert stored["code_hint"] == plain.replace("-", "")[-4:]


async def test_redeem_grants_once_through_the_ledger(pool):
    from marketer.repos import access_codes as codes
    from marketer.repos import billing

    tenant = await _tenant(pool)
    plain, _ = await _code()
    r = await codes.redeem(code=plain.lower().replace("-", " "), tenant_id=tenant, actor_id="p1")
    assert r.kind == "pilot" and r.credit_usd == Decimal("25")
    assert r.access_until and r.access_until > datetime.now(UTC) + timedelta(days=29)
    assert await billing.balance(tenant) == Decimal("25")
    with pytest.raises(codes.RedeemFailed) as e:
        await codes.redeem(code=plain, tenant_id=tenant, actor_id="p2")
    assert e.value.reason == "code_already_redeemed"
    assert await billing.balance(tenant) == Decimal("25")
    grants = await pool.fetch("select * from credit_transactions where user_id = $1 and kind = 'grant'", tenant)
    assert len(grants) == 1
    assert (await codes.redemption_for(tenant)).kind == "pilot"


async def test_concurrent_redeems_for_one_workspace_grant_once(pool):
    from marketer.repos import access_codes as codes
    from marketer.repos import billing

    tenant = await _tenant(pool)
    plain, _ = await _code(max_redemptions=10)
    results = await asyncio.gather(*[codes.redeem(code=plain, tenant_id=tenant, actor_id="p") for _ in range(5)], return_exceptions=True)
    assert sum(not isinstance(r, Exception) for r in results) == 1
    assert await billing.balance(tenant) == Decimal("25")


async def test_used_up_expired_disabled_unknown(pool):
    from marketer.repos import access_codes as codes

    a, b, c = await _tenant(pool), await _tenant(pool), await _tenant(pool)
    plain, row = await _code(max_redemptions=1, kind="invite", credit_usd=Decimal("5"), trial_days=None)
    await codes.redeem(code=plain, tenant_id=a, actor_id="p")
    with pytest.raises(codes.RedeemFailed) as e:
        await codes.redeem(code=plain, tenant_id=b, actor_id="p")
    assert e.value.reason == "code_used_up"
    assert (await pool.fetchval("select redemption_count from access_codes where id = $1", row.id)) == 1

    old, _ = await _code(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    with pytest.raises(codes.RedeemFailed) as e:
        await codes.redeem(code=old, tenant_id=c, actor_id="p")
    assert e.value.reason == "code_expired"

    off, off_row = await _code()
    await codes.disable(off_row.id)
    with pytest.raises(codes.RedeemFailed) as e:
        await codes.redeem(code=off, tenant_id=c, actor_id="p")
    assert e.value.reason == "code_expired"

    with pytest.raises(codes.RedeemFailed) as e:
        await codes.redeem(code="PLT-0000-0000-0000", tenant_id=c, actor_id="p")
    assert e.value.reason == "code_unknown"
    assert await codes.redemption_for(c) is None


async def test_pilot_without_credit_moves_no_money(pool):
    from marketer.repos import access_codes as codes
    from marketer.repos import billing

    tenant = await _tenant(pool)
    plain, _ = await _code(credit_usd=Decimal("0"), trial_days=14)
    r = await codes.redeem(code=plain, tenant_id=tenant, actor_id="p")
    assert r.credit_usd == 0 and r.trial_days == 14
    assert await billing.balance(tenant) == 0
    assert await pool.fetchval("select count(*) from credit_transactions where user_id = $1", tenant) == 0
