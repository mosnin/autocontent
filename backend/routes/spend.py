from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel

from autocontent.repos import spend as spend_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class TodaySpend(BaseModel):
    by_niche: dict[str, Decimal]
    total_usd: Decimal


@router.get("/today", response_model=TodaySpend)
async def today_spend(ctx: AuthCtx = CurrentUser) -> TodaySpend:
    rows = await spend_repo.today_spend_by_niche(user_id=ctx.user_id)
    by_niche = {str(k): v for k, v in rows.items()}
    return TodaySpend(by_niche=by_niche, total_usd=sum(rows.values(), Decimal(0)))
