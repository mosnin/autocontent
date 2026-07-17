"""Real-Postgres integration tests for the press planner data layer:
topic_proposals, publish_targets, article_publishes, and the new
articles.scheduled_at/serp_analysis + niches.articles_per_week columns
from migration 0017. Skip without MARKETER_DATABASE_URL (apply 0017 to
that database first — see db/migrations/0017_press_planner.sql)."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from marketer.repos import articles as articles_repo
from marketer.repos import calendar as calendar_repo
from marketer.repos import publish_targets as targets_repo
from marketer.repos import topic_proposals as proposals_repo

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


async def _mkniche(pool, user_id: str, *, articles_per_week: int = 0):
    row = await pool.fetchrow(
        """
        insert into niches (
            user_id, title, description, target_audience, visual_style, voice,
            target_duration_sec, scene_count, posting_windows, platforms,
            daily_spend_cap_usd, articles_per_week
        )
        values ($1, 'n', 'd', 'aud', 'style', 'voice', 30, 3, '[]'::jsonb,
                '{tiktok}', 5.00, $2)
        returning id
        """,
        user_id, articles_per_week,
    )
    return row["id"]


# --------------------------------------------------------------------------- topic_proposals

async def test_topic_proposal_lifecycle(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)

    p = await proposals_repo.create(
        user_id=uid, niche_id=nid, title="Best grinders 2026",
        focus_keyword="best grinders", rationale="high intent", score=0.75,
    )
    assert p.status == "pending"
    assert p.decided_at is None

    pending = await proposals_repo.list_for_user(uid, status="pending")
    assert len(pending) == 1 and pending[0].id == p.id

    approved = await proposals_repo.decide(p.id, user_id=uid, status="approved")
    assert approved is not None
    assert approved.status == "approved"
    assert approved.decided_at is not None

    # A second decide on an already-decided proposal is a no-op (one-shot).
    again = await proposals_repo.decide(p.id, user_id=uid, status="rejected")
    assert again is None

    fetched = await proposals_repo.get(p.id, user_id=uid)
    assert fetched.status == "approved"


async def test_consume_oldest_approved_picks_fifo_and_is_one_shot(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)

    first = await proposals_repo.create(user_id=uid, niche_id=nid, title="First")
    await proposals_repo.decide(first.id, user_id=uid, status="approved")
    second = await proposals_repo.create(user_id=uid, niche_id=nid, title="Second")
    await proposals_repo.decide(second.id, user_id=uid, status="approved")

    claimed = await proposals_repo.consume_oldest_approved(nid)
    assert claimed.id == first.id

    claimed_next = await proposals_repo.consume_oldest_approved(nid)
    assert claimed_next.id == second.id

    # Both proposals are now claimed; nothing left to consume.
    assert await proposals_repo.consume_oldest_approved(nid) is None

    # A consumed proposal never reappears in the approved queue.
    approved_left = await proposals_repo.list_for_user(uid, status="approved")
    assert approved_left == []


# --------------------------------------------------------------------------- publish_targets

async def test_publish_target_crud_hides_secret(pool):
    uid = await _mkuser(pool)

    created = await targets_repo.create(
        user_id=uid, kind="wordpress", name="Blog", base_url="https://b.com",
        username="editor", secret="app-pass",
    )
    assert not hasattr(created, "secret")

    listed = await targets_repo.list_for_user(uid)
    assert len(listed) == 1 and listed[0].id == created.id

    with_secret = await targets_repo.get_with_secret(created.id, user_id=uid)
    assert with_secret.secret == "app-pass"

    sole = await targets_repo.sole_enabled(uid)
    assert sole is not None and sole.id == created.id

    deleted = await targets_repo.delete(created.id, user_id=uid)
    assert deleted is True
    assert await targets_repo.get(created.id, user_id=uid) is None


async def test_sole_enabled_requires_exactly_one(pool):
    uid = await _mkuser(pool)
    assert await targets_repo.sole_enabled(uid) is None  # zero targets

    await targets_repo.create(
        user_id=uid, kind="webhook", name="A", base_url="https://a.com", secret="s1",
    )
    assert (await targets_repo.sole_enabled(uid)) is not None

    await targets_repo.create(
        user_id=uid, kind="webhook", name="B", base_url="https://b.com", secret="s2",
    )
    assert await targets_repo.sole_enabled(uid) is None  # two now — ambiguous


# --------------------------------------------------------------------------- articles: scheduled_at / serp_analysis / publish attempts

async def test_article_scheduled_at_and_serp_analysis_roundtrip(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    when = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)

    art = await articles_repo.create(
        user_id=uid, niche_id=nid, topic="espresso", focus_keyword="espresso",
        scheduled_at=when,
    )
    assert art.scheduled_at == when
    assert art.serp_analysis is None

    art.serp_analysis = {"avgWordCount": 1500, "commonHeadings": ["Intro"]}
    art.status = art.status  # unchanged; exercise save() with serp_analysis set
    await articles_repo.save(art)

    fetched = await articles_repo.get(art.id, user_id=uid)
    assert fetched.serp_analysis == {"avgWordCount": 1500, "commonHeadings": ["Intro"]}
    assert fetched.scheduled_at == when


async def test_article_publish_attempts_recorded(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    art = await articles_repo.create(user_id=uid, niche_id=nid, topic="espresso")
    target = await targets_repo.create(
        user_id=uid, kind="wordpress", name="Blog", base_url="https://b.com",
        username="e", secret="s",
    )

    attempt = await articles_repo.create_publish_attempt(
        article_id=art.id, target_id=target.id
    )
    assert attempt.status == "pending"

    await articles_repo.mark_publish_ok(attempt.id, external_url="https://b.com/1")
    listed = await articles_repo.list_publishes(art.id, user_id=uid)
    assert len(listed) == 1
    assert listed[0].status == "ok"
    assert listed[0].external_url == "https://b.com/1"

    attempt2 = await articles_repo.create_publish_attempt(
        article_id=art.id, target_id=target.id
    )
    await articles_repo.mark_publish_failed(attempt2.id, error="timeout")
    listed2 = await articles_repo.list_publishes(art.id, user_id=uid)
    assert len(listed2) == 2
    assert {p.status for p in listed2} == {"ok", "failed"}

    # Ownership-scoped: a foreign user gets nothing back.
    other_uid = await _mkuser(pool)
    assert await articles_repo.list_publishes(art.id, user_id=other_uid) == []


# --------------------------------------------------------------------------- calendar

async def test_calendar_uses_scheduled_at_when_present(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    future = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)

    scheduled = await articles_repo.create(
        user_id=uid, niche_id=nid, topic="scheduled piece", scheduled_at=future,
    )
    unscheduled = await articles_repo.create(user_id=uid, niche_id=nid, topic="no schedule yet")

    start = datetime.now(timezone.utc) - timedelta(days=1)
    end = datetime.now(timezone.utc) + timedelta(days=10)
    items = {i.id: i for i in await calendar_repo.items_for_user(uid, start=start, end=end)}

    assert str(scheduled.id) in items
    assert items[str(scheduled.id)].scheduled is True
    assert items[str(scheduled.id)].at == future

    assert str(unscheduled.id) in items
    assert items[str(unscheduled.id)].scheduled is False


# --------------------------------------------------------------------------- niches.articles_per_week (autopilot cadence column)

async def test_niches_articles_per_week_defaults_and_updates(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)  # default articles_per_week = 0
    val = await pool.fetchval("select articles_per_week from niches where id = $1", nid)
    assert val == 0

    await pool.execute("update niches set articles_per_week = 3 where id = $1", nid)
    val2 = await pool.fetchval("select articles_per_week from niches where id = $1", nid)
    assert val2 == 3
