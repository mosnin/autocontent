"""Media library: browse produced assets, play them, remix clips.

- GET  /api/v1/library                     — list assets (kind/niche/job filters)
- GET  /api/v1/library/compositions        — list remixes
- POST /api/v1/library/compositions        — create a remix from clip ids (spawns render)
- GET  /api/v1/library/compositions/{id}   — remix status
- GET  /api/v1/library/{asset_id}/media    — playback: presigned redirect (wasabi)
                                             or streamed file (volume)

Everything is user-scoped through the auth context; asset lookups that
miss (or belong to someone else) 404.
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

from marketer.models import Composition, MediaAsset
from marketer.repos import media as media_repo
from marketer.services import object_storage

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

MAX_COMPOSITION_CLIPS = 40


@router.get("", response_model=list[MediaAsset])
async def list_assets(
    kind: Literal["clip", "keyframe", "voiceover", "final", "composition"] | None = None,
    niche_id: UUID | None = None,
    job_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
    ctx: AuthCtx = CurrentUser,
) -> list[MediaAsset]:
    return await media_repo.list_assets(
        user_id=ctx.user_id,
        kind=kind,
        niche_id=niche_id,
        job_id=job_id,
        limit=min(max(limit, 1), 200),
        offset=max(offset, 0),
    )


class CompositionCreate(BaseModel):
    clip_asset_ids: list[UUID] = Field(min_length=1, max_length=MAX_COMPOSITION_CLIPS)
    title: str = ""
    audio_mode: Literal["keep", "mute"] = "keep"


@router.get("/compositions", response_model=list[Composition])
async def list_compositions(
    limit: int = 50, offset: int = 0, ctx: AuthCtx = CurrentUser
) -> list[Composition]:
    return await media_repo.list_compositions(
        user_id=ctx.user_id, limit=min(max(limit, 1), 200), offset=max(offset, 0)
    )


@router.post(
    "/compositions",
    response_model=Composition,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_composition(
    body: CompositionCreate, ctx: AuthCtx = CurrentUser
) -> Composition:
    """Validate the clips, persist the composition, spawn the render."""
    assets = await media_repo.get_assets_bulk(body.clip_asset_ids, user_id=ctx.user_id)
    by_id = {a.id: a for a in assets}
    missing = [str(i) for i in body.clip_asset_ids if i not in by_id]
    if missing:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"clips not found: {', '.join(missing)}"
        )
    bad_kind = [
        str(a.id) for a in assets if a.kind not in ("clip", "final", "composition")
    ]
    if bad_kind:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"not video assets: {', '.join(bad_kind)}",
        )

    comp = await media_repo.create_composition(
        user_id=ctx.user_id,
        clip_asset_ids=body.clip_asset_ids,
        title=body.title.strip(),
        audio_mode=body.audio_mode,
    )

    import modal

    try:
        fn = modal.Function.from_name("marketer-sh", "render_composition")
        fn.spawn(ctx.user_id, str(comp.id))
    except Exception as e:  # noqa: BLE001 — a row stuck 'queued' forever is worse
        await media_repo.set_composition_status(
            comp.id, user_id=ctx.user_id, status="failed",
            error=f"spawn failed: {e}",
        )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="failed to start render"
        )
    return comp


@router.get("/compositions/{composition_id}", response_model=Composition)
async def get_composition(
    composition_id: UUID, ctx: AuthCtx = CurrentUser
) -> Composition:
    comp = await media_repo.get_composition(composition_id, user_id=ctx.user_id)
    if comp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return comp


@router.get("/{asset_id}/media")
async def get_asset_media(asset_id: UUID, ctx: AuthCtx = CurrentUser):
    """Playback/download for one asset.

    Wasabi-stored assets redirect to a short-lived presigned URL (the
    bytes stream straight from object storage, not through the API).
    Volume-stored assets stream from the artifacts volume."""
    asset = await media_repo.get_asset(asset_id, user_id=ctx.user_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    if asset.storage == "wasabi":
        try:
            url = await object_storage.presigned_get_url(asset.object_key)
        except object_storage.ObjectStorageDisabled:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="asset is in object storage but wasabi is not configured",
            )
        return RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    from pathlib import Path

    path = Path(asset.object_key)
    if not path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="asset file no longer on the volume (retention GC)",
        )
    return FileResponse(path, media_type=asset.content_type)
