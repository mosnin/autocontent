"""Performance attribution route.

GET /api/v1/niches/{niche_id}/performance?days=30

Returns NichePerformance — a joined view of jobs, spend, and post metrics for
a niche over the requested look-back window.  Auth-scoped: the niche must
belong to the authenticated user.

Mounting decision
-----------------
This route is mounted as a *separate* APIRouter included directly in main.py
under the prefix ``/api/v1/niches`` (same as the niches router).  Nesting it
inside niches.py's router would require touching that file and mixing concerns;
a sibling router keeps performance attribution self-contained.  FastAPI handles
two routers on the same prefix without conflict — the niches router owns the
plain ``/{niche_id}`` path and this router owns ``/{niche_id}/performance``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from marketer.models import JobPerformance, NichePerformance, PerformanceSummary
from marketer.repos import jobs as jobs_repo
from marketer.repos import niches as niches_repo
from marketer.repos import post_metrics as post_metrics_repo
from marketer.repos import spend as spend_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("/{niche_id}/performance", response_model=NichePerformance)
async def niche_performance(
    niche_id: UUID,
    ctx: AuthCtx = CurrentUser,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> NichePerformance:
    """Return performance attribution for all jobs in the niche over `days`.

    Steps:
    1. Verify niche ownership (404 if missing or not owned).
    2. List jobs for the niche created in the window.
    3. Batch-fetch spend and latest metrics in two round-trips.
    4. Build JobPerformance entries, then compute summary stats.
    """
    # 1. Ownership check + capture visual_style from niche row.
    niche = await niches_repo.get(niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "niche not found")

    visual_style: str | None = niche.visual_style or None

    # 2. List jobs scoped to this niche (no status filter — we want all).
    #    We pass a generous limit; attribution windows are typically ≤ 30 days
    #    of daily posts, so 1000 is a safe ceiling without a paged API.
    all_jobs = await jobs_repo.list_for_user(
        ctx.user_id,
        niche_id=niche_id,
        limit=1000,
    )

    # Filter to the requested time window.
    cutoff = datetime.now(timezone.utc).replace(tzinfo=timezone.utc)
    from datetime import timedelta
    window_start = cutoff - timedelta(days=days)

    # list_for_user returns Jobs whose created_at may be naive UTC (from DB).
    def _aware(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    jobs_in_window = [j for j in all_jobs if _aware(j.created_at) >= window_start]

    if not jobs_in_window:
        summary = PerformanceSummary(
            total_videos=0,
            total_spend_usd=Decimal("0"),
            total_views=0,
            avg_views_per_video=0.0,
            best_job_id=None,
            worst_job_id=None,
        )
        return NichePerformance(
            niche_id=niche_id,
            days=days,
            jobs=[],
            summary=summary,
        )

    job_ids = [j.id for j in jobs_in_window]

    # 3a. Batch-fetch spend — one DB round-trip.
    costs: dict[UUID, Decimal] = await spend_repo.cost_by_job(job_ids, user_id=ctx.user_id)

    # 3b. Fetch latest metrics for each job — one call per job via D1's
    #     latest_for_job.  This is N calls today; a future optimisation can
    #     batch with a multi-job variant once D1 lands.
    metrics_by_job: dict[UUID, object] = {}
    for jid in job_ids:
        m = await post_metrics_repo.latest_for_job(jid, user_id=ctx.user_id)
        if m is not None:
            metrics_by_job[jid] = m

    # 4. Build JobPerformance list.
    job_perfs: list[JobPerformance] = []
    for job in jobs_in_window:
        script = job.script
        hook: str | None = None
        topic: str | None = None
        scene_count: int | None = None
        target_duration_sec: int | None = None

        if script is not None:
            hook = script.idea.hook if script.idea else None
            topic = script.idea.topic if script.idea else None
            scene_count = len(script.scenes)
            # Use niche's target_duration_sec as the intended target; the
            # script's total_duration_sec is the actual rendered length.
            target_duration_sec = niche.target_duration_sec

        m = metrics_by_job.get(job.id)
        views: int | None = None
        likes: int | None = None
        watch_time_sec: Decimal | None = None
        avg_watch_time_sec: Decimal | None = None
        completion_rate: Decimal | None = None

        if m is not None:
            views = getattr(m, "views", None)
            likes = getattr(m, "likes", None)
            watch_time_sec = getattr(m, "watch_time_sec", None)
            avg_watch_time_sec = getattr(m, "avg_watch_time_sec", None)
            completion_rate = getattr(m, "completion_rate", None)

        job_perfs.append(
            JobPerformance(
                job_id=job.id,
                created_at=_aware(job.created_at),
                platform=job.platform,
                status=job.status.value,
                hook=hook,
                topic=topic,
                visual_style=visual_style,
                scene_count=scene_count,
                target_duration_sec=target_duration_sec,
                cost_usd=costs.get(job.id, Decimal("0")),
                views=views,
                likes=likes,
                watch_time_sec=watch_time_sec,
                avg_watch_time_sec=avg_watch_time_sec,
                completion_rate=completion_rate,
            )
        )

    # Compute summary stats.
    from marketer.models import JobStatus as _JobStatus

    done_jobs = [jp for jp in job_perfs if jp.status == _JobStatus.done.value]
    total_spend = sum((jp.cost_usd for jp in job_perfs), Decimal("0"))
    sampled = [jp for jp in job_perfs if jp.views is not None]
    total_views = sum(jp.views for jp in sampled if jp.views is not None)

    avg_views = float(total_views) / len(sampled) if sampled else 0.0

    best_job_id: UUID | None = None
    worst_job_id: UUID | None = None
    if sampled:
        best = max(sampled, key=lambda jp: jp.views or 0)
        worst = min(sampled, key=lambda jp: jp.views or 0)
        best_job_id = best.job_id
        worst_job_id = worst.job_id

    summary = PerformanceSummary(
        total_videos=len(done_jobs),
        total_spend_usd=total_spend,
        total_views=total_views,
        avg_views_per_video=avg_views,
        best_job_id=best_job_id,
        worst_job_id=worst_job_id,
    )

    return NichePerformance(
        niche_id=niche_id,
        days=days,
        jobs=job_perfs,
        summary=summary,
    )
