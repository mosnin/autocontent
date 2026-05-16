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
    limit: int = 50,
) -> list[Job]:
    pool = await get_pool()
    if status is None:
        rows = await pool.fetch(
            "select payload from jobs where user_id = $1 order by created_at desc limit $2",
            user_id, limit,
        )
    else:
        rows = await pool.fetch(
            """select payload from jobs
                where user_id = $1 and status = $2
                order by created_at desc limit $3""",
            user_id, status.value, limit,
        )
    return [Job.model_validate(json.loads(r["payload"])) for r in rows]


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
