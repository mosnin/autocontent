from __future__ import annotations

import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from marketer.models import Job, JobStatus, PostMetrics
from marketer.repos import jobs as jobs_repo
from marketer.repos import post_metrics as post_metrics_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class JobEnqueue(BaseModel):
    niche_id: UUID
    platform: Literal["tiktok", "reels", "shorts"]


@router.get("", response_model=list[Job])
async def list_jobs(
    ctx: AuthCtx = CurrentUser,
    status_filter: JobStatus | None = None,
    niche_id: UUID | None = None,
    limit: int = 50,
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


@router.post("", response_model=Job, status_code=status.HTTP_202_ACCEPTED)
async def enqueue_job(body: JobEnqueue, ctx: AuthCtx = CurrentUser) -> Job:
    """Spawn a pipeline run on Modal. Returns the queued Job row;
    poll GET /{job_id} for status."""
    import modal

    job = await jobs_repo.create(
        user_id=ctx.user_id, niche_id=body.niche_id, platform=body.platform
    )
    fn = modal.Function.from_name("marketer", "run_pipeline")
    fn.spawn(ctx.user_id, str(body.niche_id), body.platform)
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

    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
    if job.status != JobStatus.awaiting_approval:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"job is {job.status.value}, not awaiting_approval",
        )
    fn = modal.Function.from_name("marketer", "finish_scheduling")
    fn.spawn(ctx.user_id, str(job_id))
    return job


@router.post("/{job_id}/reject", response_model=Job)
async def reject_job(job_id: UUID, ctx: AuthCtx = CurrentUser) -> Job:
    """Operator veto on an `awaiting_approval` job. The rendered video
    stays on the volume (retention GC handles cleanup); the job is marked
    failed so it never posts."""
    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
    if job.status != JobStatus.awaiting_approval:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"job is {job.status.value}, not awaiting_approval",
        )
    job.status = JobStatus.failed
    job.error = "rejected by operator before posting"
    await jobs_repo.save_snapshot(job)
    return job


@router.post("/{job_id}/retry", response_model=Job, status_code=status.HTTP_202_ACCEPTED)
async def retry_job(job_id: UUID, ctx: AuthCtx = CurrentUser) -> Job:
    """Re-run a previously failed job from scratch. Only works on jobs in
    `failed` state owned by the caller."""
    import modal

    job = await jobs_repo.reset_for_retry(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="job not found, not owned, or not in failed state",
        )
    fn = modal.Function.from_name("marketer", "run_pipeline")
    fn.spawn(ctx.user_id, str(job.niche_id), job.platform)
    return job
