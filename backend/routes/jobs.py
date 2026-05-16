from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from autocontent.models import Job, JobStatus
from autocontent.repos import jobs as jobs_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class JobEnqueue(BaseModel):
    niche_id: UUID
    platform: Literal["tiktok", "reels", "shorts"]


@router.get("", response_model=list[Job])
async def list_jobs(
    ctx: AuthCtx = CurrentUser,
    status_filter: JobStatus | None = None,
    limit: int = 50,
) -> list[Job]:
    return await jobs_repo.list_for_user(ctx.user_id, status=status_filter, limit=limit)


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
    fn = modal.Function.from_name("autocontent", "run_pipeline")
    fn.spawn(ctx.user_id, str(body.niche_id), body.platform)
    return job
