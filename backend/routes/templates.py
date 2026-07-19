"""Template library.

- GET    /api/v1/templates                — published templates (any user)
- GET    /api/v1/templates/admin/all      — every template, drafts included (ADMIN)
- GET    /api/v1/templates/{id}/reference — the reference image
- POST   /api/v1/templates/{id}/remix     — remix with your product (202)
- POST   /api/v1/templates                — create (ADMIN)
- PUT    /api/v1/templates/{id}           — update (ADMIN)
- DELETE /api/v1/templates/{id}           — delete (ADMIN)

Reference/product images travel as base64 in JSON (bounded) — no
multipart dependency. Remixes run on Modal and land in the caller's
media library.
"""
from __future__ import annotations

import base64
import binascii
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.config import settings
from marketer.models import Template
from marketer.repos import templates as templates_repo

from ..auth import AuthCtx, CurrentUser, require_admin

router = APIRouter()

MAX_IMAGE_B64 = 8 * 1024 * 1024  # ~6MB binary
# Whole-request ceiling: image b64 + prompt + slack. Checked from the
# Content-Length header BEFORE the JSON body is parsed, so an oversized
# upload is rejected without buffering it.
MAX_BODY_BYTES = 12 * 1024 * 1024


async def _bounded_body(request: Request) -> None:
    length = request.headers.get("content-length")
    if length is None or not length.isdigit():
        raise HTTPException(
            status.HTTP_411_LENGTH_REQUIRED, detail="Content-Length required"
        )
    if int(length) > MAX_BODY_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="request too large"
        )


def _commit_artifacts() -> None:
    """Publish volume writes so freshly spawned workers see the file.

    The API and workers share the Modal artifacts volume; without a
    commit, a worker container starting right after the spawn can attach
    a snapshot that predates the upload."""
    try:
        import modal

        modal.Volume.from_name("marketer-artifacts").commit()
    except Exception:  # noqa: BLE001 — local dev / tests have no volume
        pass


# Magic-byte signatures for the image formats we actually serve back
# (media_type="image/png" in the reference/remix routes, but admins may
# upload any common still format as the source). A cheap sniff of the
# decoded bytes — no Pillow dependency needed — is enough to reject an
# arbitrary blob (a script, an HTML file, a zip bomb) uploaded through a
# field that only ever claims to hold "image_b64".
_IMAGE_SIGNATURES: tuple[bytes, ...] = (
    b"\x89PNG\r\n\x1a\n",       # PNG
    b"\xff\xd8\xff",             # JPEG
    b"GIF87a",                    # GIF
    b"GIF89a",                    # GIF
    b"RIFF",                      # WEBP (RIFF....WEBP)
)


def _looks_like_image(raw: bytes) -> bool:
    if raw.startswith(b"RIFF"):
        return len(raw) >= 12 and raw[8:12] == b"WEBP"
    return any(raw.startswith(sig) for sig in _IMAGE_SIGNATURES if sig != b"RIFF")


def _sniff_content_type(path: Path) -> str:
    """The real image MIME from the file's magic bytes.

    References are stored under a ``.png`` name regardless of the uploaded
    format, so the filename can't be trusted; serving the actual type keeps
    strict consumers (CDNs, clients that trust Content-Type) correct instead
    of labelling every reference ``image/png``."""
    try:
        head = path.read_bytes()[:12]
    except OSError:
        return "image/png"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


def _decode_image(b64: str, dest: Path) -> Path:
    if len(b64) > MAX_IMAGE_B64:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="image too large"
        )
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid base64 image"
        )
    if not _looks_like_image(raw):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="decoded content is not a recognized image format",
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    return dest


class TemplateCreate(BaseModel):
    kind: Literal["video", "image", "carousel"]
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    prompt: str = Field(min_length=1, max_length=8000)
    reference_image_b64: str = ""
    is_published: bool = False


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    prompt: str | None = Field(default=None, max_length=8000)
    is_published: bool | None = None


class RemixRequest(BaseModel):
    product_image_b64: str = ""
    count: int = Field(default=2, ge=1, le=4)
    note: str = Field(default="", max_length=500)


@router.get("", response_model=list[Template])
async def list_templates(
    kind: Literal["video", "image", "carousel"] | None = None,
    ctx: AuthCtx = CurrentUser,
) -> list[Template]:
    return await templates_repo.list_templates(published_only=True, kind=kind)


# Registered here — before any GET /{template_id}[...] dynamic route below —
# so a literal two-segment path ("admin/all") can never be shadowed by a
# dynamic single-segment match. FastAPI/Starlette tries routes in
# registration order per method, and today no route matches a bare single
# segment for GET, so this ordering is defense-in-depth rather than a
# live bug; keep it first regardless so that stays true as routes evolve.
@router.get("/admin/all", response_model=list[Template])
async def list_all_templates(admin=Depends(require_admin)) -> list[Template]:
    """Every template, drafts included — the admin curation view."""
    return await templates_repo.list_templates(published_only=False)


@router.get("/{template_id}/reference")
async def template_reference(template_id: UUID, ctx: AuthCtx = CurrentUser):
    template = await templates_repo.get(template_id)
    if template is None or not template.is_published or not template.reference_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    path = Path(template.reference_key)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="reference missing")
    return FileResponse(path, media_type=_sniff_content_type(path))


@router.post("/{template_id}/remix", status_code=status.HTTP_202_ACCEPTED)
async def remix_template(
    template_id: UUID, body: RemixRequest, ctx: AuthCtx = CurrentUser,
    _size_ok: None = Depends(_bounded_body),
) -> dict:
    template = await templates_repo.get(template_id)
    if template is None or not template.is_published:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if template.kind == "video":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="video templates apply as a niche style, not an image remix",
        )

    product_path = ""
    if body.product_image_b64:
        dest = (
            Path(settings.artifacts_dir) / ctx.user_id / "uploads"
            / f"product_{uuid4().hex[:10]}.png"
        )
        _decode_image(body.product_image_b64, dest)
        _commit_artifacts()
        product_path = str(dest)

    import modal

    fn = modal.Function.from_name("marketer-sh", "run_template_remix")
    fn.spawn(ctx.user_id, str(template_id), product_path, body.count, body.note)
    return {
        "status": "queued",
        "message": "remix started — results appear in your Library (Images)",
    }


# --------------------------------------------------------------------------- admin

async def _mirror_reference(dest: Path) -> None:
    """Durably mirror the reference image to object storage when enabled.

    Best-effort: the volume copy is the serving copy; the mirror is
    disaster recovery, never a reason an upload fails."""
    try:
        from marketer.services import object_storage

        if object_storage.enabled():
            await object_storage.upload_file(dest, f"templates/{dest.name}")
    except Exception:  # noqa: BLE001
        pass


@router.post("", response_model=Template, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: TemplateCreate, admin=Depends(require_admin),
    _size_ok: None = Depends(_bounded_body),
) -> Template:
    reference_key = ""
    if body.reference_image_b64:
        dest = (
            Path(settings.artifacts_dir) / "templates"
            / f"{uuid4().hex}.png"
        )
        _decode_image(body.reference_image_b64, dest)
        _commit_artifacts()
        await _mirror_reference(dest)
        reference_key = str(dest)
    return await templates_repo.create(
        created_by=admin.user_id,
        kind=body.kind,
        name=body.name,
        description=body.description,
        prompt=body.prompt,
        reference_key=reference_key,
        is_published=body.is_published,
    )


@router.put("/{template_id}", response_model=Template)
async def update_template(
    template_id: UUID, body: TemplateUpdate, admin=Depends(require_admin)
) -> Template:
    template = await templates_repo.update(
        template_id, **body.model_dump(exclude_unset=True)
    )
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: UUID, admin=Depends(require_admin)) -> None:
    if not await templates_repo.delete(template_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
