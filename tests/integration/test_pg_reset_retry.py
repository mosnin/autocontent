"""Real-Postgres: reset_for_retry is an atomic failed->queued claim.

The cycle-3 resilience review found the pre-fix read-then-write let two
concurrent retries of the same failed job both spawn (double-spend). This
verifies exactly one concurrent caller now wins.
"""
from __future__ import annotations

import asyncio
import json
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


def _script():
    from marketer.models import Idea, Scene, Script

    return Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"),
        scenes=[Scene(index=0, narration="n", visual_prompt="v",
                      motion_prompt="m", duration_sec=5)],
        total_duration_sec=5, cta=None,
    )


async def _mkfailed_job(pool, uid, niche_id, *, error="boom", with_state=False):
    from marketer.models import AudioTrack, Clip, Job, JobStatus

    jid = uuid4()
    kw = {}
    if with_state:
        kw = dict(
            script=_script(),
            clips=[Clip(scene_index=0, keyframe_path="/k.png",
                        video_path="/c.mp4", duration_sec=5.0)],
            audio=AudioTrack(voiceover_path="/tmp/vo.wav"),
        )
    job = Job(id=jid, user_id=uid, niche_id=niche_id, platform="tiktok",
              status=JobStatus.failed, error=error, **kw)
    await pool.execute(
        """
        insert into jobs (id, user_id, niche_id, platform, status, error, payload)
        values ($1,$2,$3,'tiktok','failed',$4,$5::jsonb)
        """,
        jid, uid, niche_id, error, job.model_dump_json(),
    )
    return jid


async def test_concurrent_reset_for_retry_exactly_one_winner(pool):
    from marketer.repos import jobs as jobs_repo

    uid = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)
    jid = await _mkfailed_job(pool, uid, niche_id)

    # Fire many concurrent retries of the SAME failed job.
    results = await asyncio.gather(
        *[jobs_repo.reset_for_retry(jid, user_id=uid) for _ in range(8)]
    )
    winners = [r for r in results if r is not None]
    assert len(winners) == 1, f"expected exactly one winner, got {len(winners)}"
    assert winners[0].status.value == "queued"
    assert winners[0].error is None

    # The row is now queued; a further retry finds nothing to claim.
    assert await jobs_repo.reset_for_retry(jid, user_id=uid) is None


async def test_reset_for_retry_wipes_content_rejection(pool):
    from marketer.repos import jobs as jobs_repo

    uid = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)
    # A render/content-QA rejection must wipe script/clips/audio on retry —
    # the error is nulled in the same call, so resuming rejected artifacts
    # would re-judge the same script to death.
    jid = await _mkfailed_job(
        pool, uid, niche_id, error="render QA failed: too short",
        with_state=True,
    )
    job = await jobs_repo.reset_for_retry(jid, user_id=uid)
    assert job is not None and job.status.value == "queued"
    assert job.error is None
    assert job.script is None and job.clips == [] and job.audio is None
    # The wipe was persisted, not just returned.
    row = await pool.fetchrow("select payload from jobs where id=$1", jid)
    payload = json.loads(row["payload"])
    assert payload["status"] == "queued"
    assert payload["error"] is None
    assert payload["script"] is None and payload["clips"] == []


async def test_reset_for_retry_transient_keeps_state(pool):
    from marketer.repos import jobs as jobs_repo

    uid = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)
    # A non-QA (transient) failure keeps script/clips so the stage-resume
    # path can reuse them instead of re-buying everything.
    jid = await _mkfailed_job(
        pool, uid, niche_id, error="GrokImagineError: 500 mid-poll",
        with_state=True,
    )
    job = await jobs_repo.reset_for_retry(jid, user_id=uid)
    assert job is not None and job.status.value == "queued" and job.error is None
    assert job.script is not None
    assert len(job.clips) == 1 and job.audio is not None


async def test_reset_for_retry_foreign_user_denied(pool):
    from marketer.repos import jobs as jobs_repo

    uid = await _mkuser(pool)
    other = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)
    jid = await _mkfailed_job(pool, uid, niche_id)
    assert await jobs_repo.reset_for_retry(jid, user_id=other) is None
    # Still failed / claimable by the real owner.
    assert await jobs_repo.reset_for_retry(jid, user_id=uid) is not None


async def _mk_awaiting_job(pool, uid, niche_id):
    from marketer.models import Job, JobStatus

    jid = uuid4()
    job = Job(id=jid, user_id=uid, niche_id=niche_id, platform="tiktok",
              status=JobStatus.awaiting_approval)
    await pool.execute(
        """
        insert into jobs (id, user_id, niche_id, platform, status, payload)
        values ($1,$2,$3,'tiktok','awaiting_approval',$4::jsonb)
        """,
        jid, uid, niche_id, job.model_dump_json(),
    )
    return jid


async def test_reject_is_atomic_vs_concurrent(pool):
    """claim_for_rejection: concurrent rejects yield exactly one winner, and a
    reject can't fire once the job has left awaiting_approval (the approve race)."""
    from marketer.repos import jobs as jobs_repo

    uid = await _mkuser(pool)
    niche_id = await _mkniche(pool, uid)
    jid = await _mk_awaiting_job(pool, uid, niche_id)

    results = await asyncio.gather(
        *[jobs_repo.claim_for_rejection(jid, user_id=uid) for _ in range(8)]
    )
    winners = [r for r in results if r is not None]
    assert len(winners) == 1
    assert winners[0].status.value == "failed"

    # Simulate approve winning first on a fresh job: flip to scheduling, then
    # reject must find nothing to claim (can't clobber a posting job).
    jid2 = await _mk_awaiting_job(pool, uid, niche_id)
    await pool.execute("update jobs set status='scheduling' where id=$1", jid2)
    assert await jobs_repo.claim_for_rejection(jid2, user_id=uid) is None
