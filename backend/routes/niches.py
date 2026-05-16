from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from autocontent.models import Niche, PostingWindow
from autocontent.repos import niches as niches_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class NicheCreate(BaseModel):
    title: str
    description: str
    target_audience: str
    hashtags: list[str]
    visual_style: str
    voice: str
    target_duration_sec: int
    scene_count: int
    posting_windows: list[PostingWindow]
    platforms: list[Literal["tiktok", "reels", "shorts"]]
    daily_spend_cap_usd: Decimal


@router.get("", response_model=list[Niche])
async def list_niches(ctx: AuthCtx = CurrentUser) -> list[Niche]:
    return await niches_repo.list_for_user(ctx.user_id)


@router.post("", response_model=Niche, status_code=status.HTTP_201_CREATED)
async def create_niche(body: NicheCreate, ctx: AuthCtx = CurrentUser) -> Niche:
    return await niches_repo.create(ctx.user_id, **body.model_dump())


@router.get("/{niche_id}", response_model=Niche)
async def get_niche(niche_id: UUID, ctx: AuthCtx = CurrentUser) -> Niche:
    n = await niches_repo.get(niche_id, user_id=ctx.user_id)
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return n


@router.delete("/{niche_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_niche(niche_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    await niches_repo.archive(niche_id, user_id=ctx.user_id)
