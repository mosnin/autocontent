"""Real-Postgres campaigns coverage: CRUD, lanes, spend attribution
rollup through jobs/articles, and tenant scoping."""
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


async def _mkuser(pool) -> str:
    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )
    return uid


async def _mkniche(pool, uid):
    row = await pool.fetchrow(
        """
        insert into niches (user_id, title, description, target_audience,
            visual_style, voice, target_duration_sec, scene_count,
            posting_windows, platforms, daily_spend_cap_usd)
        values ($1,'t','d','a','v','onyx',30,2,'[]'::jsonb,'{tiktok}',5.0)
        returning id
        """,
        uid,
    )
    return row["id"]


async def test_campaign_lifecycle_items_and_attribution(pool):
    from marketer.repos import campaigns, jobs as jobs_repo

    uid = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)

    c = await campaigns.create(
        user_id=uid, name="launch", objective="go", budget_usd=Decimal("25"),
    )
    assert c.status == "draft"

    item = await campaigns.add_item(
        campaign_id=c.id, user_id=uid, kind="video", ref_id=niche_id,
        cadence_per_week=5,
    )
    assert item.cadence_per_week == 5
    # re-adding upserts (cadence update), not duplicates
    again = await campaigns.add_item(
        campaign_id=c.id, user_id=uid, kind="video", ref_id=niche_id,
        cadence_per_week=7,
    )
    assert again.id == item.id and again.cadence_per_week == 7
    assert len(await campaigns.list_items(c.id, user_id=uid)) == 1

    # lifecycle
    running = await campaigns.set_status(c.id, user_id=uid, status="running")
    assert running.status == "running"
    assert c.id in [x.id for x in await campaigns.list_running()]

    # attribution: a campaign job's spend rolls up; a non-campaign job's doesn't
    job = await jobs_repo.create(
        user_id=uid, niche_id=niche_id, platform="tiktok", campaign_id=c.id,
    )
    stray = await jobs_repo.create(
        user_id=uid, niche_id=niche_id, platform="tiktok",
    )
    for j, cost in ((job, "1.25"), (stray, "9.99")):
        await pool.execute(
            """
            insert into spend_ledger (user_id, niche_id, job_id, provider, sku, units, cost_usd)
            values ($1, $2, $3, 'openai', 'test', 1, $4)
            """,
            uid, niche_id, j.id, Decimal(cost),
        )
    assert await campaigns.spent_usd(c.id, user_id=uid) == Decimal("1.25")

    counts = await campaigns.work_counts(c.id, user_id=uid)
    assert counts["video"][niche_id]["total"] == 1
    assert counts["video"][niche_id]["last7"] == 1
    assert counts["video"][niche_id]["last_at"] is not None

    # item toggle + removal
    off = await campaigns.set_item_enabled(item.id, user_id=uid, enabled=False)
    assert off.enabled is False
    assert await campaigns.remove_item(item.id, user_id=uid)
    assert await campaigns.list_items(c.id, user_id=uid) == []


async def test_campaign_tenant_scoping(pool):
    from marketer.repos import campaigns

    uid, other = await _mkuser(pool), await _mkuser(pool)
    c = await campaigns.create(user_id=uid, name="mine", budget_usd=Decimal("10"))

    assert await campaigns.get(c.id, user_id=other) is None
    assert await campaigns.set_status(c.id, user_id=other, status="running") is None
    assert await campaigns.list_for_user(other) == []
