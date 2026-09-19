"""Account-wide engagement summary — the loop's payoff, one number.

Closes the emotional loop the whole product is built around: the machine
makes videos, and here's what they earned. Powers the dashboard banner.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from marketer.repos import post_metrics as post_metrics_repo

from ..auth import AuthCtx, CurrentUser
from ..rate_limit import limiter

router = APIRouter()
_READ_LIMIT = "30/minute"


class MetricsSummary(BaseModel):
    total_views: int
    sampled_videos: int
    best_job_id: str | None
    best_views: int | None
    days: int


@router.get("/summary", response_model=MetricsSummary)
@limiter.limit(_READ_LIMIT)
async def metrics_summary(request: Request, ctx: AuthCtx = CurrentUser) -> MetricsSummary:
    data = await post_metrics_repo.account_summary(ctx.user_id, days=30)
    return MetricsSummary(**data)
