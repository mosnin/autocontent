"""Plan execution: steps -> canvas objects.

Runs a validated ``DesignPlan`` layer by layer. Within a layer steps are
independent, so they run concurrently under a semaphore; across layers a
step only starts once every step it depends on has produced a file, so
later steps genuinely edit the output of earlier ones (the iterative
canvas, not N unrelated renders).

Three properties this module exists to guarantee:

1. **Bounded spend.** A plan can be long, so the cap is re-checked
   before every single step, not once at the top. The moment
   ``SpendCapExceeded`` fires (or a sibling task trips ``abort_event``)
   the run stops cleanly and reports what it produced — the same
   contract ``pipeline.py`` honors mid-run.
2. **Resume.** Outputs are content-addressed by recipe, so a retry finds
   the finished files of already-completed steps on the volume and skips
   them. Nothing that was paid for is re-bought.
3. **Blast radius.** One failed step fails only itself and its
   downstream; independent branches keep going and stay resumable.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

from ..config import settings
from ..logging import get_logger
from ..storage.volume import job_root
from .operations import file_digest, recipe_digest, run_operation, step_cost_usd
from .plan import (
    CanvasObject,
    DesignPlan,
    PlanStep,
    remaining_cost_usd,
    reset_from,
    topological_layers,
    validate_plan,
)

log = get_logger(__name__)

STATUS_DONE = "done"
STATUS_FAILED = "failed"
STATUS_CAPPED = "spend_capped"


@dataclass
class ExecutionResult:
    plan: DesignPlan
    canvas: list[CanvasObject] = field(default_factory=list)
    status: str = STATUS_DONE
    error: str = ""


def project_root(user_id: str, project_id: UUID | str) -> Path:
    """Volume directory for one design project.

    Goes through ``storage.volume.job_root`` so design artifacts land in
    the same user-partitioned tree as every other artifact and are swept
    by the same retention job.
    """
    return job_root(f"{user_id}/design/{project_id}")


def objects_dir(user_id: str, project_id: UUID | str) -> Path:
    d = project_root(user_id, project_id) / "objects"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _canvas_object(step: PlanStep, *, size: str) -> CanvasObject | None:
    if not step.is_complete():
        return None
    path = Path(step.output_path)
    return CanvasObject(
        step_id=step.id,
        index=step.index,
        operation=step.operation,
        label=step.label,
        path=step.output_path,
        digest=step.output_digest,
        size=size,
        bytes=path.stat().st_size if path.exists() else 0,
    )


def canvas_from_plan(plan: DesignPlan) -> list[CanvasObject]:
    objs = [_canvas_object(s, size=plan.size) for s in plan.steps]
    return [o for o in objs if o is not None]


async def _run_step(
    step: PlanStep,
    *,
    plan: DesignPlan,
    out_dir: Path,
    digests: dict[str, str],
    paths: dict[str, Path],
    spend,
) -> None:
    """Execute one step in place (mutates ``step``'s runtime fields)."""
    input_digests = [digests[d] for d in step.depends_on]
    input_paths = [paths[d] for d in step.depends_on]

    address = recipe_digest(
        operation=step.operation,
        prompt=step.inputs.prompt,
        text=step.inputs.text,
        quality=step.inputs.quality,
        size=plan.size,
        input_digests=input_digests,
    )
    out_path = out_dir / f"{address}.png"

    # Content-addressed resume: an identical recipe over identical inputs
    # produces an identical file, so a prior attempt's output is reusable
    # even when the DB lost the step's status (crash between render and
    # persist). Free correctness, and it never re-buys an image.
    if out_path.exists() and out_path.stat().st_size > 0:
        log.info("design: reusing content-addressed object", extra={"step": step.id})
    else:
        await run_operation(
            operation=step.operation,
            prompt=step.inputs.prompt,
            text=step.inputs.text,
            quality=step.inputs.quality,
            size=plan.size,
            inputs=input_paths,
            out_path=out_path,
            spend=spend,
        )

    step.output_path = str(out_path)
    step.output_digest = file_digest(out_path)
    step.status = "done"
    step.error = ""


async def execute_plan(
    plan: DesignPlan,
    *,
    user_id: str,
    project_id: UUID | str,
    spend=None,
    fanout_limit: int | None = None,
    on_progress=None,
) -> ExecutionResult:
    """Execute *plan*, returning the mutated plan plus its canvas objects.

    ``on_progress(plan)`` is awaited after every layer so the caller can
    persist partial progress — that snapshot is what makes both the live
    plan view and resume work.
    """
    # Never execute an unvalidated plan, even one loaded back from the
    # database: a row could have been written by an older, laxer build.
    validate_plan(plan, max_steps=len(plan.steps))

    from ..repos.spend import SpendCapExceeded

    out_dir = objects_dir(user_id, project_id)
    limit = fanout_limit or settings.scene_fanout_limit
    sem = asyncio.Semaphore(max(1, limit))

    digests: dict[str, str] = {}
    paths: dict[str, Path] = {}
    blocked: set[str] = set()
    result = ExecutionResult(plan=plan)

    # Seed from steps a prior attempt already completed (resume).
    for step in plan.steps:
        if step.is_complete() and Path(step.output_path).exists():
            digests[step.id] = step.output_digest
            paths[step.id] = Path(step.output_path)
        elif step.status == "done":
            # Row says done but the volume lost the file — redo it.
            step.status = "pending"
            step.output_path = ""
            step.output_digest = ""

    log.info(
        "design: executing plan",
        extra={
            "steps": len(plan.steps),
            "remaining_usd": str(remaining_cost_usd(plan)),
        },
    )

    capped: SpendCapExceeded | None = None

    for layer in topological_layers(plan):
        if capped is not None:
            break
        runnable = [
            s
            for s in layer
            if not s.is_complete() and not (blocked & set(s.depends_on))
        ]
        # Anything whose upstream failed can never run — mark it, don't try.
        for s in layer:
            if blocked & set(s.depends_on):
                s.status = "skipped"
                s.error = "upstream step did not produce an output"
                blocked.add(s.id)

        async def _bounded(step: PlanStep) -> None:
            async with sem:
                # Re-check the cap immediately before each step. A plan is
                # many paid calls; checking once up front would let a run
                # that started under the cap blow straight through it.
                if spend is not None:
                    await spend.ensure_can_spend(
                        step_cost_usd(
                            step.operation,
                            quality=step.inputs.quality,
                            size=plan.size,
                        )
                    )
                step.status = "running"
                await _run_step(
                    step,
                    plan=plan,
                    out_dir=out_dir,
                    digests=digests,
                    paths=paths,
                    spend=spend,
                )

        outcomes = await asyncio.gather(
            *[_bounded(s) for s in runnable], return_exceptions=True
        )
        for step, outcome in zip(runnable, outcomes):
            if outcome is None:
                digests[step.id] = step.output_digest
                paths[step.id] = Path(step.output_path)
                continue
            if isinstance(outcome, SpendCapExceeded):
                # Clean stop: this step never produced anything, but every
                # step that already did keeps its output for the retry.
                step.status = "pending"
                step.error = str(outcome)
                blocked.add(step.id)
                capped = capped or outcome
                continue
            step.status = "failed"
            step.error = str(outcome)[:500]
            blocked.add(step.id)
            log.warning(
                "design: step failed",
                extra={"step": step.id, "error": str(outcome)},
            )

        if on_progress is not None:
            await on_progress(plan)

    # Steps still pending after the loop were never reachable (their
    # branch was capped or blocked). Leave capped ones pending so a
    # retry picks them straight back up.
    if capped is not None:
        for step in plan.steps:
            if step.status in ("pending", "running") and step.id not in blocked:
                step.status = "pending"
                step.error = step.error or "not started: spend cap reached"
        result.status = STATUS_CAPPED
        result.error = str(capped)
    elif any(s.status == "failed" for s in plan.steps):
        result.status = STATUS_FAILED
        first = next(s for s in plan.steps if s.status == "failed")
        result.error = f"step {first.id}: {first.error}"

    result.canvas = canvas_from_plan(plan)
    return result


# ------------------------------------------------------------------- driver


async def run_design_project(
    *,
    user_id: str,
    project_id: UUID,
    from_step_id: str = "",
) -> dict:
    """Drive one design project to a terminal state.

    queued -> planning (one metered LLM call) -> executing (the plan,
    layer by layer) -> done | failed. This is the function the Modal
    entrypoint calls.

    ``from_step_id`` re-runs one step and everything downstream of it,
    keeping every other completed output.
    """
    from ..billing.gates import raise_if_unbilled
    from ..repos import design_projects as projects_repo
    from ..repos import niches as niches_repo
    from ..repos.spend import SpendCapExceeded
    from ..services.spend_context import default_context
    from .plan import PlanValidationError
    from .planner import plan_design

    raise_if_unbilled()
    project = await projects_repo.get(project_id, user_id=user_id)
    if project is None:
        raise ValueError(f"design project {project_id} not found for {user_id}")

    niche = await niches_repo.get(project["niche_id"], user_id=user_id)
    if niche is None:
        return await projects_repo.fail(
            project_id, user_id=user_id, error="niche not found"
        )

    spend = await default_context(
        user_id=user_id,
        niche_id=niche.id,
        job_id=None,
        cap_usd=niche.daily_spend_cap_usd,
    )

    fmt = project["format"]
    max_steps = int(project["max_steps"])
    stored = project.get("plan") or {}

    try:
        # Resume: reuse the plan a prior attempt already paid an LLM call
        # for. Re-planning would both double-charge and invalidate every
        # completed step's content address.
        if stored.get("steps"):
            plan = DesignPlan.model_validate(stored)
            if from_step_id:
                if from_step_id not in plan.by_id():
                    return await projects_repo.fail(
                        project_id, user_id=user_id,
                        error=f"unknown step {from_step_id}",
                    )
                plan = reset_from(plan, from_step_id)
        else:
            await projects_repo.set_status(
                project_id, user_id=user_id, status="planning"
            )
            plan = await plan_design(
                project["brief"],
                fmt=fmt,
                max_steps=max_steps,
                niche=niche,
                spend=spend,
            )
        await projects_repo.save_plan(project_id, user_id=user_id, plan=plan.model_dump())
    except PlanValidationError as e:
        # An unusable plan is a planning failure, not a spend failure —
        # nothing was rendered, so there is nothing to keep.
        return await projects_repo.fail(
            project_id, user_id=user_id, error=f"plan rejected: {e}"
        )
    except SpendCapExceeded as e:
        return await projects_repo.fail(project_id, user_id=user_id, error=str(e))

    await projects_repo.set_status(project_id, user_id=user_id, status="executing")

    async def _persist(p: DesignPlan) -> None:
        await projects_repo.save_plan(project_id, user_id=user_id, plan=p.model_dump())

    result = await execute_plan(
        plan,
        user_id=user_id,
        project_id=project_id,
        spend=spend,
        on_progress=_persist,
    )

    await projects_repo.save_canvas(
        project_id,
        user_id=user_id,
        plan=result.plan.model_dump(),
        canvas=[o.model_dump() for o in result.canvas],
    )
    if result.status == STATUS_DONE:
        return await projects_repo.complete(project_id, user_id=user_id)
    return await projects_repo.fail(
        project_id, user_id=user_id, error=result.error or result.status
    )
