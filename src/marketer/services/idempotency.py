"""Exactly-once guard for Modal entrypoints.

Call ``claim_spawn(key)`` at the very top of a Modal function body, before
any side effect (spawning children, charging spend, posting to a social
platform). If it returns ``False`` the same unit of work is already
claimed (in flight or recently completed) — log and return early instead
of re-executing.

Key scheme
----------
A key must be stable for "the same unit of work" and distinct for "a new,
legitimate unit of work" — get this wrong in either direction and you
either wedge legitimate retries (key too broad) or let real duplicates
through (key too narrow). Per entrypoint:

``pipeline:{job_id}:{attempt_at}``
    ``run_pipeline``. A job_id is reused across retries (the same row
    goes queued -> failed -> queued again), so job_id alone would wedge
    every legitimate retry after the first attempt. ``attempt_at`` is the
    job row's own ``updated_at`` fetched fresh when the container starts:
    every transition that makes a job spawnable (create, reset_for_retry,
    claim_for_scheduling) rewrites ``updated_at``, so a *new* attempt gets
    a *new* key automatically, while two concurrent spawns racing the same
    attempt (e.g. `retry_job`'s non-atomic read-then-write racing a
    double-click) both read the row after the same commit and land on the
    same key. This only works because callers already await the DB write
    before calling `.spawn()` — true for every caller in this codebase.

``niche_window:{niche_id}:{bucket}``
    ``run_niche_window``, keyed by the 30-minute bucket `nightly_batch`
    computed when it decided the window was due. Closes the gap where an
    overlapping/delayed cron tick recomputes "due" before the first tick's
    spawned job has updated the niche's status, and would otherwise spawn
    a second window-run for the same slot. (In practice `niche_lock`
    inside `run_job` already serializes concurrent same-niche renders —
    see below — so this is defense in depth, not the only guard.)

``campaign_tick:{bucket}``
    ``campaign_tick``, keyed by the top of the hour. `tick_all()` has no
    per-campaign locking of its own; if the hourly cron ever fires twice
    for the same slot (retried invocation, overlapping schedule), a whole
    second pass over every running campaign would re-evaluate cadence
    against stale counts and could double-spawn a lane's video/image/
    article before the first pass's inserts are visible. One key for the
    whole tick is enough: the entrypoint's job *is* "the hourly pass",
    there's no finer-grained identity to key on without editing
    campaign_runner.py (owned by another team this cycle).

Entrypoints intentionally NOT guarded here (audited, already safe):

- ``run_image_post`` / ``finish_image_post``: the routes atomically claim
  the row (``claim_for_retry`` / ``claim_for_scheduling`` — WHERE status
  filter, exactly one caller wins) *before* spawning. A crash between the
  claim commit and the `.spawn()` call leaves the row parked in a non-
  terminal status with nothing running — that's an orphaned claim, not a
  double execution, and `image_posts_repo.reap_stale` already fails it
  back after 120 min so a human can retry. Adding a spawn-level guard here
  would only add a second, redundant lock with no coverage the first
  doesn't already give.
- ``finish_scheduling``: symmetric to the above — `jobs_repo.claim_for_
  scheduling` is the same atomic WHERE-status claim, and `jobs_repo.
  reap_stale` covers the crash-before-spawn gap for the `scheduling`
  status.
- ``render_composition``, ``run_template_remix``, ``run_article_pipeline``
  (direct enqueue): each spawn follows a fresh row insert
  (`compositions`/`articles`), not a status transition on an existing row
  — a duplicate click creates a second row, which is a second *legitimate*
  unit of work by this app's model (same as clicking "new job" twice),
  not a double-execution of the same one. Nothing to dedup.
- ``prewarm_voice_previews``, ``gc_artifacts``, ``reap_stale_jobs``,
  ``daily_analytics_sync``, ``apply_migrations``: idempotent by
  construction (file-exists checks, WHERE-scoped UPDATE/DELETE, upserts) —
  running twice concurrently changes nothing beyond wasted work.

Fail-open
---------
If the idempotency store itself is unreachable, ``claim_spawn`` logs at
ERROR and returns True (proceed) rather than wedging the caller. A dead
dedup store must never become a global outage for the pipeline — money
safety already has the spend-cap re-check as the backstop against a
duplicate that slips through during an outage, and cron ticks are cheap
to skip on their own schedule but expensive to block on forever.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from ..repos import idempotency as idempotency_repo

log = logging.getLogger(__name__)


def floor_bucket(dt: datetime, *, minutes: int) -> str:
    """Floor *dt* (any tz) to a *minutes*-wide UTC bucket, returned as a
    stable string suitable for embedding in an idempotency key."""
    dt = dt.astimezone(timezone.utc)
    floored_minute = (dt.minute // minutes) * minutes
    bucket = dt.replace(minute=floored_minute, second=0, microsecond=0)
    return bucket.strftime("%Y%m%dT%H%M")


def pipeline_key(job_id: UUID | str, attempt_at: datetime) -> str:
    """Key for one attempt of `run_pipeline` on a given job row.
    ``attempt_at`` should be the job row's own ``updated_at`` as read
    fresh inside the container, not a value the spawning caller computed
    — see the module docstring for why that's what makes concurrent
    duplicate spawns of the *same* attempt collide on the same key."""
    ts = attempt_at.astimezone(timezone.utc).isoformat(timespec="microseconds")
    return f"pipeline:{job_id}:{ts}"


def niche_window_key(niche_id: UUID | str, bucket: str) -> str:
    return f"niche_window:{niche_id}:{bucket}"


def campaign_tick_key(bucket: str) -> str:
    return f"campaign_tick:{bucket}"


async def claim_spawn(key: str, *, ttl_seconds: int | None = None) -> bool:
    """Claim *key*. Returns True if the caller should proceed (first
    claimant, or the store is unreachable — fail open), False if this
    exact unit of work is already claimed and the caller should skip.
    """
    kwargs = {} if ttl_seconds is None else {"ttl_seconds": ttl_seconds}
    try:
        claimed = await idempotency_repo.claim(key, **kwargs)
    except Exception:
        log.error(
            "idempotency store unreachable claiming key=%r — proceeding "
            "(fail open); a duplicate spawn is possible until the store "
            "recovers. Spend-cap re-checks are the backstop.",
            key,
            exc_info=True,
        )
        return True
    if not claimed:
        log.warning(
            "idempotency guard: key=%r already claimed — skipping duplicate spawn",
            key,
        )
    return claimed


async def mark_done(key: str, *, result: dict | None = None) -> None:
    try:
        await idempotency_repo.mark_done(key, result=result)
    except Exception:
        log.warning("idempotency store unreachable marking key=%r done", key, exc_info=True)
