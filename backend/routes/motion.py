"""Motion graphics / kinetic typography.

- GET  /api/v1/motion/styles              — the style catalog + type previews
- POST /api/v1/motion/projects            — enqueue (the render is async)
- GET  /api/v1/motion/projects            — list, newest first
- GET  /api/v1/motion/projects/{id}       — project + beats + overlay specs
- GET  /api/v1/motion/projects/{id}/video — stream the composited mp4
- POST /api/v1/motion/projects/{id}/retry — resume a failed project

Every project route is user-scoped through ``AuthCtx``; a project
belonging to another user is a 404, never a 403, so ids can't be probed.
"""
from __future__ import annotations

import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.motion.broll import SOURCES
from marketer.motion.styles import UnknownStyle, catalog, get_style
from marketer.repos import jobs as jobs_repo
from marketer.repos import motion_projects as projects_repo
from marketer.repos import niches as niches_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

_MODAL_APP = "marketer-sh"
_MODAL_FN = "run_motion_project"

# Narration is the one free-text field and it drives both TTS spend and
# the beat count, so it is bounded at the edge as well as in `beats`.
MAX_NARRATION_CHARS = 6000


class MotionProjectCreate(BaseModel):
    niche_id: UUID
    # Either narration (synthesize a voiceover) or job_id (reuse the
    # voiceover + transcript that job already paid for).
    narration: str = Field(default="", max_length=MAX_NARRATION_CHARS)
    job_id: UUID | None = None
    style_key: str = "modern-flat"
    aspect: Literal["9:16", "16:9", "1:1"] = "9:16"
    source: Literal["generated", "stock", "mixed"] = "generated"

    model_config = {"extra": "forbid"}


def _spawn(user_id: str, project_id: UUID) -> None:
    import modal

    fn = modal.Function.from_name(_MODAL_APP, _MODAL_FN)
    fn.spawn(user_id, str(project_id))


@router.get("/styles")
async def list_styles(ctx: AuthCtx = CurrentUser) -> list[dict]:
    """The motion-style catalog, with the typographic-treatment preview
    the picker renders so a user can judge a look without a render."""
    return catalog()


@router.get("/projects")
async def list_projects(
    status_filter: str | None = None, limit: int = 50, ctx: AuthCtx = CurrentUser
) -> list[dict]:
    return await projects_repo.list_for_user(
        ctx.user_id, status=status_filter, limit=min(max(limit, 1), 200)
    )


@router.post("/projects", status_code=status.HTTP_202_ACCEPTED)
async def create_project(body: MotionProjectCreate, ctx: AuthCtx = CurrentUser) -> dict:
    """Create a motion project and kick off the render in the background."""
    narration = body.narration.strip()
    if not narration and body.job_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="either narration or job_id is required",
        )
    if body.source not in SOURCES:  # defence in depth behind the Literal
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown source {body.source!r}"
        )
    try:
        style = get_style(body.style_key)
    except UnknownStyle as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown style {body.style_key!r}",
        ) from e

    if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")
    if body.job_id is not None:
        # Ownership-checked here so a foreign job id can never be used to
        # pull another user's voiceover into this user's render.
        if await jobs_repo.get(body.job_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="job not found")

    project = await projects_repo.create(
        user_id=ctx.user_id,
        niche_id=body.niche_id,
        narration=narration,
        job_id=body.job_id,
        style_key=style.key,
        aspect=body.aspect,
        source=body.source,
    )
    _spawn(ctx.user_id, project["id"])
    return project


@router.get("/projects/{project_id}")
async def get_project(project_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """The row plus its beats (each with the b-roll strategy that supplied
    it and the keyword/prompt used) and the overlay specs."""
    project = await projects_repo.get(project_id, user_id=ctx.user_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return project


@router.get("/projects/{project_id}/video")
async def get_project_video(project_id: UUID, ctx: AuthCtx = CurrentUser) -> FileResponse:
    """Stream the composited mp4.

    Ownership-scoped: the path is read out of the caller's own project
    row, never taken from the request, so a project id can't be used to
    reach any other file on the volume. A project that hasn't finished —
    or whose file the retention sweep already removed — is a 404, not a
    500 on an unreadable path.
    """
    project = await projects_repo.get(project_id, user_id=ctx.user_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    path = project.get("video_path") or ""
    if not path or not os.path.exists(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no video yet")
    return FileResponse(path, media_type="video/mp4")


@router.post("/projects/{project_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_project(project_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Resume a failed project. Keyframes already on the volume are reused."""
    if not await projects_repo.claim_for_retry(project_id, user_id=ctx.user_id):
        existing = await projects_repo.get(project_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"project is {existing['status']}, not failed",
        )
    _spawn(ctx.user_id, project_id)
    return {"status": "queued"}
