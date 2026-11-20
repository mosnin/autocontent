"""Real-Postgres coverage for marketer.repos.workspace: the cross-department
aggregates (KPIs, daily series, pipeline counts, top content, inbox, activity)
and tenant scoping. Also the image-post reject claim."""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)

UTC = timezone.utc


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
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return uid


async def _mkniche(pool, uid, title="Coffee"):
    return await pool.fetchval(
        """
        insert into niches (user_id, title, description, target_audience,
            visual_style, voice, target_duration_sec, scene_count,
            posting_windows, platforms, daily_spend_cap_usd)
        values ($1,$2,'d','a','v','onyx',30,2,'[]'::jsonb,'{tiktok}',5.0)
        returning id
        """,
        uid, title,
    )


async def _job(pool, uid, niche, *, status, at, topic=None, platform="tiktok"):
    payload = {"script": {"idea": {"topic": topic}}} if topic else {}
    return await pool.fetchval(
        """
        insert into jobs (user_id, niche_id, platform, status, payload, created_at)
        values ($1, $2, $3, $4::job_status, $5::jsonb, $6) returning id
        """,
        uid, niche, platform, status, json.dumps(payload), at,
    )


async def _set_updated(pool, table, row_id, at):
    # jobs/articles have a set_updated_at trigger; disable it for the backdate.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f"alter table {table} disable trigger user")
            await conn.execute(f"update {table} set updated_at = $2 where id = $1", row_id, at)
            await conn.execute(f"alter table {table} enable trigger user")


async def _image_post(pool, uid, niche, *, status, at, topic="5 diagrams"):
    return await pool.fetchval(
        """
        insert into image_posts (user_id, niche_id, kind, topic, status, created_at, updated_at)
        values ($1, $2, 'carousel', $3, $4, $5, $5) returning id
        """,
        uid, niche, topic, status, at,
    )


async def _article(pool, uid, niche, *, status, at, title="Guide"):
    aid = await pool.fetchval(
        """
        insert into articles (user_id, niche_id, status, title, created_at)
        values ($1, $2, $3::article_status, $4, $5) returning id
        """,
        uid, niche, status, title, at,
    )
    await _set_updated(pool, "articles", aid, at)
    return aid


async def _metric(pool, uid, job_id, *, at, views, likes=0, comments=0, shares=0, saves=0):
    await pool.execute(
        """
        insert into post_metrics (user_id, job_id, provider_post_id, platform,
            sampled_at, views, likes, comments, shares, saves, raw)
        values ($1, $2, 'pp', 'tiktok', $3, $4, $5, $6, $7, $8, '{}'::jsonb)
        """,
        uid, job_id, at, views, likes, comments, shares, saves,
    )


async def _spend(pool, uid, niche, *, at, usd):
    await pool.execute(
        """
        insert into spend_ledger (user_id, niche_id, provider, sku, units, cost_usd, created_at)
        values ($1, $2, 'openai', 'x', 1, $3, $4)
        """,
        uid, niche, Decimal(usd), at,
    )


async def _ads(pool, uid, niche, *, budget="20"):
    acc = await pool.fetchval(
        "insert into ad_accounts (user_id, platform, status) values ($1, 'google_ads', 'active') returning id",
        uid,
    )
    camp = await pool.fetchval(
        """insert into ad_campaigns (user_id, ad_account_id, name, status, daily_budget_usd, niche_id)
           values ($1, $2, 'Spring sale', 'active', $3, $4) returning id""",
        uid, acc, Decimal(budget), niche,
    )
    return acc, camp


def _window(days: int, today: date):
    start = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), UTC)
    end = datetime.combine(today + timedelta(days=1), datetime.min.time(), UTC)
    return start, end


async def test_overview_aggregates_and_scoping(pool):
    from marketer.repos import ads as ads_repo
    from marketer.repos import workspace as ws

    uid = await _mkuser(pool)
    other = await _mkuser(pool)
    niche = await _mkniche(pool, uid)
    other_niche = await _mkniche(pool, other)

    today = datetime.now(UTC).date()
    start, end = _window(7, today)
    noon = datetime.combine(today, datetime.min.time(), UTC) + timedelta(hours=12)
    y_noon = noon - timedelta(days=1)

    # Two done videos (one yesterday), one failed, one in flight, one awaiting.
    v1 = await _job(pool, uid, niche, status="done", at=y_noon, topic="Brew myths")
    v2 = await _job(pool, uid, niche, status="done", at=noon, topic="Latte art")
    await _job(pool, uid, niche, status="failed", at=noon)
    await _job(pool, uid, niche, status="voicing", at=noon)
    await _job(pool, uid, niche, status="awaiting_approval", at=noon)
    old = await _job(pool, uid, niche, status="done", at=noon - timedelta(days=10))
    for j, at in ((v1, y_noon), (v2, noon), (old, noon - timedelta(days=10))):
        await _set_updated(pool, "jobs", j, at)
    # done carousel today; done article yesterday; article in flight.
    await _image_post(pool, uid, niche, status="done", at=noon)
    await _article(pool, uid, niche, status="done", at=y_noon, title="Pour-over guide")
    await _article(pool, uid, niche, status="writing", at=noon)

    # Metrics: v1 sampled twice (yesterday 100, today 250); v2 today 50.
    await _metric(pool, uid, v1, at=y_noon, views=100, likes=1)
    await _metric(pool, uid, v1, at=noon, views=250, likes=10, comments=2, shares=1, saves=1)
    await _metric(pool, uid, v2, at=noon, views=50, likes=5)

    await _spend(pool, uid, niche, at=noon, usd="0.40")
    await _spend(pool, uid, niche, at=y_noon, usd="1.1234")
    await _spend(pool, uid, niche, at=noon - timedelta(days=8), usd="3.00")  # previous window

    acc, camp = await _ads(pool, uid, niche)
    await ads_repo.upsert_metrics(
        user_id=uid, ad_account_id=acc, campaign_id=camp, day=today,
        clicks=7, spend_usd=Decimal("2.40"), conversions=Decimal("2.5"),
    )
    await pool.execute(
        "insert into ad_approvals (user_id, campaign_id, action, payload_json) "
        "values ($1, $2, 'budget.change', '{\"new_daily_budget_usd\": \"35\"}')",
        uid, camp,
    )

    # Noise in another tenant must never leak.
    ov = await _job(pool, other, other_niche, status="done", at=noon)
    await _metric(pool, other, ov, at=noon, views=99999)
    await _spend(pool, other, other_niche, at=noon, usd="50")

    k = await ws.window_kpis(uid, start=start, end=end)
    assert k["content_spend_usd"] == Decimal("1.5234")
    assert k["ad_spend_usd"] == Decimal("2.40")
    assert k["ad_clicks"] == 7
    assert k["ad_conversions"] == Decimal("2.5")
    assert k["posts_published"] == 3  # v1, v2, carousel
    assert k["articles_published"] == 1
    assert k["views"] == 300  # latest per post: 250 + 50
    assert k["engagements"] == 14 + 5

    prev = await ws.window_kpis(uid, start=start - timedelta(days=7), end=start)
    assert prev["content_spend_usd"] == Decimal("3.00")
    assert prev["posts_published"] == 1  # the 10-day-old video
    assert prev["views"] == 0

    series = await ws.daily_series(uid, start=start, end=end)
    yday = today - timedelta(days=1)
    assert series[today]["content_spend_usd"] == Decimal("0.40")
    assert series[today]["ad_spend_usd"] == Decimal("2.40")
    assert series[today]["posts"] == 2
    assert series[today]["views"] == 150 + 50  # v1 gained 150, v2 first sample 50
    assert series[yday]["views"] == 100
    assert series[yday]["posts"] == 1
    assert series[yday]["content_spend_usd"] == Decimal("1.1234")

    pipe = await ws.pipeline_counts(uid, start=start, end=end)
    assert pipe["content"] == {"active": 2, "done": 3, "failed": 1}
    assert pipe["seo"] == {"active": 1, "done": 1, "failed": 0}
    assert pipe["ads"] == {"active_campaigns": 1, "pending_approvals": 1}

    top = await ws.top_content(uid, start=start, end=end, limit=8)
    assert [t["kind"] for t in top][:2] == ["video", "video"]
    assert top[0]["title"] == "Brew myths" and top[0]["views"] == 250
    assert top[0]["platform"] == "tiktok"
    kinds = {t["kind"] for t in top}
    assert kinds == {"video", "carousel", "article"}
    art = next(t for t in top if t["kind"] == "article")
    assert art["views"] is None and art["platform"] is None
    assert art["title"] == "Pour-over guide"
    assert all(t["id"] != str(ov) for t in top)


async def test_inbox_items_and_image_post_reject(pool):
    from marketer.repos import image_posts as ip_repo
    from marketer.repos import workspace as ws

    uid = await _mkuser(pool)
    other = await _mkuser(pool)
    niche = await _mkniche(pool, uid, "Coffee")
    now = datetime.now(UTC)
    vid = await _job(pool, uid, niche, status="awaiting_approval", at=now - timedelta(hours=2),
                     topic="Myths")
    car = await _image_post(pool, uid, niche, status="awaiting_approval",
                            at=now - timedelta(hours=1))
    await _image_post(pool, uid, niche, status="done", at=now)
    _, camp = await _ads(pool, uid, niche, budget="20")
    appr = await pool.fetchval(
        "insert into ad_approvals (user_id, campaign_id, action, summary, payload_json) "
        "values ($1, $2, 'budget.change', 'Set daily budget to $35', "
        "'{\"new_daily_budget_usd\": \"35\"}') returning id",
        uid, camp,
    )
    await pool.execute(
        "insert into ad_approvals (user_id, action, status) values ($1, 'budget.change', 'rejected')",
        uid,
    )
    other_niche = await _mkniche(pool, other)
    await _job(pool, other, other_niche, status="awaiting_approval", at=now)

    items = await ws.inbox_items(uid)
    assert [i["source"] for i in items] == ["ad_change", "carousel", "video"]
    ad, c, v = items
    assert ad["id"] == appr and ad["campaign_name"] == "Spring sale"
    assert ad["campaign_daily_budget_usd"] == Decimal("20.00")
    assert ad["payload"] == {"new_daily_budget_usd": "35"}
    assert ad["niche_id"] == niche
    assert c["id"] == car and c["title"] == "5 diagrams" and c["niche_title"] == "Coffee"
    assert v["id"] == vid and v["title"] == "Myths" and v["platform"] == "tiktok"

    # Reject claim: only from awaiting_approval, only for the owner.
    assert await ip_repo.claim_for_rejection(car, user_id=other) is None
    rejected = await ip_repo.claim_for_rejection(car, user_id=uid)
    assert rejected["status"] == "failed"
    assert rejected["error"] == ip_repo.REJECTION_ERROR
    assert await ip_repo.claim_for_rejection(car, user_id=uid) is None
    assert [i["source"] for i in await ws.inbox_items(uid)] == ["ad_change", "video"]


async def test_activity_merge_and_pagination(pool):
    from marketer.repos import ad_actions
    from marketer.repos import workspace as ws

    uid = await _mkuser(pool)
    other = await _mkuser(pool)
    niche = await _mkniche(pool, uid)
    base = datetime.now(UTC) - timedelta(hours=1)

    j = await _job(pool, uid, niche, status="done", at=base, topic="Myths")
    await _set_updated(pool, "jobs", j, base)
    a = await _article(pool, uid, niche, status="failed", at=base - timedelta(minutes=1))
    await _image_post(pool, uid, niche, status="awaiting_approval",
                      at=base - timedelta(minutes=2))
    await ad_actions.record(user_id=uid, action="budget.change", target_type="ad_campaign",
                            target_id="c1", dollar_delta_usd=Decimal("15"))
    await pool.execute(
        "update ad_actions_log set created_at = $2 where user_id = $1",
        uid, base - timedelta(minutes=3),
    )
    await pool.execute(
        "insert into ad_approvals (user_id, action, summary, status, decided_by, decided_at) "
        "values ($1, 'budget.change', 'Set daily budget to $35', 'executed', 'me', $2)",
        uid, base - timedelta(minutes=4),
    )
    await pool.execute(
        "insert into ad_approvals (user_id, action) values ($1, 'budget.change')", uid,
    )  # pending → not an activity event
    await pool.execute(
        "insert into campaigns (user_id, name, budget_usd, status, updated_at) "
        "values ($1, 'Launch', 100, 'running', $2)",
        uid, base - timedelta(minutes=5),
    )
    other_niche = await _mkniche(pool, other)
    await _job(pool, other, other_niche, status="done", at=base)

    events = await ws.activity_events(uid, before=None, limit=50)
    assert [e["source"] for e in events] == [
        "video", "article", "carousel", "ad_action", "approval", "campaign",
    ]
    assert events[0]["id"] == j and events[0]["title"] == "Myths"
    assert events[1]["id"] == a and events[1]["status"] == "failed"

    page1 = await ws.activity_events(uid, before=None, limit=2)
    assert [e["source"] for e in page1] == ["video", "article"]
    page2 = await ws.activity_events(uid, before=page1[-1]["at"], limit=2)
    assert [e["source"] for e in page2] == ["carousel", "ad_action"]
    page3 = await ws.activity_events(uid, before=page2[-1]["at"], limit=2)
    assert [e["source"] for e in page3] == ["approval", "campaign"]
