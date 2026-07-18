"""Real-Postgres integration tests for the content-intel data layer:
content_clusters, content_cluster_items, article_audits, and
cannibalization_findings from migration 0021. Skip without
MARKETER_DATABASE_URL (apply 0021 to that database first — see
db/migrations/0021_content_intel.sql)."""
from __future__ import annotations

import os
from uuid import uuid4

import pytest

from marketer.repos import content_intel as repo

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


async def _mkniche(pool, user_id: str):
    row = await pool.fetchrow(
        """
        insert into niches (
            user_id, title, description, target_audience, visual_style, voice,
            target_duration_sec, scene_count, posting_windows, platforms,
            daily_spend_cap_usd
        )
        values ($1, 'n', 'd', 'aud', 'style', 'voice', 30, 3, '[]'::jsonb,
                '{tiktok}', 5.00)
        returning id
        """,
        user_id,
    )
    return row["id"]


async def _mkarticle(pool, user_id: str, niche_id, *, title="Article", focus_keyword="kw"):
    row = await pool.fetchrow(
        """
        insert into articles (user_id, niche_id, topic, focus_keyword, title, status)
        values ($1, $2, $3, $4, $5, 'done')
        returning id
        """,
        user_id, niche_id, title, focus_keyword, title,
    )
    return row["id"]


# --------------------------------------------------------------------------- content_clusters / items


async def test_cluster_lifecycle(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)

    cluster = await repo.create_cluster(
        user_id=uid, niche_id=nid, title="Espresso Cluster", pillar_keyword="espresso",
        description="pillar + spokes",
    )
    assert cluster.title == "Espresso Cluster"

    item1 = await repo.add_item(
        cluster_id=cluster.id, proposed_title="Spoke A", focus_keyword="kw a",
    )
    item2 = await repo.add_item(
        cluster_id=cluster.id, proposed_title="Spoke B", focus_keyword="kw b", status="covered",
    )
    assert item1.status == "proposed"
    assert item2.status == "covered"

    listed = await repo.list_clusters(uid)
    assert len(listed) == 1 and listed[0].id == cluster.id

    items = await repo.list_items(cluster.id)
    assert {i.id for i in items} == {item1.id, item2.id}

    fetched = await repo.get_cluster(cluster.id, user_id=uid)
    assert fetched is not None and fetched.id == cluster.id

    # Foreign user can't see it.
    other_uid = await _mkuser(pool)
    assert await repo.get_cluster(cluster.id, user_id=other_uid) is None

    deleted = await repo.delete_cluster(cluster.id, user_id=uid)
    assert deleted is True
    assert await repo.get_cluster(cluster.id, user_id=uid) is None
    # Cascade: items go with it.
    assert await repo.list_items(cluster.id) == []


async def test_get_item_with_niche_and_mark_covered(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    cluster = await repo.create_cluster(user_id=uid, niche_id=nid, title="C", pillar_keyword="p")
    item = await repo.add_item(cluster_id=cluster.id, proposed_title="Spoke", focus_keyword="kw")

    fetched = await repo.get_item_with_niche(cluster.id, item.id, user_id=uid)
    assert fetched is not None
    assert fetched.niche_id == nid
    assert fetched.status == "proposed"

    # Wrong cluster_id or foreign user both miss.
    assert await repo.get_item_with_niche(uuid4(), item.id, user_id=uid) is None
    other_uid = await _mkuser(pool)
    assert await repo.get_item_with_niche(cluster.id, item.id, user_id=other_uid) is None

    article_id = await _mkarticle(pool, uid, nid, title="Promoted article")
    covered = await repo.mark_item_covered(item.id, article_id=article_id)
    assert covered.status == "covered"
    assert covered.article_id == article_id


# --------------------------------------------------------------------------- article_audits


async def test_article_audits_latest_per_article(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    art = await _mkarticle(pool, uid, nid)

    first = await repo.save_audit(
        user_id=uid, article_id=art, score=40.0, findings=[{"code": "stale", "severity": "high", "message": "old"}],
    )
    assert first.score == 40.0
    assert first.findings[0]["code"] == "stale"

    second = await repo.save_audit(user_id=uid, article_id=art, score=80.0, findings=[])
    assert second.created_at >= first.created_at

    latest = await repo.latest_audits(uid)
    assert len(latest) == 1  # collapsed to one row per article
    assert latest[0].score == 80.0


# --------------------------------------------------------------------------- cannibalization_findings


async def test_cannibalization_upsert_keeps_resolution(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    a = await _mkarticle(pool, uid, nid, title="A")
    b = await _mkarticle(pool, uid, nid, title="B")

    first = await repo.upsert_finding(
        user_id=uid, article_a=a, article_b=b, keyword="best grinders", similarity=0.8,
    )
    assert first.resolution == ""

    # A human resolves it out of band.
    await pool.execute(
        "update cannibalization_findings set resolution = $2 where id = $1",
        first.id, "merged into A",
    )

    # Re-scan refreshes similarity/keyword but must not clobber resolution.
    again = await repo.upsert_finding(
        user_id=uid, article_a=a, article_b=b, keyword="best grinders", similarity=0.93,
    )
    assert again.id == first.id
    assert again.similarity == 0.93
    assert again.resolution == "merged into A"

    listed = await repo.list_findings(uid)
    assert len(listed) == 1
    assert listed[0].similarity == 0.93

    # Ownership scoped.
    other_uid = await _mkuser(pool)
    assert await repo.list_findings(other_uid) == []
