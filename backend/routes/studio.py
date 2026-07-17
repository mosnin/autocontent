"""Content Studio — AI image/video tools backed by fal.ai.

Every endpoint follows the same shape: resolve a source image (a
`media_assets` row or a raw URL) to a fal-compatible `image_url`, call
fal.ai, download the result onto the artifacts volume under
`studio/{user_id}/{uuid}.{ext}` (fal's result URLs expire), insert a
`media_assets` row (`source='studio'`), and return it.

Metering mirrors the article pipeline's hero-image call (see
`marketer.articles.pipeline`, stage `imaging`): a pre-flight
`SpendContext.ensure_can_spend` before the paid call, then `.log` right
after it succeeds — same ordering `openai_images.generate_keyframe` uses,
so a later local failure (e.g. the volume download) can't under-count the
ledger. `niche_id` is optional on every body: pass it to attribute the
spend to a niche (and get that niche's daily cap enforced too); omit it
and only the global daily cap + prepaid-credit checks apply, since a
Content Studio op isn't inherently tied to a niche the way a pipeline
job or article is.

Fail-closed: every endpoint checks `fal.StudioDisabled` first, before any
DB work or spend pre-flight, so a missing `MARKETER_FAL_API_KEY` always
503s immediately and cleanly.
"""

from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.config import settings
from marketer.models import MediaAsset
from marketer.repos import media as media_repo
from marketer.repos import niches as niches_repo
from marketer.repos.spend import SpendCapExceeded
from marketer.services import fal as fal_svc
from marketer.services.spend_context import SpendContext, default_context

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

_DEFAULT_EXT = {"image": ".png", "video": ".mp4", "audio": ".mp3"}


class TextToImageBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    model: str | None = None
    niche_id: UUID | None = None


class ImageEditBody(BaseModel):
    media_id: UUID | None = None
    image_url: str | None = None
    prompt: str = Field(min_length=1, max_length=4000)
    model: str | None = None
    niche_id: UUID | None = None


class SourceOnlyBody(BaseModel):
    media_id: UUID | None = None
    image_url: str | None = None
    model: str | None = None
    niche_id: UUID | None = None


class RemoveBgBody(BaseModel):
    media_id: UUID | None = None
    image_url: str | None = None
    niche_id: UUID | None = None


class VideoBody(BaseModel):
    media_id: UUID | None = None
    image_url: str | None = None
    prompt: str | None = None
    model: str | None = None
    niche_id: UUID | None = None


def _check_enabled() -> None:
    try:
        fal_svc.require_enabled()
    except fal_svc.StudioDisabled as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e


def _resolve_model(kind: str, model: str | None) -> str:
    try:
        return fal_svc.resolve_model(kind, model)
    except fal_svc.ModelNotAllowed as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e


async def _spend_context(ctx: AuthCtx, niche_id: UUID | None) -> SpendContext:
    cap_usd = None
    if niche_id is not None:
        niche = await niches_repo.get(niche_id, user_id=ctx.user_id)
        if niche is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")
        cap_usd = niche.daily_spend_cap_usd
    return await default_context(
        user_id=ctx.user_id, niche_id=niche_id, job_id=None, cap_usd=cap_usd,
    )


async def _resolve_source_url(
    ctx: AuthCtx, media_id: UUID | None, image_url: str | None
) -> str:
    if media_id is not None:
        asset = await media_repo.get(media_id, user_id=ctx.user_id)
        if asset is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="media not found")
        if asset.path and os.path.exists(asset.path):
            return fal_svc.to_data_uri(Path(asset.path))
        if asset.url:
            return asset.url
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="media asset has no file or url"
        )
    if image_url:
        return image_url
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY, detail="media_id or image_url is required"
    )


def _guess_ext(url: str, kind: str) -> str:
    suffix = Path(urlparse(url).path).suffix
    return suffix if suffix else _DEFAULT_EXT.get(kind, ".bin")


async def _charge_preflight(spend: SpendContext, cost: Decimal) -> None:
    try:
        await spend.ensure_can_spend(cost)
    except SpendCapExceeded as e:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail=str(e)) from e


async def _charge_log(spend: SpendContext, cost: Decimal, model_id: str) -> None:
    try:
        await spend.log(provider="fal", sku=model_id, units=Decimal(1), cost_usd=cost)
    except SpendCapExceeded as e:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail=str(e)) from e


async def _persist_result(
    ctx: AuthCtx,
    *,
    asset_url: str,
    kind: str,
    model_id: str,
    niche_id: UUID | None,
    meta: dict,
) -> MediaAsset:
    out_path = (
        Path(settings.artifacts_dir) / "studio" / ctx.user_id
        / f"{uuid4()}{_guess_ext(asset_url, kind)}"
    )
    try:
        await fal_svc.download(asset_url, out_path)
    except Exception as e:  # noqa: BLE001 — surface as a clean 502, not a stack trace
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=f"result download failed: {e}"
        ) from e
    return await media_repo.insert(
        user_id=ctx.user_id,
        niche_id=niche_id,
        kind=kind,
        source="studio",
        path=str(out_path),
        meta={"model": model_id, **meta},
    )


async def _run_sync_tool(
    ctx: AuthCtx,
    *,
    tool_kind: str,
    media_kind: str,
    model: str | None,
    niche_id: UUID | None,
    payload: dict,
    meta: dict,
) -> MediaAsset:
    model_id = _resolve_model(tool_kind, model)
    spend = await _spend_context(ctx, niche_id)
    cost = Decimal(str(settings.fal_image_cost_usd))
    await _charge_preflight(spend, cost)
    try:
        result = await fal_svc.run(model_id, payload)
    except fal_svc.StudioDisabled as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
    except fal_svc.FalError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
    await _charge_log(spend, cost, model_id)
    asset_url = fal_svc.extract_asset_url(result)
    return await _persist_result(
        ctx, asset_url=asset_url, kind=media_kind, model_id=model_id,
        niche_id=niche_id, meta=meta,
    )


@router.post("/image", response_model=MediaAsset, status_code=status.HTTP_201_CREATED)
async def text_to_image(body: TextToImageBody, ctx: AuthCtx = CurrentUser) -> MediaAsset:
    _check_enabled()
    return await _run_sync_tool(
        ctx, tool_kind="image", media_kind="image", model=body.model,
        niche_id=body.niche_id, payload={"prompt": body.prompt},
        meta={"prompt": body.prompt},
    )


@router.post("/image/edit", response_model=MediaAsset, status_code=status.HTTP_201_CREATED)
async def edit_image(body: ImageEditBody, ctx: AuthCtx = CurrentUser) -> MediaAsset:
    _check_enabled()
    source_url = await _resolve_source_url(ctx, body.media_id, body.image_url)
    return await _run_sync_tool(
        ctx, tool_kind="image_edit", media_kind="image", model=body.model,
        niche_id=body.niche_id,
        payload={"prompt": body.prompt, "image_url": source_url},
        meta={
            "prompt": body.prompt,
            "parent_media_id": str(body.media_id) if body.media_id else None,
        },
    )


@router.post("/upscale", response_model=MediaAsset, status_code=status.HTTP_201_CREATED)
async def upscale_image(body: SourceOnlyBody, ctx: AuthCtx = CurrentUser) -> MediaAsset:
    _check_enabled()
    source_url = await _resolve_source_url(ctx, body.media_id, body.image_url)
    return await _run_sync_tool(
        ctx, tool_kind="upscale", media_kind="image", model=body.model,
        niche_id=body.niche_id,
        payload={"image_url": source_url},
        meta={"parent_media_id": str(body.media_id) if body.media_id else None},
    )


@router.post("/remove-bg", response_model=MediaAsset, status_code=status.HTTP_201_CREATED)
async def remove_background(body: RemoveBgBody, ctx: AuthCtx = CurrentUser) -> MediaAsset:
    _check_enabled()
    source_url = await _resolve_source_url(ctx, body.media_id, body.image_url)
    return await _run_sync_tool(
        ctx, tool_kind="remove_bg", media_kind="image", model=None,
        niche_id=body.niche_id,
        payload={"image_url": source_url},
        meta={"parent_media_id": str(body.media_id) if body.media_id else None},
    )


@router.post("/video", response_model=MediaAsset, status_code=status.HTTP_201_CREATED)
async def image_to_video(body: VideoBody, ctx: AuthCtx = CurrentUser) -> MediaAsset:
    _check_enabled()
    source_url = await _resolve_source_url(ctx, body.media_id, body.image_url)
    model_id = _resolve_model("video", body.model)
    spend = await _spend_context(ctx, body.niche_id)
    cost = Decimal(str(settings.fal_video_cost_usd))
    await _charge_preflight(spend, cost)

    payload: dict = {"image_url": source_url}
    if body.prompt:
        payload["prompt"] = body.prompt

    try:
        result = await fal_svc.run_queued(model_id, payload)
    except fal_svc.StudioDisabled as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
    except fal_svc.FalError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
    await _charge_log(spend, cost, model_id)

    asset_url = fal_svc.extract_asset_url(result)
    return await _persist_result(
        ctx, asset_url=asset_url, kind="video", model_id=model_id,
        niche_id=body.niche_id,
        meta={
            "prompt": body.prompt,
            "parent_media_id": str(body.media_id) if body.media_id else None,
        },
    )
