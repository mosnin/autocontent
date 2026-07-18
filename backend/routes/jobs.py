from __future__ import annotations

import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from marketer.models import Job, JobStatus, PostMetrics
from marketer.repos import jobs as jobs_repo
from marketer.repos import post_metrics as post_metrics_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class JobEnqueue(BaseModel):
    niche_id: UUID
    platform: Literal["tiktok", "reels", "shorts"]
    # When true, the Modal entrypoint runs ONLY ideation + scriptwriting
    # (metered as usual) and stops at `planned` — zero image/video/TTS
    # spend. The user reviews/edits the storyboard via GET/PUT
    # /jobs/{id}/plan, then continues via POST /jobs/{id}/render.
    plan_only: bool = False


class RerollBody(BaseModel):
    direction: str = Field(min_length=1, max_length=500)


class RevoiceBody(BaseModel):
    voice: str = Field(min_length=1, max_length=100)


class ScenePlanView(BaseModel):
    """One scene as surfaced to the storyboard editor — same shape as
    `marketer.models.Scene`, defined locally (rather than reusing Scene
    as the response model) so the plan API's request/response contract
    can evolve independently of the pipeline's internal script schema."""

    index: int
    narration: str
    visual_prompt: str
    motion_prompt: str
    duration_sec: float


class JobPlan(BaseModel):
    """GET/PUT /jobs/{id}/plan response: the editable storyboard."""

    job_id: UUID
    status: JobStatus
    hook: str
    topic: str
    voice: str
    scenes: list[ScenePlanView]
    total_duration_sec: float
    cta: str | None = None


class ScenePlanEdit(BaseModel):
    """One scene edit in a PUT /jobs/{id}/plan body. `index` pins the
    edit to the original scene it replaces — the full set of indices
    submitted must exactly match the original scene count (see
    `update_job_plan`'s validation). Narration/prompts are stripped and
    must be non-empty after stripping, so whitespace-only edits are
    rejected the same as truly empty ones."""

    index: int
    narration: str = Field(max_length=1000)
    visual_prompt: str = Field(max_length=2000)
    motion_prompt: str = Field(max_length=2000)

    @field_validator("narration", "visual_prompt", "motion_prompt")
    @classmethod
    def _stripped_non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v


class PlanUpdateBody(BaseModel):
    scenes: list[ScenePlanEdit]


def _assets_available(job: Job) -> bool:
    """True if everything scene/voice revision needs is still readable on
    the artifacts volume: the rendered final.mp4, the voiceover, and every
    scene clip. Any of those missing means retention GC (or a bad volume
    mount) already reclaimed the job's working files — the revision would
    fail partway through, so we refuse it up front with a clear 409
    instead of enqueueing a doomed Modal run."""
    if job.rendered is None or not os.path.exists(job.rendered.path):
        return False
    if job.audio is None or not os.path.exists(job.audio.voiceover_path):
        return False
    if not job.clips or any(not os.path.exists(c.video_path) for c in job.clips):
        return False
    return True


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


@router.post("", response_model=Job, status_code=status.HTTP_202_ACCEPTED)
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
    # plan_only routes to the plan-stage-only Modal entrypoint (ideation +
    # scriptwriting, then park at `planned`); the default full pipeline
    # runs straight through to scheduling as before.
    fn_name = "run_plan" if body.plan_only else "run_pipeline"
    fn = modal.Function.from_name("marketer-sh", fn_name)
    # Pass the job id so the pipeline reuses THIS row — otherwise the id
    # we just returned to the client never leaves `queued`.
    fn.spawn(ctx.user_id, str(body.niche_id), body.platform, str(job.id))
    return job


async def _job_plan_view(job: Job, *, user_id: str) -> JobPlan:
    """Build the JobPlan response shape from a Job with a persisted
    script. Shared by GET and PUT so both return the identical view."""
    assert job.script is not None
    from marketer.repos import niches as niches_repo

    niche = await niches_repo.get(job.niche_id, user_id=user_id)
    return JobPlan(
        job_id=job.id,
        status=job.status,
        hook=job.script.idea.hook,
        topic=job.script.idea.topic,
        voice=niche.voice if niche is not None else "",
        scenes=[
            ScenePlanView(
                index=s.index,
                narration=s.narration,
                visual_prompt=s.visual_prompt,
                motion_prompt=s.motion_prompt,
                duration_sec=s.duration_sec,
            )
            for s in job.script.scenes
        ],
        total_duration_sec=job.script.total_duration_sec,
        cta=job.script.cta,
    )


@router.get("/{job_id}/plan", response_model=JobPlan)
async def get_job_plan(job_id: UUID, ctx: AuthCtx = CurrentUser) -> JobPlan:
    """The editable storyboard for a job: scenes' narration + visual/motion
    prompts, plus the niche's voice for context. Available for any job
    that has a persisted script (not only `planned` ones), so a plan can
    still be inspected after render/approval."""
    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
    if job.script is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="job has no persisted script yet"
        )
    return await _job_plan_view(job, user_id=ctx.user_id)


@router.put("/{job_id}/plan", response_model=JobPlan)
async def update_job_plan(
    job_id: UUID, body: PlanUpdateBody, ctx: AuthCtx = CurrentUser
) -> JobPlan:
    """Persist storyboard edits before any render spend happens. Only
    valid while the job is `planned`: scene count must stay the same
    (the render fan-out is sized off it) and every original scene index
    must be covered exactly once. Non-empty text and length caps are
    enforced by `ScenePlanEdit`'s validators."""
    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
    if job.status != JobStatus.planned:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"job is {job.status.value}, not planned",
        )
    if job.script is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="job has no persisted script"
        )

    original_scenes = job.script.scenes
    if len(body.scenes) != len(original_scenes):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"scene count must not change: job has {len(original_scenes)} "
                f"scenes, got {len(body.scenes)}"
            ),
        )
    edits_by_index = {e.index: e for e in body.scenes}
    expected_indices = set(range(len(original_scenes)))
    if set(edits_by_index) != expected_indices:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"scene indices must be exactly 0..{len(original_scenes) - 1}, "
            "each appearing once",
        )

    new_scenes = [
        scene.model_copy(
            update={
                "narration": edits_by_index[scene.index].narration,
                "visual_prompt": edits_by_index[scene.index].visual_prompt,
                "motion_prompt": edits_by_index[scene.index].motion_prompt,
            }
        )
        for scene in original_scenes
    ]
    job.script = job.script.model_copy(update={"scenes": new_scenes})
    await jobs_repo.save_snapshot(job)
    return await _job_plan_view(job, user_id=ctx.user_id)


@router.post("/{job_id}/render", response_model=Job, status_code=status.HTTP_202_ACCEPTED)
async def render_job(job_id: UUID, ctx: AuthCtx = CurrentUser) -> Job:
    """Continue a `planned` job through rendering (images/video/TTS ->
    assembly -> QA -> approval gate/scheduling), using the (possibly
    edited) persisted script snapshot. Spawns the Modal `render_from_plan`
    function. Atomically claims the row out of `planned` first so a
    double click can't spawn two renders of the same script."""
    import modal

    job = await jobs_repo.claim_for_render(job_id, user_id=ctx.user_id)
    if job is None:
        existing = await jobs_repo.get(job_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"job is {existing.status.value}, not planned",
        )
    fn = modal.Function.from_name("marketer-sh", "render_from_plan")
    fn.spawn(ctx.user_id, str(job_id))
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

    # Atomic claim: exactly one approve call transitions the row out of
    # awaiting_approval, so a double-click can't spawn two schedulers
    # (and two social posts).
    job = await jobs_repo.claim_for_scheduling(job_id, user_id=ctx.user_id)
    if job is None:
        existing = await jobs_repo.get(job_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"job is {existing.status.value}, not awaiting_approval",
        )
    fn = modal.Function.from_name("marketer-sh", "finish_scheduling")
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
    fn = modal.Function.from_name("marketer-sh", "run_pipeline")
    # Reuse the job's own row: the retried id is the id that progresses.
    fn.spawn(ctx.user_id, str(job.niche_id), job.platform, str(job.id))
    return job


@router.post(
    "/{job_id}/scenes/{index}/reroll", response_model=Job, status_code=status.HTTP_202_ACCEPTED
)
async def reroll_scene(
    job_id: UUID, index: int, body: RerollBody, ctx: AuthCtx = CurrentUser
) -> Job:
    """Regenerate one scene's keyframe + clip ("make scene 3 darker")
    without re-rolling the whole video. Every other scene's clip is kept
    as-is; only the affected stages are re-metered.

    Requires the original job to still have a persisted script and every
    asset (final video, voiceover, all scene clips) on the artifacts
    volume — once retention GC reclaims them a scene reroll can't work,
    so this 409s with a clear message pointing at `/retry` instead."""
    import modal

    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
    if job.script is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="job has no persisted script to revise"
        )
    if not (0 <= index < len(job.script.scenes)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="scene index out of range"
        )
    if not _assets_available(job):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="source assets expired; use retry"
        )

    revision = await jobs_repo.create_revision(
        original=job, mode="reroll", scene_index=index, direction=body.direction,
    )
    fn = modal.Function.from_name("marketer-sh", "run_revision")
    fn.spawn(ctx.user_id, str(job_id), str(revision.id))
    return revision


@router.post("/{job_id}/revoice", response_model=Job, status_code=status.HTTP_202_ACCEPTED)
async def revoice_job(job_id: UUID, body: RevoiceBody, ctx: AuthCtx = CurrentUser) -> Job:
    """Re-synthesize the whole voiceover with a different voice, then
    re-run assembly (music/mix/captions) — the video clips are untouched.

    Same asset-availability requirement as scene reroll: 409s pointing at
    `/retry` when the original job's files are no longer on the volume."""
    import modal

    job = await jobs_repo.get(job_id, user_id=ctx.user_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")
    if job.script is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="job has no persisted script to revise"
        )
    if not _assets_available(job):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="source assets expired; use retry"
        )

    revision = await jobs_repo.create_revision(original=job, mode="revoice", voice=body.voice)
    fn = modal.Function.from_name("marketer-sh", "run_revision")
    fn.spawn(ctx.user_id, str(job_id), str(revision.id))
    return revision
