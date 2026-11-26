"""Real-Postgres coverage for short video (0038): batch and items, guarded
transitions, the micro-dollar charge ledger's idempotency, retries with a new
attempt, uploads and the stock search cache.

Requires MARKETER_DATABASE_URL with every migration applied."""
from __future__ import annotations

import os
from uuid import uuid4

import asyncpg
import pytest

from marketer.repos import short_videos as repo
from marketer.short_video.models import ShortVideoSettings

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    db._auth_pool = None
    p = await db.get_pool()
    yield p


@pytest.fixture
async def tenant(pool):
    tid = f"t_sv_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", tid, f"{tid}@example.test")
    yield tid
    await pool.execute("delete from users where id = $1", tid)


async def _batch(tenant, variants=2, status="queued"):
    return await repo.create_batch(
        user_id=tenant, niche_id=None, created_by="p1", principal="user", title="coffee", source="topic",
        topic="coffee myths", script="", settings=ShortVideoSettings().model_dump(mode="json"), variants=variants,
        status=status, estimate_micros=26_000, cap_micros=39_000, args_hash="h" * 64,
    )


async def test_batch_items_and_guarded_transitions(tenant):
    b = await _batch(tenant, variants=3)
    assert [i.variant for i in b.items] == [1, 2, 3]
    got = await repo.get_batch(b.id, user_id=tenant)
    assert got.settings.look.aspect == "9:16" and got.status == "queued"
    assert await repo.get_batch(b.id, user_id="someone_else") is None
    assert await repo.transition_batch(b.id, user_id=tenant, from_status=("queued",), to_status="running")
    assert not await repo.transition_batch(b.id, user_id=tenant, from_status=("queued",), to_status="running")
    await repo.update_item(b.items[0].id, user_id=tenant, status="done", stage="done", progress=100,
                           stages={"script": {"state": "done"}}, clips=[{"provider": "pexels", "provider_id": "1"}],
                           search_terms=["coffee"])
    await repo.update_item(b.items[1].id, user_id=tenant, status="failed", error="cap")
    await repo.update_item(b.items[2].id, user_id=tenant, status="failed", error="cap")
    assert await repo.finish_batch(b.id, user_id=tenant) == "partial"
    item = await repo.get_item(b.items[0].id, user_id=tenant)
    assert item.stages["script"].state == "done" and item.clips[0].provider_id == "1"
    with pytest.raises(ValueError):
        await repo.update_item(b.items[0].id, user_id=tenant, user_id_override="x")


async def test_charge_ledger_is_idempotent_and_in_micros(tenant, pool):
    b = await _batch(tenant)
    store = repo.PgChargeStore()
    key = f"sv:{b.items[0].id}:1:voice"
    kw = dict(user_id=tenant, batch_id=b.id, item_id=b.items[0].id, stage="voice", provider="openai", sku="tts")
    assert await store.claim(key, **kw) == "new"
    assert await store.claim(key, **kw) == "pending"  # a crash mid-call: unknown, never re-run
    await store.finish(key, status="done", cost_micros=21_300)
    assert await store.claim(key, **kw) == "done"
    k2 = f"sv:{b.items[1].id}:1:voice"
    await store.claim(k2, **{**kw, "item_id": b.items[1].id})
    await store.finish(k2, status="failed", cost_micros=0)
    assert await store.claim(k2, **{**kw, "item_id": b.items[1].id}) == "new"  # nothing was delivered
    assert await store.batch_spent_micros(b.id) == 21_300
    got = await repo.get_batch(b.id, user_id=tenant)
    assert got.spent_micros == 21_300 and got.items[0].spent_micros == 21_300
    with pytest.raises(asyncpg.CheckViolationError):
        await pool.execute("update short_video_charges set cost_micros = -1 where idempotency_key = $1", key)


async def test_retry_bumps_attempt_and_requeues(tenant):
    b = await _batch(tenant, variants=1)
    await repo.transition_batch(b.id, user_id=tenant, from_status=("queued",), to_status="running")
    await repo.update_item(b.items[0].id, user_id=tenant, status="failed", error="boom")
    await repo.finish_batch(b.id, user_id=tenant)
    item = await repo.reset_item_for_retry(b.items[0].id, user_id=tenant)
    assert item.attempt == 2 and item.status == "queued" and item.error is None
    assert (await repo.get_batch(b.id, user_id=tenant)).status == "queued"
    assert await repo.reset_item_for_retry(b.items[0].id, user_id=tenant) is None  # not failed any more


async def test_cancel_and_uploads_and_cache(tenant):
    b = await _batch(tenant, variants=2, status="awaiting_approval")
    assert await repo.transition_batch(b.id, user_id=tenant, from_status=("awaiting_approval",), to_status="cancelled")
    await repo.cancel_items(b.id, user_id=tenant)
    assert await repo.item_is_cancelled(b.items[0].id)

    uid = uuid4()
    up = await repo.create_upload(upload_id=uid, user_id=tenant, kind="video", filename="a.mp4",
                                  content_type="video/mp4", size_bytes=100, object_key=f"users/{tenant}/a.mp4")
    assert up.status == "pending"
    assert await repo.list_uploads(user_id=tenant) == []
    ready = await repo.settle_upload(uid, user_id=tenant, status="ready", width=720, height=1280, duration_sec=4.0)
    assert ready.status == "ready" and ready.width == 720
    assert await repo.settle_upload(uid, user_id=tenant, status="rejected") is None  # settled once
    assert [u.id for u in await repo.list_uploads(user_id=tenant)] == [uid]

    cache = repo.PgSearchCache()
    q = f"coffee-{uuid4().hex[:6]}"
    assert await cache.get("pexels", q, "portrait") is None
    await cache.put("pexels", q, "portrait", [{"provider": "pexels", "provider_id": "1"}])
    assert (await cache.get("pexels", q, "portrait"))[0]["provider_id"] == "1"
