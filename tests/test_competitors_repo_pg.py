"""Real-Postgres integration tests for the competitor tracking + alerts data
layer (migration 0022): competitors, competitor_articles, and
performance_alerts. Skip without MARKETER_DATABASE_URL (apply 0022 to that
database first — see db/migrations/0022_competitors_alerts.sql)."""
from __future__ import annotations

import os
from uuid import uuid4

import pytest

from marketer.repos import competitors as competitors_repo

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
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return uid


async def _mkniche(pool, user_id: str, *, articles_per_week: int = 0, title: str = "n"):
    row = await pool.fetchrow(
        """
        insert into niches (
            user_id, title, description, target_audience, visual_style, voice,
            target_duration_sec, scene_count, posting_windows, platforms,
            daily_spend_cap_usd, articles_per_week
        )
        values ($1, $2, 'd', 'aud', 'style', 'voice', 30, 3, '[]'::jsonb,
                '{tiktok}', 5.00, $3)
        returning id
        """,
        user_id, title, articles_per_week,
    )
    return row["id"]


# --------------------------------------------------------------------------- competitors


async def test_competitor_crud(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)

    created = await competitors_repo.create(
        user_id=uid, domain="rival.com", label="Rival", niche_id=nid,
    )
    assert created.domain == "rival.com"
    assert created.niche_id == nid

    listed = await competitors_repo.list_for_user(uid)
    assert len(listed) == 1 and listed[0].id == created.id

    fetched = await competitors_repo.get(created.id, user_id=uid)
    assert fetched is not None and fetched.domain == "rival.com"

    # Foreign user gets nothing back.
    other_uid = await _mkuser(pool)
    assert await competitors_repo.get(created.id, user_id=other_uid) is None

    deleted = await competitors_repo.delete(created.id, user_id=uid)
    assert deleted is True
    assert await competitors_repo.get(created.id, user_id=uid) is None


async def test_competitor_unique_per_user_domain(pool):
    uid = await _mkuser(pool)
    await competitors_repo.create(user_id=uid, domain="rival.com")

    with pytest.raises(Exception):  # asyncpg.UniqueViolationError
        await competitors_repo.create(user_id=uid, domain="rival.com")

    # A different user CAN track the same domain.
    other_uid = await _mkuser(pool)
    dup = await competitors_repo.create(user_id=other_uid, domain="rival.com")
    assert dup.domain == "rival.com"


async def test_list_active_spans_users(pool):
    uid_a = await _mkuser(pool)
    uid_b = await _mkuser(pool)
    await competitors_repo.create(user_id=uid_a, domain="a.com")
    await competitors_repo.create(user_id=uid_b, domain="b.com")

    active = await competitors_repo.list_active()
    domains = {c.domain for c in active if c.user_id in (uid_a, uid_b)}
    assert domains == {"a.com", "b.com"}


# --------------------------------------------------------------------------- competitor_articles


async def test_seen_urls_and_insert_articles_diff(pool):
    uid = await _mkuser(pool)
    comp = await competitors_repo.create(user_id=uid, domain="rival.com")

    urls = ["https://rival.com/a", "https://rival.com/b"]
    assert await competitors_repo.seen_urls(comp.id, urls) == set()

    inserted = await competitors_repo.insert_articles(comp.id, [
        {"url": urls[0], "title": "A"}, {"url": urls[1], "title": "B"},
    ])
    assert {a.url for a in inserted} == set(urls)

    # Now both are seen.
    assert await competitors_repo.seen_urls(comp.id, urls) == set(urls)

    # Re-inserting the same URLs is a no-op (idempotent diff), not an error.
    reinserted = await competitors_repo.insert_articles(comp.id, [
        {"url": urls[0], "title": "A"},
        {"url": "https://rival.com/c", "title": "C"},
    ])
    assert [a.url for a in reinserted] == ["https://rival.com/c"]

    listed = await competitors_repo.list_articles(comp.id, user_id=uid)
    assert len(listed) == 3

    # Ownership-scoped.
    other_uid = await _mkuser(pool)
    assert await competitors_repo.list_articles(comp.id, user_id=other_uid) == []


# --------------------------------------------------------------------------- performance_alerts


async def test_alert_create_list_dedupe_ack_flow(pool):
    uid = await _mkuser(pool)

    alert = await competitors_repo.create_alert(
        user_id=uid, kind="cadence_slip", severity="warn", message="slipping",
        context={"niche_id": "abc"},
    )
    assert alert.acknowledged_at is None
    assert alert.context == {"niche_id": "abc"}

    # Dedupe: identical unacknowledged alert is detected.
    assert await competitors_repo.has_unacknowledged(uid, kind="cadence_slip", message="slipping")
    assert not await competitors_repo.has_unacknowledged(uid, kind="cadence_slip", message="different")

    unacked = await competitors_repo.list_alerts_for_user(uid, acknowledged=False)
    assert len(unacked) == 1

    acked_empty = await competitors_repo.list_alerts_for_user(uid, acknowledged=True)
    assert acked_empty == []

    acked = await competitors_repo.acknowledge(alert.id, user_id=uid)
    assert acked is not None and acked.acknowledged_at is not None

    # A second ack on the same alert is a no-op (already acknowledged).
    assert await competitors_repo.acknowledge(alert.id, user_id=uid) is None

    # Dedupe no longer blocks a fresh alert once the old one is acked.
    assert not await competitors_repo.has_unacknowledged(uid, kind="cadence_slip", message="slipping")

    unacked_after = await competitors_repo.list_alerts_for_user(uid, acknowledged=False)
    assert unacked_after == []
    acked_after = await competitors_repo.list_alerts_for_user(uid, acknowledged=True)
    assert len(acked_after) == 1


async def test_alert_kind_and_severity_are_constrained(pool):
    uid = await _mkuser(pool)
    with pytest.raises(Exception):  # check constraint violation
        await competitors_repo.create_alert(
            user_id=uid, kind="not_a_real_kind", severity="warn", message="x",
        )


# --------------------------------------------------------------------------- alert_scan read helpers


async def test_niches_with_cadence_and_latest_article_days_since(pool):
    uid = await _mkuser(pool)
    active_nid = await _mkniche(pool, uid, articles_per_week=3, title="Active")
    await _mkniche(pool, uid, articles_per_week=0, title="Autopilot off")

    cadence_niches = {n["id"] for n in await competitors_repo.niches_with_cadence()}
    assert active_nid in cadence_niches

    # No articles yet -> None.
    assert await competitors_repo.latest_article_days_since(active_nid) is None

    await pool.execute(
        "insert into articles (user_id, niche_id, topic, status) values ($1, $2, 't', 'done')",
        uid, active_nid,
    )
    days = await competitors_repo.latest_article_days_since(active_nid)
    assert days is not None and days < 1.0


async def test_quality_scores_for_user_excludes_unscored(pool):
    import json

    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)

    await pool.execute(
        "insert into articles (user_id, niche_id, topic, status) values ($1, $2, 'unscored', 'writing')",
        uid, nid,
    )
    await pool.execute(
        """
        insert into articles (user_id, niche_id, topic, status, quality)
        values ($1, $2, 'scored', 'done', $3::jsonb)
        """,
        uid, nid, json.dumps({"overall": 0.77, "keywordDensity": 0.01,
                               "eeatScore": 0.8, "readability": 0.9, "notes": []}),
    )

    scores = await competitors_repo.quality_scores_for_user(uid)
    assert len(scores) == 1
    assert scores[0]["overall"] == pytest.approx(0.77)

    users = await competitors_repo.distinct_users_with_scored_articles()
    assert uid in users


async def test_gsc_daily_exists_reflects_real_catalog_state(pool):
    """Doesn't assert a fixed True/False (Team GSC ships gsc_daily
    concurrently and may have already applied it in this shared test DB) —
    just that the guard reads real Postgres catalog state rather than
    hardcoding an assumption. The alert_scan unit tests
    (test_alert_scan.py) cover both branches of the guard deterministically
    via monkeypatching."""
    exists = await competitors_repo.gsc_daily_exists()
    real = await pool.fetchval("select to_regclass('public.gsc_daily') is not null")
    assert exists == real
