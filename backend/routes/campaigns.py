"""Campaigns: orchestrate Studio + Press + Ads lanes against a window
and a content-credit budget.

- GET    /api/v1/campaigns                    — list
- POST   /api/v1/campaigns                    — create (draft)
- GET    /api/v1/campaigns/{id}               — detail + overview rollup
- POST   /api/v1/campaigns/{id}/start|pause   — lifecycle
- POST   /api/v1/campaigns/{id}/items         — add a lane
- PATCH  /api/v1/campaigns/{id}/items/{item}  — enable/disable a lane
- DELETE /api/v1/campaigns/{id}/items/{item}  — remove a lane

Lane refs are validated against the caller's own resources (their niche
or their ad campaign) — no cross-tenant references.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.models import Campaign, CampaignItem
from marketer.repos import campaigns as campaigns_repo
from marketer.repos import niches as niches_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    objective: str = ""
    budget_usd: Decimal = Field(gt=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class ItemCreate(BaseModel):
    kind: Literal["video", "article", "ad", "image"]
    ref_id: UUID
    cadence_per_week: int = Field(default=3, ge=1, le=56)


class ItemPatch(BaseModel):
    enabled: bool


class CampaignOverview(BaseModel):
    campaign: Campaign
    items: list[CampaignItem]
    spent_usd: Decimal
    videos_total: int
    articles_total: int


@router.get("", response_model=list[Campaign])
async def list_campaigns(ctx: AuthCtx = CurrentUser) -> list[Campaign]:
    return await campaigns_repo.list_for_user(ctx.user_id)


@router.post("", response_model=Campaign, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    body: CampaignCreate, ctx: AuthCtx = CurrentUser
) -> Campaign:
    if body.ends_at is not None and body.starts_at is not None \
            and body.ends_at <= body.starts_at:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ends_at must be after starts_at"
        )
    return await campaigns_repo.create(user_id=ctx.user_id, **body.model_dump())


@router.get("/{campaign_id}", response_model=CampaignOverview)
async def get_campaign(
    campaign_id: UUID, ctx: AuthCtx = CurrentUser
) -> CampaignOverview:
    campaign = await campaigns_repo.get(campaign_id, user_id=ctx.user_id)
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    items = await campaigns_repo.list_items(campaign_id, user_id=ctx.user_id)
    spent = await campaigns_repo.spent_usd(campaign_id, user_id=ctx.user_id)
    counts = await campaigns_repo.work_counts(campaign_id, user_id=ctx.user_id)
    return CampaignOverview(
        campaign=campaign,
        items=items,
        spent_usd=spent,
        videos_total=sum(v["total"] for v in counts["video"].values()),
        articles_total=sum(a["total"] for a in counts["article"].values()),
    )


@router.post("/{campaign_id}/start", response_model=Campaign)
async def start_campaign(campaign_id: UUID, ctx: AuthCtx = CurrentUser) -> Campaign:
    campaign = await campaigns_repo.get(campaign_id, user_id=ctx.user_id)
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if campaign.status == "completed":
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="completed campaigns cannot restart"
        )
    return await campaigns_repo.set_status(
        campaign_id, user_id=ctx.user_id, status="running"
    )


@router.post("/{campaign_id}/pause", response_model=Campaign)
async def pause_campaign(campaign_id: UUID, ctx: AuthCtx = CurrentUser) -> Campaign:
    campaign = await campaigns_repo.get(campaign_id, user_id=ctx.user_id)
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if campaign.status != "running":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="campaign is not running")
    return await campaigns_repo.set_status(
        campaign_id, user_id=ctx.user_id, status="paused"
    )


@router.post(
    "/{campaign_id}/items",
    response_model=CampaignItem,
    status_code=status.HTTP_201_CREATED,
)
async def add_item(
    campaign_id: UUID, body: ItemCreate, ctx: AuthCtx = CurrentUser
) -> CampaignItem:
    campaign = await campaigns_repo.get(campaign_id, user_id=ctx.user_id)
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    # Lane refs must belong to the caller.
    if body.kind in ("video", "article", "image"):
        if await niches_repo.get(body.ref_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")
    else:  # ad
        from marketer.repos import ads as ads_repo

        if await ads_repo.get_campaign(body.ref_id, user_id=ctx.user_id) is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="ad campaign not found"
            )

    return await campaigns_repo.add_item(
        campaign_id=campaign_id, user_id=ctx.user_id,
        kind=body.kind, ref_id=body.ref_id,
        cadence_per_week=body.cadence_per_week,
    )


@router.patch("/{campaign_id}/items/{item_id}", response_model=CampaignItem)
async def patch_item(
    campaign_id: UUID, item_id: UUID, body: ItemPatch, ctx: AuthCtx = CurrentUser
) -> CampaignItem:
    item = await campaigns_repo.set_item_enabled(
        item_id, user_id=ctx.user_id, enabled=body.enabled
    )
    if item is None or item.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return item


@router.delete(
    "/{campaign_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_item(
    campaign_id: UUID, item_id: UUID, ctx: AuthCtx = CurrentUser
) -> None:
    if not await campaigns_repo.remove_item(item_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
