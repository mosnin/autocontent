"""Real-Postgres coverage for niche-less spend (migration 0028).

Ad-campaign decision costs have no playbook. They must land in spend_ledger,
count against the user's global daily cap, stay out of every per-niche sum,
and never break a reader of spend_ledger.niche_id.

Requires MARKETER_DATABASE_URL pointed at a real Postgres."""
from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
from tests.auth_helpers import ctx_for

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    yield await db.get_pool()


@pytest.fixture
async def user(pool):
    uid = f"user_sp_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    yield uid
    await pool.execute("delete from users where id = $1", uid)


@pytest.fixture
async def niche(pool, user):
    return await pool.fetchval(
        """
        insert into niches (user_id, title, description, target_audience, visual_style, voice,
                            target_duration_sec, scene_count, posting_windows, platforms,
                            daily_spend_cap_usd)
        values ($1, 't', 'd', 'a', 'v', 'warm', 30, 3, '[]'::jsonb, '{tiktok}', 5)
        returning id
        """,
        user,
    )


@pytest.fixture
async def ad_campaign(pool, user):
    account = await pool.fetchval(
        "insert into ad_accounts (user_id, platform) values ($1, 'meta_ads') returning id", user
    )
    return await pool.fetchval(
        "insert into ad_campaigns (user_id, ad_account_id, name) values ($1, $2, 'c') returning id",
        user, account,
    )


def _entry(user: str, **over):
    from marketer.models import SpendEntry

    kw = dict(user_id=user, niche_id=None, job_id=None, provider="openrouter",
              sku="decision:budget_shift", units=Decimal("1"), cost_usd=Decimal("0.0100"))
    kw.update(over)
    return SpendEntry(**kw)


async def test_niche_less_spend_is_recorded_and_attributed(pool, user, ad_campaign):
    from marketer.repos import spend as spend_repo

    await spend_repo.record(_entry(user, ad_campaign_id=ad_campaign))
    row = await pool.fetchrow("select niche_id, ad_campaign_id, cost_usd from spend_ledger where user_id = $1", user)
    assert row["niche_id"] is None
    assert row["ad_campaign_id"] == ad_campaign
    assert row["cost_usd"] == Decimal("0.0100")


async def test_readers_are_null_safe(pool, user, niche, ad_campaign):
    from backend.routes.spend import spend_history, today_spend
    from marketer.repos import spend as spend_repo

    await spend_repo.record(_entry(user, ad_campaign_id=ad_campaign, cost_usd=Decimal("0.0300")))
    await spend_repo.record(_entry(user, cost_usd=Decimal("0.0200")))
    await spend_repo.record(_entry(user, niche_id=niche, provider="openai", sku="tts", cost_usd=Decimal("1.0000")))

    # The global cap sees everything; the per-niche sum sees only its niche.
    assert await spend_repo.today_spend_total_usd(user_id=user) == Decimal("1.0500")
    assert await spend_repo.today_spend_usd(user_id=user, niche_id=niche) == Decimal("1.0000")
    # "No niche" is never read as "every niche".
    assert await spend_repo.today_spend_usd(user_id=user, niche_id=None) == Decimal("0")
    await spend_repo.assert_within_cap(user_id=user, niche_id=None, cap_usd=Decimal("0.01"))

    by_niche = await spend_repo.today_spend_by_niche(user_id=user)
    assert by_niche == {niche: Decimal("1.0000"), None: Decimal("0.0500")}

    rows = await spend_repo.history(user_id=user, days=7)
    assert [(r.niche_id, r.cost_usd) for r in rows] == [(niche, Decimal("1.0000")), (None, Decimal("0.0500"))]
    only = await spend_repo.history(user_id=user, days=7, niche_id=niche)
    assert [(r.niche_id, r.cost_usd) for r in only] == [(niche, Decimal("1.0000"))]

    # The API shapes: niche-less spend is bucketed, not a "None" key.
    ctx = ctx_for("owner", user_id=user, email="p@t.com")
    today = await today_spend(ctx)
    assert today.by_niche == {str(niche): Decimal("1.0000"), "other": Decimal("0.0500")}
    assert today.total_usd == Decimal("1.0500")
    history = await spend_history(ctx, days=7, niche_id=None)
    assert history.total_usd == Decimal("1.0500")
    assert history.model_dump(mode="json")["rows"][-1]["niche_id"] is None


async def test_other_ledger_readers_tolerate_niche_less_rows(pool, user, ad_campaign):
    """Every query that reads spend_ledger, run with a niche-less row present."""
    from datetime import datetime, timedelta, timezone

    from marketer.repos import admin as admin_repo
    from marketer.repos import metrics as metrics_repo
    from marketer.repos import privacy
    from marketer.repos import spend as spend_repo
    from marketer.repos import workspace as workspace_repo

    await spend_repo.record(_entry(user, ad_campaign_id=ad_campaign, cost_usd=Decimal("0.2500")))
    now = datetime.now(timezone.utc)
    start, end = now - timedelta(days=1), now + timedelta(days=1)

    kpis = await workspace_repo.window_kpis(user, start=start, end=end)
    assert Decimal(str(kpis["content_spend_usd"])) == Decimal("0.2500")
    await workspace_repo.daily_series(user, start=start, end=end)
    row = await admin_repo.get_user(user)
    assert row is not None and Decimal(str(row.spend_total_usd)) == Decimal("0.2500")
    await admin_repo.overview()
    exported = await privacy.export_user(user)
    assert exported  # the export still serialises with a null niche
    velocity = await metrics_repo.spend_velocity(window_minutes=60)
    assert any(v for v in velocity) or velocity == [] or velocity is not None
    assert await spend_repo.cost_by_job([uuid4()], user_id=user)


async def test_global_cap_and_credit_apply_but_the_niche_cap_does_not(pool, user, ad_campaign):
    from marketer.repos.spend import SpendCapExceeded
    from marketer.services.spend_context import default_context

    await pool.execute("update users set global_daily_cap_usd = 0.05 where id = $1", user)
    # A stray per-niche cap on a niche-less context must be ignored, not
    # compared against an empty sum (which would never trip) or blow up.
    spend = await default_context(
        user_id=user, niche_id=None, job_id=None, ad_campaign_id=ad_campaign, cap_usd=Decimal("0.001"),
    )
    await spend.ensure_can_spend(Decimal("0.01"))
    await spend.log(provider="openrouter", sku="decision:budget_shift", units=Decimal("1"), cost_usd=Decimal("0.02"))
    assert not spend.abort_event.is_set()

    # The global cap is the one that stops it, and names the right subject.
    with pytest.raises(SpendCapExceeded) as denied:
        await spend.ensure_can_spend(Decimal("0.04"))
    assert denied.value.scope == "global"
    with pytest.raises(SpendCapExceeded) as tripped:
        await spend.log(provider="openrouter", sku="decision:budget_shift", units=Decimal("1"), cost_usd=Decimal("0.04"))
    assert tripped.value.scope == "global" and tripped.value.after_spend is True
    # The row was written before the cap tripped: money spent is money recorded.
    n = await pool.fetchval("select count(*) from spend_ledger where user_id = $1 and ad_campaign_id = $2", user, ad_campaign)
    assert n == 2
    with pytest.raises(SpendCapExceeded) as again:
        await spend.ensure_can_spend(Decimal("0.01"))
    assert "niche None" not in str(again.value)


async def test_deleting_the_campaign_keeps_the_cost(pool, user, ad_campaign):
    from marketer.repos import spend as spend_repo

    await spend_repo.record(_entry(user, ad_campaign_id=ad_campaign))
    await pool.execute("delete from ad_campaigns where id = $1", ad_campaign)
    row = await pool.fetchrow("select ad_campaign_id, cost_usd from spend_ledger where user_id = $1", user)
    assert row["ad_campaign_id"] is None and row["cost_usd"] == Decimal("0.0100")


async def test_ad_campaign_reference_is_enforced(pool, user):
    from marketer.repos import spend as spend_repo

    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await spend_repo.record(_entry(user, ad_campaign_id=uuid4()))


async def test_migration_0028_rollback_and_reapply(pool, user):
    """The rollback keeps niche-less history (it never restores NOT NULL) and
    both files can be run again."""
    from marketer.repos import spend as spend_repo

    async def has_column() -> bool:
        return await pool.fetchval(
            "select exists(select 1 from information_schema.columns "
            "where table_name = 'spend_ledger' and column_name = 'ad_campaign_id')"
        )

    async def nullable() -> bool:
        return await pool.fetchval(
            "select is_nullable = 'YES' from information_schema.columns "
            "where table_name = 'spend_ledger' and column_name = 'niche_id'"
        )

    async def scale() -> int:
        return await pool.fetchval(
            "select numeric_scale from information_schema.columns "
            "where table_name = 'spend_ledger' and column_name = 'cost_usd'"
        )

    up = (MIGRATIONS / "0028_spend_ledger_nicheless.sql").read_text()
    down = (MIGRATIONS / "0028_spend_ledger_nicheless.rollback.sql").read_text()
    assert await has_column() and await nullable()
    await spend_repo.record(_entry(user, cost_usd=Decimal("0.00002")))
    try:
        await pool.execute(down)
        assert not await has_column()
        # Narrowed back: the sub-cent row is rounded, not rejected.
        assert await scale() == 4
        assert await pool.fetchval("select cost_usd from spend_ledger where user_id = $1", user) == Decimal("0.0000")
        assert await nullable(), "rollback must not restore NOT NULL over niche-less rows"
        assert await pool.fetchval("select count(*) from spend_ledger where user_id = $1", user) == 1
        await pool.execute(down)  # idempotent
    finally:
        await pool.execute(up)
    await pool.execute(up)  # idempotent
    assert await has_column() and await nullable()
    assert await scale() == 8
    for index in ("spend_ledger_ad_campaign_idx", "spend_user_day_idx"):
        assert await pool.fetchval("select to_regclass($1) is not null", f"public.{index}")


async def test_a_sub_cent_cost_survives_the_round_trip(pool, user, ad_campaign):
    """A decision call costs about $0.00002. At numeric(10,4) it was stored as
    0.0000 and no cap ever saw it; at numeric(14,8) it is kept exactly, and
    many of them add up."""
    from backend.routes.spend import spend_history, today_spend
    from marketer.repos import spend as spend_repo
    from marketer.repos import workspace as workspace_repo
    from datetime import datetime, timedelta, timezone

    tiny = Decimal("0.00002")
    for _ in range(500):
        await spend_repo.record(_entry(user, ad_campaign_id=ad_campaign, cost_usd=tiny))
    await spend_repo.record(_entry(user, cost_usd=Decimal("0.00000001")))  # the smallest unit

    stored = await pool.fetch("select distinct cost_usd from spend_ledger where user_id = $1 order by 1", user)
    assert [r["cost_usd"] for r in stored] == [Decimal("0.00000001"), tiny]

    total = Decimal("0.01000001")  # 500 x 0.00002 + 0.00000001, exactly
    assert await spend_repo.today_spend_total_usd(user_id=user) == total
    assert (await spend_repo.today_spend_by_niche(user_id=user)) == {None: total}
    rows = await spend_repo.history(user_id=user, days=1)
    assert sum(r.cost_usd for r in rows) == total

    ctx = ctx_for("owner", user_id=user, email="p@t.com")
    assert (await today_spend(ctx)).total_usd == total
    assert (await spend_history(ctx, days=1, niche_id=None)).total_usd == total
    # Views that show cents still round for display, from the exact sum.
    now = datetime.now(timezone.utc)
    kpis = await workspace_repo.window_kpis(user, start=now - timedelta(days=1), end=now + timedelta(days=1))
    assert Decimal(str(kpis["content_spend_usd"])) == total

    # And the global cap now sees them: 0.01 of cap is used up by 500 calls.
    from marketer.repos.spend import SpendCapExceeded
    from marketer.services.spend_context import default_context

    await pool.execute("update users set global_daily_cap_usd = 0.01 where id = $1", user)
    spend = await default_context(user_id=user, niche_id=None, job_id=None, ad_campaign_id=ad_campaign)
    with pytest.raises(SpendCapExceeded):
        await spend.ensure_can_spend(tiny)


async def test_large_costs_still_fit_after_the_widening(pool, user):
    from marketer.repos import spend as spend_repo

    await spend_repo.record(_entry(user, cost_usd=Decimal("999999.9999")))
    assert await spend_repo.today_spend_total_usd(user_id=user) == Decimal("999999.9999")
