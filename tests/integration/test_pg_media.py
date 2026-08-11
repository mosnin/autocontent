"""Real-Postgres integration tests for the media library data layer:
asset indexing idempotency, tenant scoping, filters, and the composition
lifecycle (atomic claim). Skip without MARKETER_DATABASE_URL."""
from __future__ import annotations

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
        await conn.execute("delete from compositions")
        await conn.execute("delete from media_assets")
        await conn.execute("delete from users")


async def _mkuser(pool) -> str:
    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )
    return uid


async def test_record_asset_idempotent_on_key(pool):
    from marketer.repos import media

    uid = await _mkuser(pool)
    a1 = await media.record_asset(
        user_id=uid, kind="clip", storage="wasabi",
        object_key="users/u/j/clips/scene_0.mp4", size_bytes=10,
    )
    a2 = await media.record_asset(
        user_id=uid, kind="clip", storage="wasabi",
        object_key="users/u/j/clips/scene_0.mp4", size_bytes=999, title="updated",
    )
    assert a1.id == a2.id  # upsert, not duplicate
    assert a2.size_bytes == 999
    assert a2.title == "updated"
    assert len(await media.list_assets(user_id=uid)) == 1


async def test_list_assets_filters_and_scoping(pool):
    from marketer.repos import media

    uid, other = await _mkuser(pool), await _mkuser(pool)
    for i in range(3):
        await media.record_asset(
            user_id=uid, kind="clip", storage="volume",
            object_key=f"/artifacts/{uid}/j/clips/{i}.mp4", scene_index=i,
        )
    await media.record_asset(
        user_id=uid, kind="final", storage="volume",
        object_key=f"/artifacts/{uid}/j/output/final.mp4",
    )
    await media.record_asset(
        user_id=other, kind="clip", storage="volume",
        object_key=f"/artifacts/{other}/j/clips/0.mp4",
    )

    clips = await media.list_assets(user_id=uid, kind="clip")
    finals = await media.list_assets(user_id=uid, kind="final")
    assert len(clips) == 3 and len(finals) == 1
    # tenant isolation: the other user's clip never leaks
    assert all(a.user_id == uid for a in clips)

    # cross-tenant get returns None
    theirs = (await media.list_assets(user_id=other))[0]
    assert await media.get_asset(theirs.id, user_id=uid) is None


async def test_composition_lifecycle_and_atomic_claim(pool):
    from marketer.repos import media

    uid = await _mkuser(pool)
    c1 = await media.record_asset(
        user_id=uid, kind="clip", storage="volume", object_key="/a/1.mp4",
    )
    c2 = await media.record_asset(
        user_id=uid, kind="clip", storage="volume", object_key="/a/2.mp4",
    )

    comp = await media.create_composition(
        user_id=uid, clip_asset_ids=[c1.id, c2.id], title="remix",
    )
    assert comp.status == "queued"
    assert comp.clip_asset_ids == [c1.id, c2.id]  # order preserved

    # exactly one claim wins
    assert await media.claim_composition_for_render(comp.id, user_id=uid)
    assert not await media.claim_composition_for_render(comp.id, user_id=uid)

    out = await media.record_asset(
        user_id=uid, kind="composition", storage="volume", object_key="/a/out.mp4",
    )
    done = await media.set_composition_status(
        comp.id, user_id=uid, status="done", output_asset_id=out.id,
    )
    assert done.status == "done"
    assert done.output_asset_id == out.id

    listed = await media.list_compositions(user_id=uid)
    assert [c.id for c in listed] == [comp.id]


async def test_performers_ranked_by_completion_rate_with_views_fallback(pool):
    """Views-order and completion-order disagree on purpose: completion
    rate must win, NULL completion sinks (top) / floats (bottom)."""
    import json
    from datetime import datetime, timezone
    from uuid import uuid4

    from marketer.repos import post_metrics as pm_repo

    uid = await _mkuser(pool)
    niche = await pool.fetchrow(
        """
        insert into niches (user_id, title, description, target_audience,
            visual_style, voice, target_duration_sec, scene_count,
            posting_windows, platforms, daily_spend_cap_usd)
        values ($1,'t','d','a','v','onyx',30,2,'[]'::jsonb,
                '{tiktok}', 5.0)
        returning id
        """,
        uid,
    )
    niche_id = niche["id"]

    async def _mkjob_with_metrics(views: int, completion) -> None:
        job_id = uuid4()
        await pool.execute(
            """
            insert into jobs (id, user_id, niche_id, platform, status, payload)
            values ($1, $2, $3, 'tiktok', 'done', $4::jsonb)
            """,
            job_id, uid, niche_id, json.dumps({"id": str(job_id)}),
        )
        await pool.execute(
            """
            insert into post_metrics (user_id, job_id, provider_post_id,
                platform, sampled_at, views, completion_rate, raw)
            values ($1, $2, $3, 'tiktok', $4, $5, $6, '{}'::jsonb)
            """,
            uid, job_id, f"post-{job_id}", datetime.now(timezone.utc),
            views, completion,
        )

    await _mkjob_with_metrics(100, 0.9)    # A: few views, great completion
    await _mkjob_with_metrics(1000, 0.2)   # B: most views, poor completion
    await _mkjob_with_metrics(500, None)   # C: unsampled completion

    top = await pm_repo.top_performers_for_niche(niche_id, user_id=uid, limit=3)
    assert [t[1] for t in top] == [100, 1000, 500]  # A, B, C — completion wins

    bottom = await pm_repo.bottom_performers_for_niche(niche_id, user_id=uid, limit=3)
    assert [b[1] for b in bottom] == [1000, 100, 500]  # worst completion first, NULL last

    await pool.execute("delete from post_metrics where user_id = $1", uid)
    await pool.execute("delete from jobs where user_id = $1", uid)
    await pool.execute("delete from niches where user_id = $1", uid)
