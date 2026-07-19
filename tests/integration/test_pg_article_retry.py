"""Real-Postgres: articles.claim_for_retry is an atomic failed->queued claim.

Closes the same double-spawn TOCTOU class fixed for jobs in cycle 3 —
two concurrent article retries (retry route + Failures inbox replay) must
not both spawn run_article_pipeline.
"""
from __future__ import annotations

import asyncio
import os
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


async def _mkfailed_article(pool, uid, niche_id, *, error="boom"):
    aid = uuid4()
    await pool.execute(
        """
        insert into articles (id, user_id, niche_id, status, topic,
            focus_keyword, error)
        values ($1,$2,$3,'failed','how to X','x',$4)
        """,
        aid, uid, niche_id, error,
    )
    return aid


async def test_concurrent_article_retry_exactly_one_winner(pool):
    from marketer.repos import articles as articles_repo

    uid = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)
    aid = await _mkfailed_article(pool, uid, niche_id)

    results = await asyncio.gather(
        *[articles_repo.claim_for_retry(aid, user_id=uid) for _ in range(8)]
    )
    winners = [r for r in results if r is not None]
    assert len(winners) == 1
    assert winners[0].status.value == "queued"
    assert winners[0].error is None
    # Already queued -> nothing left to claim.
    assert await articles_repo.claim_for_retry(aid, user_id=uid) is None


async def test_article_retry_foreign_user_denied(pool):
    from marketer.repos import articles as articles_repo

    uid = await _mkuser(pool)
    other = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)
    aid = await _mkfailed_article(pool, uid, niche_id)
    assert await articles_repo.claim_for_retry(aid, user_id=other) is None
    # Real owner can still claim it.
    assert await articles_repo.claim_for_retry(aid, user_id=uid) is not None
