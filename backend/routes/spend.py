from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from autocontent.models import SpendHistory, TodaySpend
from autocontent.repos import spend as spend_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("/today", response_model=TodaySpend)
async def today_spend(ctx: AuthCtx = CurrentUser) -> TodaySpend:
    rows = await spend_repo.today_spend_by_niche(user_id=ctx.user_id)
    by_niche = {str(k): v for k, v in rows.items()}
    return TodaySpend(by_niche=by_niche, total_usd=sum(rows.values(), Decimal(0)))


@router.get("/history", response_model=SpendHistory)
async def spend_history(
    ctx: AuthCtx = CurrentUser,
    days: Annotated[int, Query(ge=1, le=90)] = 30,
    niche_id: UUID | None = None,
    group_by: Literal["day"] = "day",
) -> SpendHistory:
    """Return per-day spend aggregates for the authenticated user.

    ``days`` must be between 1 and 90 (inclusive). ``niche_id`` narrows
    the result to a single niche. ``group_by`` is reserved for future
    expansion (only ``"day"`` is supported now).
    """
    if days < 1 or days > 90:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="days must be between 1 and 90",
        )
    rows = await spend_repo.history(
        user_id=ctx.user_id,
        days=days,
        niche_id=niche_id,
    )
    total = sum((r.cost_usd for r in rows), Decimal(0))
    return SpendHistory(rows=rows, days=days, total_usd=total)
