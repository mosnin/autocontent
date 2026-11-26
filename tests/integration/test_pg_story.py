"""Real-Postgres tests for story videos (0036_story_videos.sql + PostgresStoryStore):
targeted updates, the atomic status claim, checkpoints, and charges that are
unique per idempotency key and add to the story's total in one transaction."""
from __future__ import annotations

import asyncio
import os
from decimal import Decimal
from uuid import uuid4

import pytest

from marketer.story.models import Charge, Scene, StoryPlan, StoryStatus, StoryVideo
from marketer.story.store import PostgresStoryStore

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
    await p.execute("delete from users where id like 'user_story_%'")


async def _story(pool) -> StoryVideo:
    uid = f"user_story_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return await PostgresStoryStore().create(StoryVideo(id=uuid4(), user_id=uid, mode="idea", source="an idea",
                                                        status=StoryStatus.writing, stage="script"))


async def test_create_update_and_scope(pool):
    store = PostgresStoryStore()
    s = await _story(pool)
    assert (await store.get(s.id, user_id="someone_else")) is None
    plan = StoryPlan(scenes=[Scene(heading="INT", script="hello")])
    u = await store.update(s.id, user_id=s.user_id, plan=plan, status=StoryStatus.script_ready, revision=2)
    assert u.status == StoryStatus.script_ready and u.revision == 2 and u.plan.scenes[0].script == "hello"
    assert [x.id for x in await store.list(s.user_id)] == [s.id]
    with pytest.raises(ValueError):
        await store.update(s.id, user_id=s.user_id, spent_micros=0)


async def test_claim_status_has_one_winner(pool):
    store = PostgresStoryStore()
    s = await _story(pool)
    await store.update(s.id, user_id=s.user_id, status=StoryStatus.storyboard_ready)
    results = await asyncio.gather(*(store.claim_status(s.id, user_id=s.user_id, allowed={"storyboard_ready"},
                                                        to="rendering", stage="render") for _ in range(5)))
    assert sum(r is not None for r in results) == 1


async def test_checkpoints_upsert(pool):
    store = PostgresStoryStore()
    s = await _story(pool)
    await store.put_checkpoint(s.id, "frame:r0:0.0", {"path": "/a.png"})
    await store.put_checkpoint(s.id, "frame:r0:0.0", {"path": "/b.png"})
    assert await store.checkpoints(s.id) == {"frame:r0:0.0": {"path": "/b.png"}}


async def test_charges_are_idempotent_and_totalled(pool):
    store = PostgresStoryStore()
    s = await _story(pool)
    c = Charge(story_id=s.id, user_id=s.user_id, idempotency_key=f"story:{s.id}:clip:r0:1.0#0", stage="clip",
               provider="xai", sku="grok-imagine-video", units=Decimal(5), cost_micros=250_000)
    results = await asyncio.gather(*(store.record_charge(c) for _ in range(4)))
    assert results.count(True) == 1
    assert (await store.get(s.id, user_id=s.user_id)).spent_micros == 250_000
    assert len(await store.charges(s.id)) == 1
