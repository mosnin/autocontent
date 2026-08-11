"""Headshot / Portrait Studio: upload a face, pick a look, get a batch.

- GET    /api/v1/headshots/styles                              the catalog
- POST   /api/v1/headshots/sources                             upload a photo
- GET    /api/v1/headshots/sources/{id}/image                  stream one upload
- POST   /api/v1/headshots                                     enqueue a batch
- GET    /api/v1/headshots                                     list batches
- GET    /api/v1/headshots/{id}                                batch + variants
- GET    /api/v1/headshots/{id}/variants/{vid}/image           stream a portrait
- POST   /api/v1/headshots/{id}/retry                          re-run the gaps
- DELETE /api/v1/headshots/{id}                                row + files

Every route is user-scoped, and that is load-bearing here rather than
routine: these rows point at photographs of a real, identifiable person,
so a caller holding someone else's id gets a 404, never a row and never a
file. Uploads are validated on type, size, and actual magic bytes before
anything is written to the volume.

The lane fails closed: with no image key configured the write endpoints
answer 409 ("not configured") instead of accepting work they can never
do. The style catalog is pure data and stays readable either way, so the
picker can render while an operator sets the key.
"""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.headshots import list_styles
from marketer.headshots.prompts import MAX_SUBJECT_NOTES_CHARS
from marketer.headshots.pipeline import (
    MAX_SOURCE_BYTES,
    MAX_SOURCE_IMAGES,
    SourceRejected,
    delete_batch_files,
    delete_files,
    is_configured,
    store_source,
)
from marketer.headshots.styles import UnknownStyleError, get_style
from marketer.repos import headshots as repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

MODAL_APP = "marketer-sh"
RUN_FUNCTION = "run_headshot_batch"

# Client filenames are shown in the picker and never used to build a path;
# bounded so a pathological name can't bloat every batch payload.
MAX_FILENAME_CHARS = 120


def _require_configured() -> None:
    if not is_configured():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "headshot studio is not configured on this deployment (no image key)",
        )


def _spawn(user_id: str, batch_id: UUID) -> None:
    import modal

    fn = modal.Function.from_name(MODAL_APP, RUN_FUNCTION)
    fn.spawn(user_id, str(batch_id))


def _variant_view(variant: dict) -> dict:
    return {
        "id": str(variant["id"]),
        "variant_index": variant["variant_index"],
        "status": variant["status"],
        "error": variant.get("error"),
        "has_image": bool(variant.get("image_path")),
    }


class HeadshotBatchCreate(BaseModel):
    style_key: str = Field(min_length=1, max_length=64)
    source_image_ids: list[UUID] = Field(default_factory=list)
    # Bounds match the DB's own check constraint on headshot_batches.
    variant_count: int = Field(default=4, ge=1, le=12)
    subject_notes: str = Field(default="", max_length=MAX_SUBJECT_NOTES_CHARS)
    niche_id: UUID | None = None


# ── catalog ───────────────────────────────────────────────────────────────
#
# Declared before /{batch_id} so the literal paths win the match.


@router.get("/styles")
async def get_styles(ctx: AuthCtx = CurrentUser) -> dict:
    """The style catalog, including the exact prompt language each style
    contributes — art direction the user can't read is art direction the
    user can't debug."""
    return {"styles": list_styles()}


# ── sources ───────────────────────────────────────────────────────────────


@router.post("/sources", status_code=status.HTTP_201_CREATED)
async def upload_source(
    file: UploadFile = File(...), ctx: AuthCtx = CurrentUser
) -> dict:
    """Store one reference photograph under the caller's volume partition.

    Read is bounded at one byte past the limit so an oversized upload is
    refused without ever holding the whole thing.
    """
    _require_configured()
    data = await file.read(MAX_SOURCE_BYTES + 1)
    try:
        path, content_type = store_source(
            ctx.user_id, data, declared_type=(file.content_type or "").split(";")[0].strip()
        )
    except SourceRejected as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    row = await repo.create_source(
        user_id=ctx.user_id,
        path=str(path),
        content_type=content_type,
        size_bytes=len(data),
        filename=(file.filename or "")[:MAX_FILENAME_CHARS],
    )
    return {
        "id": str(row["id"]),
        "url": f"/api/v1/headshots/sources/{row['id']}/image",
    }


@router.get("/sources/{source_id}/image")
async def get_source_image(source_id: UUID, ctx: AuthCtx = CurrentUser) -> FileResponse:
    """Stream one uploaded photo back for the picker's thumbnail."""
    source = await repo.get_source(source_id, user_id=ctx.user_id)
    if source is None or not os.path.exists(source["path"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return FileResponse(source["path"], media_type=source["content_type"])


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(source_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    """Remove one uploaded photo and its bytes. Batches that already
    rendered from it keep their portraits."""
    path = await repo.delete_source(source_id, user_id=ctx.user_id)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    delete_files([path])


# ── batches ───────────────────────────────────────────────────────────────


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_batch(body: HeadshotBatchCreate, ctx: AuthCtx = CurrentUser) -> dict:
    """Create the batch (plus its N queued variant rows) and spawn the
    render. Poll GET /{id} for per-variant status.

    Everything the user could have got wrong is answered here, before a
    row exists and before any spend.
    """
    _require_configured()
    try:
        get_style(body.style_key)
    except UnknownStyleError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if not body.source_image_ids:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="upload at least one photo of the subject first",
        )
    if len(body.source_image_ids) > MAX_SOURCE_IMAGES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"at most {MAX_SOURCE_IMAGES} reference photos per batch",
        )
    sources = await repo.get_sources(body.source_image_ids, user_id=ctx.user_id)
    if len(sources) != len(body.source_image_ids):
        # Includes another user's source id: a miss and a foreign row are
        # deliberately indistinguishable from out here.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="source photo not found")

    if body.niche_id is not None:
        from marketer.repos import niches as niches_repo

        if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    batch = await repo.create_batch(
        user_id=ctx.user_id,
        style_key=body.style_key,
        source_image_ids=body.source_image_ids,
        variant_count=body.variant_count,
        subject_notes=body.subject_notes.strip(),
        niche_id=body.niche_id,
    )
    _spawn(ctx.user_id, batch["id"])
    return batch


@router.get("")
async def list_batches(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: AuthCtx = CurrentUser,
) -> list[dict]:
    return await repo.list_batches(ctx.user_id, status=status_filter, limit=limit)


@router.get("/{batch_id}")
async def get_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    batch = await repo.get_batch(batch_id, user_id=ctx.user_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    variants = await repo.list_variants(batch_id, user_id=ctx.user_id)
    return {"batch": batch, "variants": [_variant_view(v) for v in variants]}


@router.get("/{batch_id}/variants/{variant_id}/image")
async def get_variant_image(
    batch_id: UUID, variant_id: UUID, ctx: AuthCtx = CurrentUser
) -> FileResponse:
    """Stream one rendered portrait. 404 when the variant is
    missing/foreign, hasn't rendered, or the file is off the volume."""
    variant = await repo.get_variant(variant_id, batch_id=batch_id, user_id=ctx.user_id)
    if variant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    path = variant.get("image_path")
    if not path or not os.path.exists(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no rendered portrait")
    return FileResponse(path, media_type="image/png")


@router.post("/{batch_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Re-render only the variants that have nothing to show.

    The failed/partial -> queued claim is atomic, so a double-clicked
    retry spawns exactly one run and already-delivered portraits are never
    billed twice.
    """
    _require_configured()
    claimed = await repo.claim_for_retry(batch_id, user_id=ctx.user_id)
    if claimed is None:
        existing = await repo.get_batch(batch_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"batch is {existing['status']}, not failed or partial",
        )
    _spawn(ctx.user_id, batch_id)
    return claimed


@router.delete("/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    """Delete the batch, its variants, and the portraits on disk.

    Ownership is resolved with a read first: `delete_batch` returns an
    empty path list both for a foreign batch and for an owned batch that
    never rendered anything, and those two must not share a status code.
    """
    if await repo.get_batch(batch_id, user_id=ctx.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    paths = await repo.delete_batch(batch_id, user_id=ctx.user_id)
    await delete_batch_files(ctx.user_id, batch_id, paths)
