"""Competitor tracking and performance alerts (Team Competitors).

Registered in main.py at /api/v1/competitors. Covers the tracked-competitor
registry + their diffed article feed, a manual trigger for the hourly
competitor_watch scan, and the performance_alerts inbox (both
competitor_watch and alert_scan write into the same table).
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.repos import competitors as competitors_repo
from marketer.repos.competitors import Competitor, CompetitorArticle, PerformanceAlert

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


# ---------------------------------------------------------------------------
# Competitors
# ---------------------------------------------------------------------------


class CompetitorCreate(BaseModel):
    domain: str = Field(min_length=1, max_length=255)
    label: str = Field(default="", max_length=200)
    niche_id: UUID | None = None


@router.post("", response_model=Competitor, status_code=status.HTTP_201_CREATED)
async def create_competitor(body: CompetitorCreate, ctx: AuthCtx = CurrentUser) -> Competitor:
    domain = body.domain.strip().lower().removeprefix("https://").removeprefix("http://")
    domain = domain.removeprefix("www.").split("/")[0]
    if not domain:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "domain is required")
    try:
        return await competitors_repo.create(
            user_id=ctx.user_id, domain=domain, label=body.label, niche_id=body.niche_id,
        )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "competitor already tracked"
        ) from exc


@router.get("", response_model=list[Competitor])
async def list_competitors(ctx: AuthCtx = CurrentUser) -> list[Competitor]:
    return await competitors_repo.list_for_user(ctx.user_id)


@router.delete("/{competitor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_competitor(competitor_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    deleted = await competitors_repo.delete(competitor_id, user_id=ctx.user_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.get("/{competitor_id}/articles", response_model=list[CompetitorArticle])
async def list_competitor_articles(
    competitor_id: UUID, ctx: AuthCtx = CurrentUser
) -> list[CompetitorArticle]:
    competitor = await competitors_repo.get(competitor_id, user_id=ctx.user_id)
    if competitor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await competitors_repo.list_articles(competitor_id, user_id=ctx.user_id)


# ---------------------------------------------------------------------------
# Manual scan trigger
# ---------------------------------------------------------------------------


@router.post("/watch/run")
async def run_watch(ctx: AuthCtx = CurrentUser) -> dict:
    """Manually trigger the same competitor_watch pass the hourly cron
    runs. Runs the full (all-users) scan — competitor_watch has no
    per-user scoping — so this is mainly useful for testing/ops, not as a
    "refresh my competitors" self-service button."""
    from marketer.services import competitor_watch

    return await competitor_watch.run()


# ---------------------------------------------------------------------------
# Performance alerts inbox
# ---------------------------------------------------------------------------


@router.get("/alerts", response_model=list[PerformanceAlert])
async def list_alerts(
    ctx: AuthCtx = CurrentUser,
    acknowledged: bool | None = Query(default=None),
) -> list[PerformanceAlert]:
    return await competitors_repo.list_alerts_for_user(ctx.user_id, acknowledged=acknowledged)


@router.post("/alerts/{alert_id}/ack", response_model=PerformanceAlert)
async def acknowledge_alert(alert_id: UUID, ctx: AuthCtx = CurrentUser) -> PerformanceAlert:
    alert = await competitors_repo.acknowledge(alert_id, user_id=ctx.user_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found or already acknowledged")
    return alert
