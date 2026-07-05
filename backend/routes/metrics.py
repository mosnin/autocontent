"""Account-wide engagement summary — the loop's payoff, one number.

Closes the emotional loop the whole product is built around: the machine
makes videos, and here's what they earned. Powers the dashboard banner.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from autocontent.repos import post_metrics as post_metrics_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class MetricsSummary(BaseModel):
    total_views: int
    sampled_videos: int
    best_job_id: str | None
    best_views: int | None
    days: int


@router.get("/summary", response_model=MetricsSummary)
async def metrics_summary(ctx: AuthCtx = CurrentUser) -> MetricsSummary:
    data = await post_metrics_repo.account_summary(ctx.user_id, days=30)
    return MetricsSummary(**data)
