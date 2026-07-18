"""Media library — durable, browsable record of every rendered asset.

One row per finished pipeline render (source='pipeline', inserted by
`marketer.pipeline`) or Content Studio edit (source='studio', inserted by
`backend.routes.studio`). Every endpoint here is ownership-scoped the
same way every other resource in this API is — `ctx.user_id` must match
the row, otherwise 404 (not 403 — we don't reveal whether a foreign id
exists).
"""

from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse, RedirectResponse

from marketer.models import MediaAsset, MediaAssetPage
from marketer.repos import media as media_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

_ALLOWED_KINDS = {"image", "video", "audio"}
_ALLOWED_SOURCES = {"pipeline", "studio", "upload"}
_DEFAULT_MIME = {"image": "image/png", "video": "video/mp4", "audio": "audio/mpeg"}


@router.get("", response_model=MediaAssetPage)
async def list_media(
    ctx: AuthCtx = CurrentUser,
    kind: str | None = None,
    source: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: UUID | None = None,
) -> MediaAssetPage:
    if kind is not None and kind not in _ALLOWED_KINDS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"invalid kind {kind!r}"
        )
    if source is not None and source not in _ALLOWED_SOURCES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"invalid source {source!r}"
        )
    items = await media_repo.list_for_user(
        ctx.user_id, kind=kind, source=source, limit=limit, cursor=cursor
    )
    # A full page might mean there's more — hand back the last id as the
    # next page's cursor. A short page is unambiguously the end.
    next_cursor = items[-1].id if len(items) == limit else None
    return MediaAssetPage(items=items, next_cursor=next_cursor)


@router.get("/{media_id}", response_model=MediaAsset)
async def get_media(media_id: UUID, ctx: AuthCtx = CurrentUser) -> MediaAsset:
    asset = await media_repo.get(media_id, user_id=ctx.user_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return asset


@router.get("/{media_id}/file", response_model=None)
async def get_media_file(
    media_id: UUID, ctx: AuthCtx = CurrentUser
) -> FileResponse | RedirectResponse:
    """Stream the asset's bytes when it lives on the artifacts volume;
    307-redirect to the remote URL when it only lives there (no local
    `path`). 404 if neither is set or the local file is missing."""
    asset = await media_repo.get(media_id, user_id=ctx.user_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if asset.path:
        if not os.path.exists(asset.path):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "file missing")
        media_type = asset.mime or _DEFAULT_MIME.get(asset.kind, "application/octet-stream")
        return FileResponse(asset.path, media_type=media_type)
    if asset.url:
        return RedirectResponse(asset.url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    raise HTTPException(status.HTTP_404_NOT_FOUND, "no file or url on this asset")


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(media_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    """Soft-delete: hides the row from listings but leaves the file on
    the volume for retention GC — deleting from the library is a
    visibility action, not a storage-reclaim action."""
    ok = await media_repo.soft_delete(media_id, user_id=ctx.user_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
