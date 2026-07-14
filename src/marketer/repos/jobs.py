from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool
from ..models import Job, JobStatus


async def create(*, user_id: str, niche_id: UUID, platform: str) -> Job:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into jobs (user_id, niche_id, platform, payload)
        values ($1, $2, $3, '{}'::jsonb)
        returning id, created_at
        """,
        user_id, niche_id, platform,
    )
    job = Job(
        id=row["id"],
        user_id=user_id,
        niche_id=niche_id,
        platform=platform,  # type: ignore[arg-type]
        status=JobStatus.queued,
        created_at=row["created_at"],
    )
    await save_snapshot(job)
    return job


async def reset_for_retry(job_id: UUID, *, user_id: str) -> Job | None:
    """Reset a failed job back to `queued` and clear `error`. Returns the
    fresh Job snapshot. Returns None if the job isn't owned by the user
    or isn't currently in a terminal state."""
    job = await get(job_id, user_id=user_id)
    if job is None or job.status != JobStatus.failed:
        return None
    job.status = JobStatus.queued
    job.error = None
    await save_snapshot(job)
    return job


_REAPABLE_STATUSES = (
    "queued", "ideating", "scripting", "generating_images", "animating",
    "voicing", "editing", "captioning", "qa", "scheduling",
)

_REAP_ERROR = "reaped: no progress (container died or timed out mid-run)"


async def reap_stale(*, older_than_minutes: int = 120) -> int:
    """Fail every job stuck in a non-terminal status with no progress for
    *older_than_minutes*. A crashed/timed-out Modal container otherwise
    strands its job in `generating_images`/`scheduling`/… forever —
    unretryable (retry requires `failed`) and invisible to alerts.

    `awaiting_approval` is deliberately not reaped: parking there is the
    approval feature, not staleness. Both the columns and the payload
    snapshot are updated so payload-reading list endpoints agree.
    """
    pool = await get_pool()
    result = await pool.execute(
        """
        update jobs
           set status = 'failed',
               error = $2,
               payload = jsonb_set(
                   jsonb_set(payload, '{status}', '"failed"'),
                   '{error}', to_jsonb($2::text))
         where status = any($1::job_status[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        list(_REAPABLE_STATUSES),
        _REAP_ERROR,
        older_than_minutes,
    )
    # asyncpg returns e.g. "UPDATE 3"
    return int(result.split()[-1])


async def has_active_for_niche(niche_id: UUID, *, within_minutes: int = 45) -> bool:
    """True if the niche already has a live (non-terminal) job created
    recently — used by the batch scheduler as an idempotency guard so an
    overlapping/delayed cron tick doesn't double-enqueue the same window."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select 1 from jobs
         where niche_id = $1
           and status = any($2::job_status[])
           and created_at > now() - make_interval(mins => $3)
         limit 1
        """,
        niche_id,
        list(_REAPABLE_STATUSES),
        within_minutes,
    )
    return row is not None


async def claim_for_scheduling(job_id: UUID, *, user_id: str) -> Job | None:
    """Atomically move an `awaiting_approval` job to `scheduling`.

    The approve endpoint is check-then-spawn; two rapid clicks both read
    `awaiting_approval` and spawn two schedulers → two social posts. This
    single UPDATE ... WHERE status filter makes exactly one caller win.
    Returns the claimed Job, or None if the job wasn't claimable.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update jobs
           set status = 'scheduling',
               payload = jsonb_set(payload, '{status}', '"scheduling"')
         where id = $1 and user_id = $2 and status = 'awaiting_approval'
        returning payload
        """,
        job_id, user_id,
    )
    return Job.model_validate(json.loads(row["payload"])) if row else None


async def save_snapshot(job: Job) -> None:
    """Persist the in-memory Job to the row. Called after each pipeline stage."""
    pool = await get_pool()
    await pool.execute(
        """
        update jobs
           set status = $2,
               scheduled_for = $3,
               error = $4,
               payload = $5::jsonb
         where id = $1
        """,
        job.id,
        job.status.value,
        job.scheduled_for,
        job.error,
        job.model_dump_json(),
    )


async def list_for_user(
    user_id: str,
    *,
    status: JobStatus | None = None,
    niche_id: UUID | None = None,
    limit: int = 50,
) -> list[Job]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select payload from jobs
         where user_id = $1
           and ($2::job_status is null or status = $2)
           and ($3::uuid is null or niche_id = $3)
         order by created_at desc
         limit $4
        """,
        user_id,
        status.value if status is not None else None,
        niche_id,
        limit,
    )
    jobs: list[Job] = []
    for r in rows:
        # One corrupt snapshot must not 500 the whole listing for the user.
        try:
            jobs.append(Job.model_validate(json.loads(r["payload"])))
        except Exception:
            import logging

            logging.getLogger(__name__).exception("unparseable job payload; skipping row")
    return jobs


async def get(job_id: UUID, *, user_id: str) -> Job | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select payload from jobs where id = $1 and user_id = $2",
        job_id, user_id,
    )
    return Job.model_validate(json.loads(row["payload"])) if row else None


async def get_by_provider_post_id(provider_post_id: str) -> Job | None:
    """Look up a Job by its Ayrshare post id.

    No user_id scope — webhooks arrive without a user token; the
    provider_post_id is the sole identifier. Returns None if the job has
    been deleted or never existed (caller should log + 200, not 404).
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select payload from jobs
         where payload->>'provider_post_id' = $1
         limit 1
        """,
        provider_post_id,
    )
    return Job.model_validate(json.loads(row["payload"])) if row else None
