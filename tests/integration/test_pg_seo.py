"""Real Postgres: migration 0035's tables and the SEO repos."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
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
        await conn.execute("delete from users where id like 'seo_%'")


async def _setup(pool):
    uid = f"seo_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    niche = await pool.fetchval(
        """
        insert into niches (user_id, title, description, target_audience, visual_style, voice,
            target_duration_sec, scene_count, posting_windows, platforms, daily_spend_cap_usd)
        values ($1,'t','d','a','v','onyx',30,2,'[]'::jsonb,'{tiktok}',5.0) returning id
        """,
        uid,
    )
    return uid, niche


async def test_publish_state_machine_and_calendar(pool):
    from marketer.repos import article_seo, calendar
    from marketer.repos import articles as articles_repo

    uid, niche = await _setup(pool)
    a = await articles_repo.create(user_id=uid, niche_id=niche, topic="cold brew")
    await pool.execute("update articles set status = 'done' where id = $1", a.id)
    await article_seo.set_research(a.id, user_id=uid, research={"query": "cold brew", "model": "m", "sources": []})
    out = await article_seo.set_seo_meta(
        a.id, user_id=uid, meta_title="Cold Brew", meta_description="d", slug="cold-brew",
        focus_keyword="cold brew", secondary_keywords=["iced coffee"],
    )
    assert out and out.meta_title == "Cold Brew" and out.keywords == ["iced coffee"] and out.research["query"] == "cold brew"

    when = datetime.now(timezone.utc) + timedelta(days=2)
    s = await article_seo.schedule(a.id, user_id=uid, mode="live", publish_at=when, args_hash="h1")
    assert s and s.publish_status == "scheduled"
    assert await article_seo.scheduled_args_hash(a.id, user_id=uid) == "h1"

    items = await calendar.items_for_user(uid, start=when - timedelta(hours=1), end=when + timedelta(hours=1))
    assert [(i.kind, i.status, i.movable, i.platform) for i in items] == [("article", "scheduled", True, "wordpress")]

    later = when + timedelta(days=1)
    assert (await article_seo.reschedule(a.id, user_id=uid, publish_at=later)).publish_at == later
    assert await article_seo.due_scheduled(later - timedelta(minutes=1)) == []
    assert (a.id, uid) in await article_seo.due_scheduled(later + timedelta(minutes=1))

    # Two concurrent claims: exactly one wins.
    results = await asyncio.gather(
        article_seo.claim_publish(a.id, user_id=uid, mode="live", from_scheduled_only=True),
        article_seo.claim_publish(a.id, user_id=uid, mode="live", from_scheduled_only=True),
    )
    assert sum(r is not None for r in results) == 1
    assert await article_seo.reschedule(a.id, user_id=uid, publish_at=later) is None  # not scheduled any more

    await article_seo.finish_publish(a.id, user_id=uid, status="published", wp_post_id=12, wp_post_url="https://b.test/p", published=True)
    done = await articles_repo.get(a.id, user_id=uid)
    assert done.publish_status == "published" and done.wp_post_id == 12 and done.published_at is not None
    # The pipeline's save() never touches publishing state.
    await articles_repo.save(done)
    assert (await articles_repo.get(a.id, user_id=uid)).publish_status == "published"


async def test_publish_status_check_constraint(pool):
    import asyncpg

    uid, niche = await _setup(pool)
    from marketer.repos import articles as articles_repo

    a = await articles_repo.create(user_id=uid, niche_id=niche, topic="x")
    with pytest.raises(asyncpg.CheckViolationError):
        await pool.execute("update articles set publish_status = 'sent' where id = $1", a.id)


async def test_wordpress_connection_never_reads_back_the_secret_except_server_side(pool):
    from marketer.repos import wordpress as repo

    uid, _ = await _setup(pool)
    conn = await repo.upsert(
        user_id=uid, site_url="https://blog.example.com", username="ed", password_sealed="v1:abc",
        seo_plugin="rankmath", created_by="p",
    )
    assert "password" not in conn.model_dump_json().replace("has_password", "")
    assert (await repo.get(uid)).seo_plugin == "rankmath"
    found = await repo.connection_secret(uid)
    assert found and found[1] == "v1:abc"
    # One per workspace: a second connect replaces it.
    await repo.upsert(user_id=uid, site_url="https://new.example.com", username="ed2", password_sealed="v1:def", seo_plugin="yoast", created_by="p")
    assert (await repo.get(uid)).site_url == "https://new.example.com"
    import asyncpg

    with pytest.raises(asyncpg.CheckViolationError):
        await pool.execute(
            "update wordpress_connections set password_sealed = 'plain' where user_id = $1", uid,
        )
    assert await repo.delete(uid) and await repo.get(uid) is None


async def test_batches_queue(pool):
    from marketer.repos import article_batches as repo
    from marketer.repos import articles as articles_repo

    uid, niche = await _setup(pool)
    batch = await repo.create(user_id=uid, niche_id=niche, keywords=["a", "b", "c"], created_by="p")
    assert [i.keyword for i in batch.items] == ["a", "b", "c"] and [i.position for i in batch.items] == [1, 2, 3]
    first = (await repo.next_queued(batch.id, limit=1))[0]
    claims = await asyncio.gather(repo.claim_item(first.id), repo.claim_item(first.id))
    assert sorted(claims) == [False, True]
    art = await articles_repo.create(user_id=uid, niche_id=niche, topic="a", batch_id=batch.id)
    await repo.attach_article(first.id, art.id)
    await pool.execute("update articles set status = 'done' where id = $1", art.id)
    await repo.reconcile_running(batch.id)
    assert (await repo.counts(batch.id)) == {"done": 1, "queued": 2}
    await repo.hold_queued(batch.id, "spend_cap")
    got = await repo.get(batch.id, user_id=uid)
    assert [i.held_reason for i in got.items if i.status == "queued"] == ["spend_cap", "spend_cap"]
    assert await repo.cancel(batch.id, user_id=uid)
    assert (await repo.counts(batch.id)) == {"done": 1, "cancelled": 2}
    assert not await repo.cancel(batch.id, user_id=uid)
    assert [b.id for b in await repo.list_for_user(uid)] == [batch.id]
    assert await repo.get(batch.id, user_id="someone_else") is None
