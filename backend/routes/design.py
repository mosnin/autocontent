"""Design Agent: autonomous brief -> plan -> canvas.

- POST /api/v1/design/projects                        — enqueue (planning is async)
- GET  /api/v1/design/projects                        — list, newest first
- GET  /api/v1/design/projects/{id}                   — project + plan + canvas
- GET  /api/v1/design/projects/{id}/steps/{sid}/image — stream one step's output
- POST /api/v1/design/projects/{id}/retry             — resume a failed project
- POST /api/v1/design/projects/{id}/steps/{sid}/retry — re-run a step + downstream

Every route is user-scoped through ``AuthCtx``; a project belonging to
another user is a 404, never a 403, so ids can't be probed.
"""
from __future__ import annotations

import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.design.plan import (
    HARD_MAX_STEPS,
    DesignPlan,
    PlanValidationError,
    reset_from,
)
from marketer.repos import design_projects as projects_repo
from marketer.repos import niches as niches_repo

from ..auth import AuthCtx, CurrentUser
from ..hosted_safety import refuse_unbilled_generate

router = APIRouter()

_MODAL_APP = "marketer-sh"
_MODAL_FN = "run_design_project"


class DesignProjectCreate(BaseModel):
    niche_id: UUID
    brief: str = Field(default="", max_length=4000)
    # Field name matches the HTTP contract the web UI is built against.
    format: Literal["1:1", "9:16", "16:9"] = "1:1"
    # Bounded at the edge as well as in the planner: the API is the first
    # place an oversized run can be refused, and refusing here costs nothing.
    max_steps: int = Field(default=8, ge=1, le=HARD_MAX_STEPS)


def _spawn(user_id: str, project_id: UUID, from_step_id: str = "") -> None:
    import modal

    fn = modal.Function.from_name(_MODAL_APP, _MODAL_FN)
    fn.spawn(user_id, str(project_id), from_step_id)


@router.get("/projects")
async def list_projects(
    status_filter: str | None = None, limit: int = 50, ctx: AuthCtx = CurrentUser
) -> list[dict]:
    return await projects_repo.list_for_user(
        ctx.user_id, status=status_filter, limit=min(max(limit, 1), 200)
    )


@router.post("/projects", status_code=status.HTTP_202_ACCEPTED)
async def create_project(
    body: DesignProjectCreate, ctx: AuthCtx = CurrentUser
) -> dict:
    """Create a design project and kick off planning in the background."""
    refuse_unbilled_generate()
    if not body.brief.strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="brief is required"
        )
    if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    project = await projects_repo.create(
        user_id=ctx.user_id,
        niche_id=body.niche_id,
        brief=body.brief.strip(),
        fmt=body.format,
        max_steps=body.max_steps,
    )
    _spawn(ctx.user_id, project["id"])
    return project


@router.get("/projects/{project_id}")
async def get_project(project_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """The row plus its plan and canvas — what the plan visualizer renders."""
    project = await projects_repo.get(project_id, user_id=ctx.user_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return project


@router.get("/projects/{project_id}/steps/{step_id}/image")
async def get_step_image(
    project_id: UUID, step_id: str, ctx: AuthCtx = CurrentUser
) -> FileResponse:
    """Stream one step's output image.

    Ownership-scoped: the path is read out of the caller's own project
    row, never taken from the request, so a step id can't be used to
    reach another user's (or any other) file on the volume.
    """
    project = await projects_repo.get(project_id, user_id=ctx.user_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    steps = (project.get("plan") or {}).get("steps") or []
    step = next((s for s in steps if s.get("id") == step_id), None)
    if step is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such step")
    path = step.get("output_path") or ""
    if not path or not os.path.exists(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "step has no output")
    return FileResponse(path, media_type="image/png")


@router.post("/projects/{project_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_project(project_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Resume a failed project: completed steps keep their outputs."""
    refuse_unbilled_generate()
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


@router.post(
    "/projects/{project_id}/steps/{step_id}/retry",
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_step(
    project_id: UUID, step_id: str, ctx: AuthCtx = CurrentUser
) -> dict:
    """Re-run one step and everything downstream of it.

    The reset plan is computed here and stored as part of the same atomic
    claim, so two concurrent clicks can't both win and double-spend.
    """
    refuse_unbilled_generate()
    project = await projects_repo.get(project_id, user_id=ctx.user_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    try:
        plan = DesignPlan.model_validate(project.get("plan") or {})
    except Exception as e:  # noqa: BLE001 — a project mid-planning has no plan yet
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="project has no plan yet"
        ) from e
    if not plan.steps:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="project has no plan yet")
    if step_id not in plan.by_id():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such step")

    try:
        reset = reset_from(plan, step_id)
    except PlanValidationError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(e)) from e

    if not await projects_repo.claim_step_retry(
        project_id, user_id=ctx.user_id, plan=reset.model_dump()
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"project is {project['status']}; retry a step only when done or failed",
        )
    _spawn(ctx.user_id, project_id, step_id)
    return {"status": "queued", "from_step": step_id}
