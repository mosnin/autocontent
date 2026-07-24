"""Studio: server-side generation for every Studio surface.

- GET    /api/v1/studio/models              — models we can actually run
- POST   /api/v1/studio/generations         — submit (spawns the Modal run)
- GET    /api/v1/studio/generations         — history page (keyset cursor)
- GET    /api/v1/studio/generations/{id}    — poll one generation
- DELETE /api/v1/studio/generations/{id}    — remove from history
- POST   /api/v1/studio/uploads             — store a reference image/video

The browser never holds a provider key and never calls a generation
vendor: it submits here, we gate on spend fail-closed at submit time, and
the worker drives the row to a terminal state. Everything is user-scoped
through the auth context; a generation that isn't yours 404s.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from marketer.models import StudioGeneration, StudioKind
from marketer.repos import studio as studio_repo
from marketer.services import object_storage, studio_gen

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

# Reference uploads are inputs to a generation, not library media: a still
# or a short clip. Anything larger is a sign the caller meant the library.
MAX_UPLOAD_BYTES = 64 * 1024 * 1024
UPLOAD_CHUNK = 1024 * 1024
ALLOWED_UPLOAD_TYPES = (
    "image/png", "image/jpeg", "image/webp", "image/gif",
    "video/mp4", "video/quicktime", "video/webm",
    "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/webm",
)


class StudioModelOut(BaseModel):
    """A model the server can actually run, as the picker sees it.

    `catalog_id` is the id of the matching entry in the UI model catalog —
    the UI reads that entry's `inputs` schema to build its controls. Null
    means we have no catalog schema for this model and the UI falls back to
    its generic controls for the kind.
    """

    id: str
    name: str
    kind: StudioKind
    catalog_id: str | None = None
    provider: str
    output_kind: str
    unit: str
    usd_per_unit: Decimal
    required_params: list[str] = Field(default_factory=list)
    allowed_durations: list[int] = Field(default_factory=list)
    default_duration_sec: int
    max_duration_sec: int
    duration_from_input: bool


class GenerationCreate(BaseModel):
    kind: StudioKind
    model: str
    params: dict = Field(default_factory=dict)


class GenerationPage(BaseModel):
    items: list[StudioGeneration]
    next_cursor: str | None = None


class UploadOut(BaseModel):
    url: str
    key: str
    content_type: str
    bytes: int


def _http_error(exc: Exception) -> HTTPException:
    """Map a typed generation error onto the status the UI acts on.

    Ordering matters: SpendCapExceeded is checked first so a refusal reads
    as 402 (top up / raise the cap) rather than a generic 422.
    """
    from marketer.repos.spend import SpendCapExceeded

    if isinstance(exc, SpendCapExceeded):
        return HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc))
    if isinstance(exc, studio_gen.UnknownStudioModel):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    if isinstance(exc, studio_gen.ProviderNotConfigured):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    if isinstance(
        exc,
        (
            studio_gen.UnsupportedModelClass,
            studio_gen.InvalidStudioParams,
            studio_gen.UnsafeInputURL,
        ),
    ):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    raise exc


@router.get("/models", response_model=list[StudioModelOut])
async def list_models(
    kind: StudioKind | None = None, ctx: AuthCtx = CurrentUser
) -> list[StudioModelOut]:
    """Every model with a configured provider path, optionally by kind.

    Models whose provider key is unset are omitted rather than shown
    broken — the picker only ever offers what will run.
    """
    models = studio_gen.models_for_kind(kind) if kind else studio_gen.catalog()
    return [
        StudioModelOut(
            id=m.id,
            name=m.name,
            kind=m.kind,
            catalog_id=m.catalog_id or None,
            provider=m.provider,
            output_kind=m.output_kind,
            unit=m.unit,
            usd_per_unit=m.usd_per_unit,
            required_params=list(m.required_params),
            allowed_durations=list(m.allowed_durations),
            default_duration_sec=m.default_duration_sec,
            max_duration_sec=m.max_duration_sec,
            duration_from_input=m.duration_from_input,
        )
        for m in models
        if studio_gen.provider_enabled(m)
    ]


@router.post(
    "/generations",
    response_model=StudioGeneration,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_generation(
    body: GenerationCreate, ctx: AuthCtx = CurrentUser
) -> StudioGeneration:
    """Validate, gate on spend, persist, and spawn the worker run."""
    try:
        generation = await studio_gen.create_generation(
            user_id=ctx.user_id, kind=body.kind, model_id=body.model,
            params=body.params,
        )
    except Exception as exc:  # noqa: BLE001 — re-raised untyped by _http_error
        raise _http_error(exc) from exc

    import modal

    try:
        fn = modal.Function.from_name("marketer-sh", "run_studio_generation")
        fn.spawn(ctx.user_id, str(generation.id))
    except Exception as exc:  # noqa: BLE001 — a row stuck 'queued' is worse
        await studio_repo.fail(
            generation.id, user_id=ctx.user_id,
            error=f"spawn failed: {exc}", cost_usd=Decimal("0"),
        )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="failed to start generation"
        ) from exc
    return generation


@router.get("/generations", response_model=GenerationPage)
async def list_generations(
    kind: StudioKind | None = None,
    limit: int = 30,
    cursor: str | None = None,
    ctx: AuthCtx = CurrentUser,
) -> GenerationPage:
    try:
        items, next_cursor = await studio_repo.list_for_user(
            user_id=ctx.user_id, kind=kind, limit=min(max(limit, 1), 100),
            cursor=cursor,
        )
    except studio_repo.InvalidCursor as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid cursor"
        ) from exc
    return GenerationPage(items=items, next_cursor=next_cursor)


@router.get("/generations/{generation_id}", response_model=StudioGeneration)
async def get_generation(
    generation_id: UUID, ctx: AuthCtx = CurrentUser
) -> StudioGeneration:
    generation = await studio_repo.get(generation_id, user_id=ctx.user_id)
    if generation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return generation


@router.delete("/generations/{generation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_generation(generation_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    if not await studio_repo.delete(generation_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.post("/uploads", response_model=UploadOut)
async def create_upload(
    file: UploadFile = File(...), ctx: AuthCtx = CurrentUser
) -> UploadOut:
    """Store a reference image/video/audio and hand back a URL the
    generation endpoints will accept.

    The URL is presigned and short-lived, and the key is namespaced under
    the caller — one user's uploads are never addressable by another.
    """
    if not object_storage.enabled():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="uploads require object storage to be configured",
        )
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"unsupported upload type: {content_type or 'unknown'}",
        )

    key = studio_gen.upload_key(ctx.user_id, file.filename or "upload")
    with TemporaryDirectory() as tmp:
        local = Path(tmp) / Path(key).name
        written = 0
        with local.open("wb") as out:
            while chunk := await file.read(UPLOAD_CHUNK):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"uploads are limited to {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
                    )
                out.write(chunk)
        if written == 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, detail="empty upload"
            )
        await object_storage.upload_file(local, key)

    return UploadOut(
        url=await object_storage.presigned_get_url(key),
        key=key,
        content_type=content_type,
        bytes=written,
    )
