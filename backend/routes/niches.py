from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.models import Niche, PostingWindow
from marketer.repos import niches as niches_repo
from marketer.services.character_sheet import sheet_path

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class DraftRequest(BaseModel):
    description: str


@router.post("/draft")
async def draft_niche_spec(
    body: DraftRequest, ctx: AuthCtx = CurrentUser
) -> dict:
    """One sentence in, a full channel spec out. The onboarding front
    door: the client shows the returned fields on a review screen so the
    user launches instead of filling a 16-field form."""
    from marketer.agents.niche_draft import draft_niche
    from marketer.repos import brand_kit as brand_kit_repo

    text = body.description.strip()
    if len(text) < 8:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="describe your channel in a sentence (at least a few words)",
        )
    # Steer the draft with the user's brand kit when they have one.
    kit = await brand_kit_repo.get(ctx.user_id)
    brand_context = brand_kit_repo.as_prompt_context(kit)
    try:
        draft = await draft_niche(text, brand_context=brand_context)
    except Exception as e:  # noqa: BLE001 — surface as a clean 502
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"could not draft a channel: {e}",
        ) from e
    return draft.model_dump()


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
    # Strictly positive: a zero/negative cap would trip the spend guard on
    # the very first metered call, failing every run for the niche.
    daily_spend_cap_usd: Decimal = Field(gt=0)
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = 5
    tts_style_directions: str | None = None
    approve_before_post: bool = False
    character_description: str | None = None


class NicheUpdate(BaseModel):
    """All fields optional — partial update.

    Mirrors :class:`NicheCreate` so the web client can POST the same
    payload to either endpoint and the backend interprets unset keys
    as "leave alone".
    """

    title: str | None = None
    description: str | None = None
    target_audience: str | None = None
    hashtags: list[str] | None = None
    visual_style: str | None = None
    voice: str | None = None
    target_duration_sec: int | None = None
    scene_count: int | None = None
    posting_windows: list[PostingWindow] | None = None
    platforms: list[Literal["tiktok", "reels", "shorts"]] | None = None
    daily_spend_cap_usd: Decimal | None = Field(default=None, gt=0)
    image_quality: Literal["low", "medium", "high"] | None = None
    video_resolution: Literal["480p", "720p"] | None = None
    scene_max_duration_sec: int | None = None
    tts_style_directions: str | None = None
    approve_before_post: bool | None = None
    character_description: str | None = None


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


@router.put("/{niche_id}", response_model=Niche)
async def update_niche(
    niche_id: UUID,
    body: NicheUpdate,
    ctx: AuthCtx = CurrentUser,
) -> Niche:
    """Partial update. Fields left unset are not touched."""
    # exclude_unset so omitted JSON keys (vs. explicit nulls) don't
    # clobber existing values.
    fields = body.model_dump(exclude_unset=True)
    n = await niches_repo.update(niche_id, user_id=ctx.user_id, **fields)
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return n


@router.delete("/{niche_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_niche(niche_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    await niches_repo.archive(niche_id, user_id=ctx.user_id)


@router.get("/{niche_id}/character-sheet")
async def character_sheet_image(
    niche_id: UUID, ctx: AuthCtx = CurrentUser
) -> FileResponse:
    """The niche's generated character sheet — the face of the channel.

    404 until the first pipeline run generates it; the niche detail page
    hides the card in that case."""
    niche = await niches_repo.get(niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")
    path = sheet_path(niche_id)
    if not path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="character sheet not generated yet — run a video first",
        )
    return FileResponse(path, media_type="image/png")
