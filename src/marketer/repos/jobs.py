from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool
from ..models import Job, JobStatus


async def create(
    *, user_id: str, niche_id: UUID, platform: str, campaign_id: UUID | None = None
) -> Job:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into jobs (user_id, niche_id, platform, payload, campaign_id)
        values ($1, $2, $3, '{}'::jsonb, $4)
        returning id, created_at
        """,
        user_id, niche_id, platform, campaign_id,
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


# Failure prefixes that mean QA rejected the *content* — resuming the same
# script/clips would fail identically, so retries must regenerate. Lives
# here (not pipeline.py) because the wipe has to happen wherever the
# pre-reset error string is still visible.
CONTENT_REJECTION_PREFIXES = ("content QA failed", "render QA failed")


def wipe_pipeline_state(job: Job) -> None:
    job.script = None
    job.clips = []
    job.audio = None


async def reset_for_retry(job_id: UUID, *, user_id: str) -> Job | None:
    """Reset a failed job back to `queued` and clear `error`. Returns the
    fresh Job snapshot. Returns None if the job isn't owned by the user
    or isn't currently in a terminal state.

    Content/render QA rejections wipe the pipeline state HERE — the retry
    route nulls `error` before the pipeline's _obtain_job ever sees it, so
    deferring the check downstream would resume the rejected artifacts and
    re-judge the same script to death."""
    # Atomic failed->queued claim: the `and j.status = 'failed'` predicate is
    # re-evaluated under a row lock at UPDATE time, so of two concurrent
    # retries of the same job (double-click, or one from the Jobs page and
    # one from the Failures inbox) exactly one matches a row and the other
    # gets 0 rows -> None. Without this, both could pass a read-then-write
    # check, both bump updated_at, and the two spawned containers would
    # derive *different* idempotency keys — defeating the exactly-once guard
    # and double-spending. `prev` captures the pre-update payload so we can
    # still tell whether to wipe QA-rejected artifacts.
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        with prev as (
            select id, payload from jobs
             where id = $1 and user_id = $2 and status = 'failed'
        )
        update jobs j
           set status = 'queued'::job_status, updated_at = now()
          from prev
         where j.id = prev.id and j.status = 'failed'
        returning prev.payload as old_payload
        """,
        job_id, user_id,
    )
    if row is None:
        return None
    job = Job.model_validate(json.loads(row["old_payload"]))
    if job.error and job.error.startswith(CONTENT_REJECTION_PREFIXES):
        wipe_pipeline_state(job)
    job.status = JobStatus.queued
    job.error = None
    # Winner-only second write: reconciles the payload jsonb (and denormalized
    # columns) with the claimed status. The loser already returned None above,
    # so this never races a second reset.
    await save_snapshot(job)
    return job


async def claim_for_rejection(job_id: UUID, *, user_id: str) -> Job | None:
    """Atomically mark an `awaiting_approval` job `failed` (operator veto).

    Like reset_for_retry, the `and status = 'awaiting_approval'` predicate is
    re-checked under a row lock at UPDATE time. This closes a race with
    approve_job: without it, a plain read-then-write reject could read the
    pre-claim `awaiting_approval` row, lose the race to an approval that then
    posts the video, and blind-overwrite the resulting `done` row back to
    `failed` — leaving the DB claiming rejected while content already posted
    (and a later retry could double-post). The atomic claim means once
    approve_job wins (flipping to `scheduling`), reject matches 0 rows -> None.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        with prev as (
            select id, payload from jobs
             where id = $1 and user_id = $2 and status = 'awaiting_approval'
        )
        update jobs j
           set status = 'failed'::job_status,
               error = 'rejected by operator before posting',
               updated_at = now()
          from prev
         where j.id = prev.id and j.status = 'awaiting_approval'
        returning prev.payload as old_payload
        """,
        job_id, user_id,
    )
    if row is None:
        return None
    job = Job.model_validate(json.loads(row["old_payload"]))
    job.status = JobStatus.failed
    job.error = "rejected by operator before posting"
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


# ---------------------------------------------------------------------------
# Failures inbox — a consolidated, categorized view of terminal failures.
#
# No schema change: `error` is free text written by the pipeline (QA
# rejection prefixes, `SpendCapExceeded` messages, provider exceptions,
# the reap_stale timeout message, ...). `classify_failure` turns that raw
# string into a coarse, actionable category so a failures inbox can group
# and triage instead of dumping raw tracebacks. Kept as a pure function
# (str | None -> str) so it's trivially unit-testable and reusable by any
# other repo (image_posts, articles) that wants the same taxonomy.
# ---------------------------------------------------------------------------

FAILURE_CATEGORY_CONTENT_QA = "content_qa"
FAILURE_CATEGORY_RENDER_QA = "render_qa"
FAILURE_CATEGORY_SPEND_CAP = "spend_cap"
FAILURE_CATEGORY_TIMEOUT_STUCK = "timeout_stuck"
FAILURE_CATEGORY_PROVIDER_ERROR = "provider_error"
FAILURE_CATEGORY_OTHER = "other"

FAILURE_CATEGORIES = (
    FAILURE_CATEGORY_CONTENT_QA,
    FAILURE_CATEGORY_RENDER_QA,
    FAILURE_CATEGORY_SPEND_CAP,
    FAILURE_CATEGORY_TIMEOUT_STUCK,
    FAILURE_CATEGORY_PROVIDER_ERROR,
    FAILURE_CATEGORY_OTHER,
)

# Substrings pulled straight from the raising sites (spend_context.py,
# spend.py: "hit daily cap", "hit global daily cap", "pre-flight ... cap
# check", "exhausted prepaid credit", "spend aborted", "Top up to
# continue"; pipeline.py: "spend_cap_exceeded during fan-out").
_SPEND_CAP_MARKERS = (
    "spend_cap_exceeded",
    "spend aborted",
    "daily cap",
    "global cap",
    "cap check",
    "prepaid credit",
    "top up to continue",
)

# Provider/transport failures: named third-party services and the
# openai-sdk transient exception names retried by retry_policy.py before
# they ever reach `error` (so seeing them here means retries were
# exhausted), plus the fal/grok polling-timeout exceptions.
_PROVIDER_ERROR_MARKERS = (
    "fal request",
    "fal video",
    "grok",
    "elevenlabs",
    "openai",
    "pixabay",
    "ayrshare",
    "apiconnectionerror",
    "apitimeouterror",
    "ratelimiterror",
    "rate limit",
    "timed out after",
    "5xx",
)


def classify_failure(error: str | None) -> str:
    """Map a job's raw `error` text to a coarse failure category.

    Pure function over the string alone — order matters, most specific
    first, so e.g. `reap_stale`'s message (which mentions no provider)
    doesn't fall through to "other", and QA prefixes are checked before
    the generic provider/timeout buckets in case an error happens to
    mention a provider name in passing.
    """
    if not error:
        return FAILURE_CATEGORY_OTHER
    if error.startswith(CONTENT_REJECTION_PREFIXES):
        if error.startswith("content QA failed"):
            return FAILURE_CATEGORY_CONTENT_QA
        return FAILURE_CATEGORY_RENDER_QA
    lowered = error.lower()
    if any(marker in lowered for marker in _SPEND_CAP_MARKERS):
        return FAILURE_CATEGORY_SPEND_CAP
    if error == _REAP_ERROR or "reaped:" in lowered or "no progress" in lowered:
        return FAILURE_CATEGORY_TIMEOUT_STUCK
    if any(marker in lowered for marker in _PROVIDER_ERROR_MARKERS):
        return FAILURE_CATEGORY_PROVIDER_ERROR
    return FAILURE_CATEGORY_OTHER


async def failures_for_user(user_id: str, *, limit: int = 100) -> list[dict]:
    """Recent failed jobs for *user_id*, categorized for a failures inbox.

    Reads columns directly (not the jsonb `payload`) since `status`,
    `error`, `niche_id`, and `created_at` are all real columns kept in
    sync by `save_snapshot`/`reap_stale` — cheaper than parsing every
    payload just to list a triage view. Joins `niches` for a human title;
    `niches` has no soft-delete that would orphan the FK, and jobs are
    `on delete cascade` from niches, so the join is safe by construction.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select j.id, j.niche_id, j.platform, j.error, j.created_at,
               n.title as niche_title
          from jobs j
          join niches n on n.id = j.niche_id
         where j.user_id = $1
           and j.status = 'failed'
         order by j.created_at desc
         limit $2
        """,
        user_id,
        limit,
    )
    return [
        {
            "kind": "job",
            "id": r["id"],
            "niche_id": r["niche_id"],
            "niche_title": r["niche_title"],
            "platform": r["platform"],
            "error": r["error"],
            "category": classify_failure(r["error"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


async def recent_topics_for_niche(
    niche_id: UUID, *, user_id: str, limit: int = 20
) -> list[str]:
    """Topics (with hooks) of the niche's most recent scripted jobs.

    Fed to the ideation agent as a do-not-repeat list — the video
    pipeline's equivalent of the article pipeline's topic dedupe."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select payload->'script'->'idea'->>'topic' as topic,
               payload->'script'->'idea'->>'hook'  as hook
          from jobs
         where niche_id = $1
           and user_id = $2
           and payload->'script'->'idea'->>'topic' is not null
         order by created_at desc
         limit $3
        """,
        niche_id, user_id, limit,
    )
    return [
        f"{r['topic']}" + (f" (hook: {r['hook']})" if r["hook"] else "")
        for r in rows
    ]
