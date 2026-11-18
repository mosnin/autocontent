from __future__ import annotations

import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from marketer import rails
from marketer.models import Job, JobStatus, PostMetrics
from marketer.rails.http import rails_request_context, to_http
from marketer.repos import jobs as jobs_repo
from marketer.repos import post_metrics as post_metrics_repo

from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

router = APIRouter(dependencies=[Depends(rails_request_context)])


class JobEnqueue(BaseModel):
    niche_id: UUID
    platform: Literal["tiktok", "reels", "shorts"]


@router.get("", response_model=list[Job])
async def list_jobs(
    ctx: AuthCtx = CurrentUser,
    status_filter: JobStatus | None = None,
    niche_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[Job]:
    return await jobs_repo.list_for_user(
        ctx.user_id, status=status_filter, niche_id=niche_id, limit=limit
    )


@router.get("/{job_id}", response_model=Job)
async def get_job(job_id: UUID, ctx: AuthCtx = CurrentUser) -> Job:
    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return job


# Each call spawns a paid pipeline run. The spend caps bound the money; this
# bounds how fast one account can queue work (and fill the jobs table).
_SPAWN_LIMIT = user_rate_limit("jobs.spawn", "30/minute")


@router.post("", response_model=Job, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def enqueue_job(body: JobEnqueue, ctx: AuthCtx = CurrentUser) -> Job:
    """Spawn a pipeline run on Modal. Returns the queued Job row;
    poll GET /{job_id} for status."""
    import modal

    from marketer.repos import niches as niches_repo

    # Ownership/existence check up front: without it a foreign or
    # nonexistent niche_id inserts a spurious row (or 500s on the FK)
    # and only fails later, inside the Modal container.
    niche = await niches_repo.get(body.niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")
    if body.platform not in niche.platforms:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"platform {body.platform} not enabled for this niche",
        )

    job = await jobs_repo.create(
        user_id=ctx.user_id, niche_id=body.niche_id, platform=body.platform
    )
    fn = modal.Function.from_name("marketer-sh", "run_pipeline")
    # Pass the job id so the pipeline reuses THIS row — otherwise the id
    # we just returned to the client never leaves `queued`.
    fn.spawn(ctx.user_id, str(body.niche_id), body.platform, str(job.id))
    return job


@router.get("/{job_id}/video")
async def get_job_video(job_id: UUID, ctx: AuthCtx = CurrentUser) -> FileResponse:
    """Stream the rendered mp4 for a finished job.

    Ownership is checked (the job must belong to ``ctx.user_id``). Any
    of "job missing", "no rendered video on the job", or "file missing
    on disk" produce a 404 — the web client doesn't differentiate.
    """
    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    rendered = job.rendered
    if rendered is None or not rendered.path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no rendered video")
    if not os.path.exists(rendered.path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file missing")
    return FileResponse(rendered.path, media_type="video/mp4")


class JobMetricsResponse(BaseModel):
    latest: PostMetrics | None
    history: list[PostMetrics]


@router.get("/{job_id}/metrics", response_model=JobMetricsResponse)
async def get_job_metrics(job_id: UUID, ctx: AuthCtx = CurrentUser) -> JobMetricsResponse:
    """Return the latest analytics sample and full time-series history for a job.

    Auth-scoped: the job must belong to the requesting user. Returns 404 if the
    job does not exist or is owned by another user.  Returns ``{"latest": null,
    "history": []}`` for jobs that have never been sampled yet.
    """
    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    latest = await post_metrics_repo.latest_for_job(job_id, user_id=ctx.user_id)
    history = await post_metrics_repo.list_for_job(job_id, user_id=ctx.user_id)
    return JobMetricsResponse(latest=latest, history=history)


@router.post("/{job_id}/approve", response_model=Job, status_code=status.HTTP_202_ACCEPTED)
async def approve_job(job_id: UUID, ctx: AuthCtx = CurrentUser) -> Job:
    """Operator sign-off on an `awaiting_approval` job. Spawns the Modal
    `finish_scheduling` function, which uploads + schedules the already
    rendered video and marks the job done."""
    import modal

    # Enforcement point (docs/rails/enforcement-point.md): kill switch, unknown
    # outcomes on this video, the agent's idempotency key — read now.
    try:
        dispatch = await rails.enforce_dispatch(
            "content.video.approve", user_id=ctx.user_id,
            principal=rails.principal_of(ctx), actor_email=ctx.email,
            args={"job_id": job_id}, target_type="job", target_id=str(job_id),
        )
    except rails.RailsDenied as e:
        raise to_http(e) from e

    # Atomic claim: exactly one approve call transitions the row out of
    # awaiting_approval, so a double-click can't spawn two schedulers
    # (and two social posts).
    job = await jobs_repo.claim_for_scheduling(job_id, user_id=ctx.user_id)
    if job is None:
        existing = await jobs_repo.get(job_id, user_id=ctx.user_id)
        if existing is None:
            await dispatch.failed("job not found")
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
        await dispatch.failed(f"job is {existing.status.value}")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"job is {existing.status.value}, not awaiting_approval",
        )
    fn = modal.Function.from_name("marketer-sh", "finish_scheduling")

    async def _spawn() -> None:
        fn.spawn(ctx.user_id, str(job_id))

    try:
        # A spawn that times out may still have started the scheduler: that is
        # indeterminate, recorded, surfaced in the inbox, never retried here.
        await dispatch.run(_spawn)
    except rails.OutcomeUnknown as e:
        raise to_http(e) from e
    return job


@router.post("/{job_id}/reject", response_model=Job)
async def reject_job(job_id: UUID, ctx: AuthCtx = CurrentUser) -> Job:
    """Operator veto on an `awaiting_approval` job. The rendered video
    stays on the volume (retention GC handles cleanup); the job is marked
    failed so it never posts."""
    try:
        dispatch = await rails.enforce_dispatch(
            "content.video.reject", user_id=ctx.user_id,
            principal=rails.principal_of(ctx), actor_email=ctx.email,
            args={"job_id": job_id}, target_type="job", target_id=str(job_id),
        )
    except rails.RailsDenied as e:
        raise to_http(e) from e
    job = await jobs_repo.claim_for_rejection(job_id, user_id=ctx.user_id)
    if job is None:
        await dispatch.failed("job not awaiting_approval")
        # Not owned/absent, or no longer awaiting_approval (e.g. a concurrent
        # approve already claimed it) — atomic, so reject can't clobber a job
        # that has already advanced toward posting.
        existing = await jobs_repo.get(job_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"job is {existing.status.value}, not awaiting_approval",
        )
    await dispatch.succeeded()
    return job


@router.post("/{job_id}/retry", response_model=Job, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def retry_job(job_id: UUID, ctx: AuthCtx = CurrentUser) -> Job:
    """Re-run a previously failed job from scratch. Only works on jobs in
    `failed` state owned by the caller."""
    import modal

    # A retry re-renders and posts again. If an earlier post of this video has
    # an unknown outcome nobody resolved, retrying could post it twice.
    try:
        await rails.assert_no_unresolved(ctx.user_id, "video_post", str(job_id))
    except rails.RailsDenied as e:
        raise to_http(e) from e
    job = await jobs_repo.reset_for_retry(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="job not found, not owned, or not in failed state",
        )
    fn = modal.Function.from_name("marketer-sh", "run_pipeline")
    # Reuse the job's own row: the retried id is the id that progresses.
    fn.spawn(ctx.user_id, str(job.niche_id), job.platform, str(job.id))
    return job
