"""Media uploads into the library (Team Storyboard-Uploads).

POST /api/v1/uploads accepts a multipart file, enforces a size cap
(`settings.upload_max_mb`) and an image/video/audio mime allowlist
(cross-checked against the file extension), streams it to
``{artifacts_dir}/uploads/{user_id}/{uuid}{ext}``, and inserts a
``media_assets`` row with ``source='upload'`` so it shows up in the
Content Studio library like any pipeline or studio asset.

Registered in main.py; this file is the owning team's implementation.
"""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from marketer.config import settings
from marketer.models import MediaAsset
from marketer.repos import media as media_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

# content-type prefix -> media_assets.kind
_KIND_BY_MIME_PREFIX: dict[str, str] = {
    "image/": "image",
    "video/": "video",
    "audio/": "audio",
}

# Extensions accepted per kind. Both the sniffed Content-Type *and* the
# filename extension must agree on a kind — a mismatch (e.g. a .txt file
# relabeled image/png) is rejected rather than trusted.
_ALLOWED_EXTENSIONS_BY_KIND: dict[str, set[str]] = {
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic"},
    "video": {".mp4", ".mov", ".webm", ".m4v"},
    "audio": {".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"},
}


class _UploadTooLarge(Exception):
    pass


def _classify(content_type: str, filename: str) -> str:
    """Return the media kind ('image'|'video'|'audio') for an upload, or
    raise HTTPException(415) if the sniffed content-type isn't in the
    allowlist or disagrees with the file's extension."""
    kind = None
    for prefix, k in _KIND_BY_MIME_PREFIX.items():
        if content_type.startswith(prefix):
            kind = k
            break
    if kind is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"unsupported content-type {content_type!r}; "
                "allowed: image/*, video/*, audio/*"
            ),
        )
    ext = Path(filename or "").suffix.lower()
    allowed = _ALLOWED_EXTENSIONS_BY_KIND[kind]
    if ext not in allowed:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"extension {ext!r} not allowed for {kind} uploads "
                f"(content-type {content_type!r}); allowed: {sorted(allowed)}"
            ),
        )
    return kind


async def _write_upload(file: UploadFile, dest: Path, *, max_bytes: int) -> int:
    """Stream the upload to disk in chunks, aborting the moment the
    configured size cap is exceeded. Uses plain synchronous `open()` /
    `write()` calls dispatched through FastAPI's threadpool
    (`run_in_threadpool`) rather than pulling in aiofiles as a new
    dependency. Raises `_UploadTooLarge` (caller cleans up the partial
    file and maps it to a 413) if the cap is exceeded."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    chunk_size = 1024 * 1024
    total = 0
    fh = await run_in_threadpool(open, dest, "wb")
    try:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise _UploadTooLarge()
            await run_in_threadpool(fh.write, chunk)
    finally:
        await run_in_threadpool(fh.close)
    return total


@router.post("", response_model=MediaAsset, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    ctx: AuthCtx = CurrentUser,
) -> MediaAsset:
    content_type = (file.content_type or "").lower()
    kind = _classify(content_type, file.filename or "")

    max_bytes = settings.upload_max_mb * 1024 * 1024
    # Fast-path reject when the client (or Starlette's multipart parser)
    # already knows the size — avoids writing an oversized file to disk
    # at all in the common case.
    if file.size is not None and file.size > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"file is {file.size} bytes; max upload size is "
                f"{settings.upload_max_mb} MB"
            ),
        )

    ext = Path(file.filename or "").suffix.lower()
    dest = Path(settings.artifacts_dir) / "uploads" / ctx.user_id / f"{uuid4()}{ext}"

    try:
        total_bytes = await _write_upload(file, dest, max_bytes=max_bytes)
    except _UploadTooLarge:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"file exceeds max upload size of {settings.upload_max_mb} MB",
        ) from None

    return await media_repo.insert(
        user_id=ctx.user_id,
        kind=kind,
        source="upload",
        path=str(dest),
        mime=content_type,
        meta={"original_filename": file.filename, "size_bytes": total_bytes},
    )
