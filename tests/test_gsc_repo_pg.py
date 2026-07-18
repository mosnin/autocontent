"""Real-Postgres integration tests for the GSC data layer: connections CRUD,
gsc_daily upsert (conflict-on-key semantics), the rankings/queries
aggregates, and the gap-finding join against the real articles table. Skip
without MARKETER_DATABASE_URL (apply 0019 to that database first — see
db/migrations/0019_gsc.sql)."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from marketer.repos import articles as articles_repo
from marketer.repos import gsc as gsc_repo

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


async def _mkniche(pool, user_id: str) -> str:
    row = await pool.fetchrow(
        """
        insert into niches (
            user_id, title, description, target_audience, visual_style, voice,
            target_duration_sec, scene_count, posting_windows, platforms,
            daily_spend_cap_usd, articles_per_week
        )
        values ($1, 'n', 'd', 'aud', 'style', 'voice', 30, 3, '[]'::jsonb,
                '{tiktok}', 5.00, 0)
        returning id
        """,
        user_id,
    )
    return row["id"]


async def _mkarticle(pool, *, user_id: str, niche_id, title: str = "", focus_keyword: str = ""):
    art = await articles_repo.create(user_id=user_id, niche_id=niche_id, topic=title or focus_keyword, focus_keyword=focus_keyword)
    if title:
        art.title = title
        await articles_repo.save(art)
    return art


# --------------------------------------------------------------------------- connections

async def test_connection_upsert_set_site_and_delete(pool):
    uid = await _mkuser(pool)

    created = await gsc_repo.upsert_connection(
        user_id=uid, refresh_token="rt-1", access_token="at-1",
        token_expires_at=datetime.now(timezone.utc),
    )
    assert created.site_url == ""

    fetched = await gsc_repo.get_connection(uid)
    assert fetched is not None and fetched.refresh_token == "rt-1"

    with_site = await gsc_repo.set_site(uid, site_url="https://example.com/")
    assert with_site.site_url == "https://example.com/"

    # Re-connecting (upsert) refreshes tokens but leaves site_url alone.
    reconnected = await gsc_repo.upsert_connection(
        user_id=uid, refresh_token="rt-2", access_token="at-2", token_expires_at=None,
    )
    assert reconnected.refresh_token == "rt-2"
    assert reconnected.site_url == "https://example.com/"

    deleted = await gsc_repo.delete_connection(uid)
    assert deleted is True
    assert await gsc_repo.get_connection(uid) is None
    assert await gsc_repo.delete_connection(uid) is False


async def test_set_tokens_preserves_refresh_token_when_omitted(pool):
    uid = await _mkuser(pool)
    await gsc_repo.upsert_connection(
        user_id=uid, refresh_token="rt-orig", access_token="at-orig", token_expires_at=None,
    )
    new_expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    await gsc_repo.set_tokens(uid, access_token="at-refreshed", token_expires_at=new_expiry)

    fetched = await gsc_repo.get_connection(uid)
    assert fetched.access_token == "at-refreshed"
    assert fetched.refresh_token == "rt-orig"  # untouched


async def test_list_all_connections(pool):
    uid1 = await _mkuser(pool)
    uid2 = await _mkuser(pool)
    await gsc_repo.upsert_connection(user_id=uid1, refresh_token="a", access_token="a", token_expires_at=None)
    await gsc_repo.upsert_connection(user_id=uid2, refresh_token="b", access_token="b", token_expires_at=None)

    conns = await gsc_repo.list_all_connections()
    user_ids = {c.user_id for c in conns}
    assert {uid1, uid2} <= user_ids


# --------------------------------------------------------------------------- gsc_daily upsert + aggregates

async def test_upsert_daily_is_idempotent_on_conflict_key(pool):
    uid = await _mkuser(pool)
    day = date(2026, 7, 15)

    rows = [
        {"date": day, "query": "espresso machines", "page": "/blog/espresso", "clicks": 3, "impressions": 40, "ctr": 0.075, "position": 8.0},
    ]
    n = await gsc_repo.upsert_daily(uid, rows)
    assert n == 1

    # Re-sync of the same (user, date, query, page) with fresher numbers
    # updates in place rather than duplicating.
    rows2 = [
        {"date": day, "query": "espresso machines", "page": "/blog/espresso", "clicks": 9, "impressions": 100, "ctr": 0.09, "position": 5.5},
    ]
    await gsc_repo.upsert_daily(uid, rows2)

    top = await gsc_repo.top_queries(uid, start=day, end=day)
    assert len(top) == 1
    assert top[0]["clicks"] == 9
    assert top[0]["impressions"] == 100


async def test_upsert_daily_empty_batch_is_noop(pool):
    uid = await _mkuser(pool)
    assert await gsc_repo.upsert_daily(uid, []) == 0


async def test_top_queries_and_positions_for_queries(pool):
    uid = await _mkuser(pool)
    today = date.today()
    yesterday = today - timedelta(days=1)

    await gsc_repo.upsert_daily(uid, [
        {"date": today, "query": "espresso machines", "page": "/p1", "clicks": 10, "impressions": 200, "ctr": 0.05, "position": 4.0},
        {"date": today, "query": "pour over kettle", "page": "/p2", "clicks": 2, "impressions": 50, "ctr": 0.04, "position": 18.0},
    ])
    # Prior-period data for the delta comparison.
    await gsc_repo.upsert_daily(uid, [
        {"date": yesterday, "query": "espresso machines", "page": "/p1", "clicks": 4, "impressions": 100, "ctr": 0.04, "position": 9.0},
    ])

    top = await gsc_repo.top_queries(uid, start=today, end=today, limit=10)
    assert top[0]["query"] == "espresso machines"
    assert top[0]["clicks"] == 10

    positions = await gsc_repo.positions_for_queries(
        uid, ["espresso machines", "pour over kettle"], start=yesterday, end=yesterday,
    )
    assert positions["espresso machines"] == Decimal("9.00") or float(positions["espresso machines"]) == 9.0
    assert "pour over kettle" not in positions  # no data in that window


async def test_queries_for_page_filters_by_page(pool):
    uid = await _mkuser(pool)
    today = date.today()
    await gsc_repo.upsert_daily(uid, [
        {"date": today, "query": "q1", "page": "/a", "clicks": 1, "impressions": 10, "ctr": 0.1, "position": 3.0},
        {"date": today, "query": "q2", "page": "/b", "clicks": 5, "impressions": 20, "ctr": 0.25, "position": 2.0},
    ])
    rows = await gsc_repo.queries_for_page(uid, page="/a", start=today, end=today)
    assert len(rows) == 1
    assert rows[0]["query"] == "q1"


async def test_gap_candidates_filters_by_impressions_and_position(pool):
    uid = await _mkuser(pool)
    today = date.today()
    await gsc_repo.upsert_daily(uid, [
        # Below the impressions floor — excluded.
        {"date": today, "query": "low impressions", "page": "/x", "clicks": 0, "impressions": 5, "ctr": 0, "position": 25.0},
        # Ranking well already — excluded.
        {"date": today, "query": "ranking fine", "page": "/y", "clicks": 10, "impressions": 100, "ctr": 0.1, "position": 5.0},
        # Meaningful impressions + poor position — a genuine gap candidate.
        {"date": today, "query": "buried query", "page": "/z", "clicks": 0, "impressions": 80, "ctr": 0, "position": 27.0},
    ])
    gaps = await gsc_repo.gap_candidates(uid, start=today, end=today, min_impressions=20, min_position=20.0)
    queries = {g["query"] for g in gaps}
    assert queries == {"buried query"}


async def test_article_terms_and_gap_join(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    await _mkarticle(pool, user_id=uid, niche_id=nid, title="Espresso Machines Buying Guide", focus_keyword="espresso machines")

    terms = await gsc_repo.article_terms(uid)
    assert ("Espresso Machines Buying Guide", "espresso machines") in terms

    # A second, unrelated user's articles never leak into this user's terms.
    other_uid = await _mkuser(pool)
    other_nid = await _mkniche(pool, other_uid)
    await _mkarticle(pool, user_id=other_uid, niche_id=other_nid, title="Unrelated", focus_keyword="unrelated topic")

    terms_after = await gsc_repo.article_terms(uid)
    assert all(t[1] != "unrelated topic" for t in terms_after)
