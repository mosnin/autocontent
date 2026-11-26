"""Short video: topic or script → finished videos, in variants (docs/short-video.md).

- GET  /short-videos/options                 defaults, voices, configured sources, limits
- POST /short-videos/estimate                cost estimate (no side effects)
- GET  /short-videos                         recent batches with their items
- POST /short-videos                         create a batch (202); large batches wait for approval
- GET  /short-videos/{batch_id}              one batch
- POST /short-videos/{batch_id}/approve      a person starts a large batch (rails, HIGH)
- POST /short-videos/{batch_id}/cancel       stop what hasn't run
- POST /short-videos/items/{item_id}/retry   re-run a failed variant (new attempt)
- GET  /short-videos/items/{item_id}/video   the mp4
- GET  /short-videos/items/{item_id}/subtitles?format=srt|vtt
- GET  /short-videos/uploads                 the workspace's ready uploads
- POST /short-videos/uploads                 start an upload: a presigned PUT
- POST /short-videos/uploads/{upload_id}/complete   check the stored file
- GET  /short-videos/footage/search          free stock search preview, with attribution
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer import rails
from marketer.config import settings
from marketer.rails.http import rails_request_context, to_http
from marketer.repos import short_videos as repo
from marketer.short_video import pricing, stock, uploads
from marketer.short_video.metering import micros_to_usd
from marketer.short_video.models import (
    APPROVAL_VARIANTS,
    MAX_VARIANTS,
    OPENAI_VOICES,
    ShortVideoBatch,
    ShortVideoRequest,
    ShortVideoSettings,
    StockClip,
    Upload,
)

from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

log = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(rails_request_context)])

APPROVE_ACTION = "content.short_video.batch.approve"


def _settings_hash(s: ShortVideoSettings) -> str:
    return hashlib.sha256(json.dumps(s.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()


def batch_args(*, source: str, topic: str, script: str, variants: int, estimate_micros: int,
               cap_micros: int, settings_hash: str, niche_id: UUID | None) -> dict:
    """What a person approves: the exact request and its money, as canonical args."""
    return {
        "source": source,
        "topic": topic,
        "script_sha256": hashlib.sha256(script.encode()).hexdigest(),
        "variants": variants,
        "estimate_micros": estimate_micros,
        "cap_micros": cap_micros,
        "settings_sha256": settings_hash,
        "niche_id": str(niche_id) if niche_id else None,
    }


def _batch_args_from_row(b: ShortVideoBatch) -> dict:
    return batch_args(source=b.source, topic=b.topic, script=b.script, variants=b.variants,
                      estimate_micros=b.estimate_micros, cap_micros=b.cap_micros,
                      settings_hash=_settings_hash(b.settings), niche_id=b.niche_id)


def _spawn(user_id: str, batch_id: UUID) -> None:
    import modal

    fn = modal.Function.from_name("marketer-sh", "run_short_video")
    fn.spawn(user_id, str(batch_id))


# ------------------------------------------------------------------ options

class EstimateOut(BaseModel):
    per_variant_usd: str
    total_usd: str
    cap_usd: str
    needs_approval: bool
    lines: dict[str, str]


@router.get("/options")
async def options(ctx: AuthCtx = CurrentUser) -> dict:
    from marketer.services import elevenlabs_tts, music_gen, object_storage

    return {
        "defaults": ShortVideoSettings().model_dump(mode="json"),
        "voices": {
            "openai": list(OPENAI_VOICES),
            "elevenlabs": [settings.elevenlabs_default_voice_id] if elevenlabs_tts.enabled() else [],
        },
        "footage_sources": stock.configured_sources() + (["uploads"] if object_storage.enabled() else []),
        "music_modes": ["none", "library"] + (["generated"] if music_gen.enabled() else []),
        "limits": {
            "max_variants": MAX_VARIANTS,
            "approval_variants": APPROVAL_VARIANTS,
            "upload_types": sorted(uploads.ALLOWED),
        },
    }


def _estimate_out(req: ShortVideoRequest) -> tuple[pricing.Estimate, EstimateOut]:
    est = pricing.estimate(req)
    return est, EstimateOut(
        per_variant_usd=str(micros_to_usd(est.per_variant_micros)),
        total_usd=str(micros_to_usd(est.total_micros)),
        cap_usd=str(micros_to_usd(est.cap_micros)),
        needs_approval=est.needs_approval,
        lines={k: str(micros_to_usd(v)) for k, v in est.lines.items()},
    )


@router.post("/estimate", response_model=EstimateOut)
async def estimate(body: ShortVideoRequest, ctx: AuthCtx = CurrentUser) -> EstimateOut:
    return _estimate_out(body)[1]


# ------------------------------------------------------------------ batches

@router.get("", response_model=list[ShortVideoBatch])
async def list_batches(limit: int = Query(default=20, ge=1, le=100), ctx: AuthCtx = CurrentUser) -> list[ShortVideoBatch]:
    return await repo.list_batches(user_id=ctx.user_id, limit=limit)


_SPAWN_LIMIT = user_rate_limit("short_videos.spawn", "20/minute")


@router.post("", response_model=ShortVideoBatch, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def create_batch(body: ShortVideoRequest, ctx: AuthCtx = CurrentUser) -> ShortVideoBatch:
    if body.niche_id is not None:
        from marketer.repos import niches as niches_repo

        if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="playbook not found")
    footage = body.settings.footage
    if "uploads" in footage.sources and footage.upload_ids:
        found = await repo.get_uploads_bulk(list(footage.upload_ids), user_id=ctx.user_id)
        ready = {u.id for u in found if u.status == "ready"}
        missing = [str(i) for i in footage.upload_ids if i not in ready]
        if missing:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="some uploads aren't ready or don't exist")
    stock_wanted = [s for s in footage.sources if s in ("pexels", "pixabay")]
    if stock_wanted and not (set(stock_wanted) & set(stock.configured_sources())) and not footage.upload_ids:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="no stock footage source is configured; add uploads")

    est, _ = _estimate_out(body)
    args = batch_args(source=body.source, topic=body.topic, script=body.script, variants=body.variants,
                      estimate_micros=est.total_micros, cap_micros=est.cap_micros,
                      settings_hash=_settings_hash(body.settings), niche_id=body.niche_id)
    batch = await repo.create_batch(
        user_id=ctx.user_id, niche_id=body.niche_id, created_by=ctx.actor_id or ctx.user_id,
        principal=rails.principal_of(ctx) if ctx.actor_type != "token" else "token",
        title=body.title or (body.topic if body.source == "topic" else body.script[:80]),
        source=body.source, topic=body.topic, script=body.script,
        settings=body.settings.model_dump(mode="json"), variants=body.variants,
        status="awaiting_approval" if est.needs_approval else "queued",
        estimate_micros=est.total_micros, cap_micros=est.cap_micros,
        args_hash=rails.args_hash(APPROVE_ACTION, args),
    )
    if batch.status == "queued":
        try:
            _spawn(ctx.user_id, batch.id)
        except Exception as e:  # noqa: BLE001 - a batch stuck 'queued' forever is worse
            log.warning("short video spawn failed", exc_info=True)
            await repo.transition_batch(batch.id, user_id=ctx.user_id, from_status=("queued",), to_status="failed",
                                        error=f"could not start the render ({type(e).__name__})")
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="failed to start the render")
    return batch


@router.post("/{batch_id}/approve", response_model=ShortVideoBatch, status_code=status.HTTP_202_ACCEPTED)
async def approve_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> ShortVideoBatch:
    """A person's yes to a large batch, bound to its exact arguments."""
    if ctx.delegated or ctx.actor_type != "user":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="a person approves large batches")
    b = await repo.get_batch(batch_id, user_id=ctx.user_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    args = {**_batch_args_from_row(b), "batch_id": str(b.id)}
    try:
        dispatch = await rails.enforce_dispatch(
            APPROVE_ACTION, user_id=ctx.user_id, principal=rails.principal_of(ctx), actor_email=ctx.email,
            args=args, target_type="short_video_batch", target_id=str(b.id),
        )
    except rails.RailsDenied as e:
        raise to_http(e) from e
    if rails.args_hash(APPROVE_ACTION, _batch_args_from_row(b)) != b.args_hash:
        await dispatch.failed("batch changed since it was requested")
        raise HTTPException(status.HTTP_409_CONFLICT, detail="approval_args_mismatch: the batch changed; make it again")
    if not await repo.transition_batch(b.id, user_id=ctx.user_id, from_status=("awaiting_approval",),
                                       to_status="queued", approved_by=ctx.actor_id or ctx.email):
        await dispatch.failed(f"batch is {b.status}")
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"batch is {b.status}, not awaiting approval")

    async def _go() -> None:
        _spawn(ctx.user_id, b.id)

    try:
        await dispatch.run(_go)
    except rails.OutcomeUnknown as e:
        raise to_http(e) from e
    return await repo.get_batch(b.id, user_id=ctx.user_id) or b


@router.post("/{batch_id}/cancel", response_model=ShortVideoBatch)
async def cancel_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> ShortVideoBatch:
    b = await repo.get_batch(batch_id, user_id=ctx.user_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    moved = await repo.transition_batch(b.id, user_id=ctx.user_id,
                                        from_status=("awaiting_approval", "queued", "running"), to_status="cancelled")
    if not moved:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"batch is {b.status}")
    await repo.cancel_items(b.id, user_id=ctx.user_id)
    return await repo.get_batch(b.id, user_id=ctx.user_id) or b


@router.post("/items/{item_id}/retry", status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def retry_item(item_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    item = await repo.reset_item_for_retry(item_id, user_id=ctx.user_id)
    if item is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="variant not found or not failed")
    _spawn(ctx.user_id, item.batch_id)
    return {"status": "queued", "item_id": str(item.id), "attempt": item.attempt}


async def _own_file(item_id: UUID, ctx: AuthCtx, field: str) -> Path:
    item = await repo.get_item(item_id, user_id=ctx.user_id)
    path = getattr(item, field, None) if item else None
    if not path or not os.path.exists(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Path(path)


@router.get("/items/{item_id}/video")
async def item_video(item_id: UUID, ctx: AuthCtx = CurrentUser) -> FileResponse:
    return FileResponse(await _own_file(item_id, ctx, "video_path"), media_type="video/mp4")


@router.get("/items/{item_id}/subtitles")
async def item_subtitles(item_id: UUID, format: Literal["srt", "vtt"] = "srt", ctx: AuthCtx = CurrentUser) -> FileResponse:
    path = await _own_file(item_id, ctx, f"{format}_path")
    media = "application/x-subrip" if format == "srt" else "text/vtt"
    return FileResponse(path, media_type=media, filename=f"short-video-{item_id}.{format}")


# ------------------------------------------------------------------ uploads

class UploadStart(BaseModel):
    filename: str = Field(default="", max_length=200)
    content_type: str = Field(max_length=80)
    size_bytes: int = Field(gt=0)


class UploadStarted(BaseModel):
    upload: Upload
    put_url: str
    headers: dict[str, str]


@router.get("/uploads", response_model=list[Upload])
async def list_uploads(ctx: AuthCtx = CurrentUser) -> list[Upload]:
    return await repo.list_uploads(user_id=ctx.user_id)


@router.post("/uploads", response_model=UploadStarted, status_code=status.HTTP_201_CREATED,
             dependencies=[user_rate_limit("short_videos.upload", "60/minute")])
async def start_upload(body: UploadStart, ctx: AuthCtx = CurrentUser) -> UploadStarted:
    from marketer.services import object_storage

    ct = body.content_type.split(";")[0].strip().lower()
    try:
        kind = uploads.validate_declared(ct, body.size_bytes)
    except uploads.UploadRejected as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    if not object_storage.enabled():
        raise HTTPException(status.HTTP_409_CONFLICT, detail="uploads need object storage, which isn't set up")
    upload_id = uuid4()
    key = uploads.object_key(ctx.user_id, upload_id, ct)
    url = await uploads.presigned_put(key, ct)
    row = await repo.create_upload(upload_id=upload_id, user_id=ctx.user_id, kind=kind,
                                   filename=uploads.safe_filename(body.filename), content_type=ct,
                                   size_bytes=body.size_bytes, object_key=key)
    return UploadStarted(upload=row, put_url=url, headers={"Content-Type": ct})


@router.post("/uploads/{upload_id}/complete", response_model=Upload)
async def complete_upload(upload_id: UUID, ctx: AuthCtx = CurrentUser) -> Upload:
    from marketer.services import object_storage

    up = await repo.get_upload(upload_id, user_id=ctx.user_id)
    if up is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if up.status != "pending":
        return up
    workdir = Path(settings.artifacts_dir) / ctx.user_id / "short-video" / "uploads-check"
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        probe = await uploads.verify_stored(key=up.object_key, kind=up.kind, content_type=up.content_type,
                                            declared_size=up.size_bytes, workdir=workdir)
    except uploads.UploadRejected as e:
        try:
            await object_storage.delete_object(up.object_key)
        except Exception:  # noqa: BLE001 - the row says rejected either way
            log.warning("could not delete a rejected upload", exc_info=True)
        settled = await repo.settle_upload(up.id, user_id=ctx.user_id, status="rejected", error=str(e))
        return settled or up
    settled = await repo.settle_upload(up.id, user_id=ctx.user_id, status="ready", width=probe.width,
                                       height=probe.height, duration_sec=probe.duration_sec)
    return settled or up


# ------------------------------------------------------------------ footage

@router.get("/footage/search", response_model=list[StockClip],
            dependencies=[user_rate_limit("short_videos.footage", "30/minute")])
async def footage_search(
    q: str = Query(min_length=2, max_length=60),
    aspect: Literal["9:16", "16:9", "1:1"] = "9:16",
    ctx: AuthCtx = CurrentUser,
) -> list[StockClip]:
    from marketer.short_video.keywords import clean_term

    term = clean_term(q)
    if not term:
        return []
    clips = await stock.search([(0, term)], sources=stock.configured_sources(), aspect=aspect,
                               cache=repo.PgSearchCache(), per_term=12)
    # The browser never needs the download URL.
    return [c.model_copy(update={"download_url": ""}) for c in clips]


# Registered last so the literal paths above (/uploads, /options) win.
@router.get("/{batch_id}", response_model=ShortVideoBatch)
async def get_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> ShortVideoBatch:
    b = await repo.get_batch(batch_id, user_id=ctx.user_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return b
